import { ActionEngine } from "../engine/actionEngine.js";
import { ActionRequest, LocationId, VotePolicy, WorldState } from "../interfaces/types.js";
import { WorldStore } from "../persistence/worldStore.js";
import { createEvent } from "../world/events/eventFactory.js";

type AgentProfile = "miner" | "trader" | "raider" | "governor";
const MIN_REP_FOR_CLAIM = Math.max(2, Number(process.env.AUTO_AGENT_MIN_REPUTATION_FOR_CLAIM ?? "2"));

export interface AutoAgentConfig {
  enabled: boolean;
  intervalMs: number;
  actionsPerCycle: number;
  minActionDelayMs: number;
  maxActionDelayMs: number;
  shouldControlAgent?: (agentId: string) => boolean;
}

export class AutoAgentService {
  private timer: NodeJS.Timeout | null = null;
  private nextActionAtByAgent = new Map<string, number>();
  private nextWorldActionAt = 0;

  constructor(
    private readonly store: WorldStore,
    private readonly actionEngine: ActionEngine,
    private readonly config: AutoAgentConfig
  ) {}

  start(): void {
    if (!this.config.enabled || this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      try {
        this.runCycle();
      } catch {
        // Keep loop alive even if one cycle fails.
      }
    }, this.config.intervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  private runCycle(): void {
    const now = Date.now();
    if (now < this.nextWorldActionAt) {
      return;
    }

    for (let i = 0; i < this.config.actionsPerCycle; i += 1) {
      this.store.update((state) => {
        if (now < this.nextWorldActionAt) {
          return;
        }

        const agentIds = Object.keys(state.agents).filter((agentId) => this.shouldControlAgent(agentId));
        if (agentIds.length === 0) {
          return;
        }

        pruneUnknownAgents(this.nextActionAtByAgent, agentIds);
        for (const agentId of agentIds) {
          if (this.nextActionAtByAgent.has(agentId)) {
            continue;
          }
          const profile = profileForAgent(agentId);
          const delayMs = computeActionDelayMs(state, agentId, profile, this.config.minActionDelayMs, this.config.maxActionDelayMs);
          this.nextActionAtByAgent.set(agentId, now + delayMs);
        }
        const readyAgentIds = agentIds.filter((agentId) => now >= (this.nextActionAtByAgent.get(agentId) ?? 0));
        if (readyAgentIds.length === 0) {
          return;
        }

        const actorId = pickRandom(readyAgentIds);
        const actor = state.agents[actorId];
        if (!actor) {
          return;
        }

        const profile = profileForAgent(actorId);
        const req = chooseAction(state, actorId, profile);
        const result = this.actionEngine.resolve(state, req);

        if (!result.ok) {
          if (actor.energy <= 1) {
            const restResult = this.actionEngine.resolve(state, { agentId: actorId, action: "rest" });
            if (restResult.ok) {
              const delayMs = this.scheduleNextAction(state, actorId, now, profile);
              this.nextWorldActionAt = now + delayMs;
            }
            return;
          }

          // Strategic fallback: if a planned action fails, gather or move to keep momentum.
          const fallback = fallbackAction(state, actorId, profile);
          const fallbackResult = this.actionEngine.resolve(state, fallback);
          if (fallbackResult.ok) {
            const delayMs = this.scheduleNextAction(state, actorId, now, profile);
            this.nextWorldActionAt = now + delayMs;
          }
          return;
        }

        // Emit AI-style reasoning even for rule-mode agents, so the dashboard can
        // distinguish "AI reasoning" (decision) vs "world event" (outcome).
        // This is intentionally free of any "API failed" wording.
        state.events.push(
          createEvent(
            state.events.length + 1,
            state.tick,
            actorId,
            "ai_reasoning",
            renderRuleReasoning(state, actorId, profile, req)
          )
        );

        const delayMs = this.scheduleNextAction(state, actorId, now, profile);
        this.nextWorldActionAt = now + delayMs;
      });
    }
  }

  private scheduleNextAction(state: WorldState, agentId: string, nowMs: number, profile: AgentProfile): number {
    const delayMs = computeActionDelayMs(state, agentId, profile, this.config.minActionDelayMs, this.config.maxActionDelayMs);
    this.nextActionAtByAgent.set(agentId, nowMs + delayMs);
    return delayMs;
  }

  private shouldControlAgent(agentId: string): boolean {
    return this.config.shouldControlAgent ? this.config.shouldControlAgent(agentId) : true;
  }
}

function computeActionDelayMs(
  state: WorldState,
  agentId: string,
  profile: AgentProfile,
  minDelayMs: number,
  maxDelayMs: number
): number {
  const agent = state.agents[agentId];
  const wallet = state.wallets[agent.walletAddress];
  const monBalance = wallet?.monBalance ?? 0;
  const inventoryUnits = Object.values(agent.inventory).reduce((sum, qty) => sum + qty, 0);

  const profileDelayMs = profile === "raider" ? 1000 : profile === "trader" ? 2500 : profile === "governor" ? 3000 : 2000;
  const monDelayMs = Math.min(1, monBalance) * 8000;
  const inventoryDelayMs = Math.min(30, inventoryUnits) * 250;
  const reputationDelayMs = Math.min(10, Math.max(0, agent.reputation)) * 180;
  const urgencyDiscountMs = agent.energy <= 2 ? 2000 : 0;

  const computedMs = Math.round(minDelayMs + profileDelayMs + monDelayMs + inventoryDelayMs + reputationDelayMs - urgencyDiscountMs);
  return clamp(computedMs, minDelayMs, maxDelayMs);
}

function pruneUnknownAgents(nextActionAtByAgent: Map<string, number>, activeAgentIds: string[]): void {
  const activeIds = new Set(activeAgentIds);
  for (const agentId of nextActionAtByAgent.keys()) {
    if (!activeIds.has(agentId)) {
      nextActionAtByAgent.delete(agentId);
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function chooseAction(state: WorldState, agentId: string, profile: AgentProfile): ActionRequest {
  const agent = state.agents[agentId];
  const totalVotes =
    (state.governance.votes.neutral ?? 0) +
    (state.governance.votes.cooperative ?? 0) +
    (state.governance.votes.aggressive ?? 0);
  const hasAggressiveVote = (state.governance.votes.aggressive ?? 0) > 0;

  if (agent.energy <= 1) {
    return { agentId, action: "rest" };
  }

  // Guarantee at least one aggressive vote early so the governance panel doesn't look "dead".
  if (!hasAggressiveVote && totalVotes >= 3 && totalVotes < 6) {
    return { agentId, action: "vote", votePolicy: "aggressive" };
  }

  // Ensure governance panel becomes "alive" quickly in demos.
  if (totalVotes < 3 && Math.random() < 0.35) {
    // Ensure some drama: avoid getting stuck at aggressive=0 due to unlucky profile mix.
    const votePolicy = !hasAggressiveVote && Math.random() < 0.6
      ? "aggressive"
      : preferredVote(profile, state.governance.activePolicy);
    return { agentId, action: "vote", votePolicy };
  }

  // If we still have zero aggressive votes after some activity, inject occasional pressure
  // so the governance panel isn't stuck in "cooperative-only" runs.
  if (!hasAggressiveVote && totalVotes >= 3 && totalVotes < 20 && Math.random() < 0.08) {
    return { agentId, action: "vote", votePolicy: "aggressive" };
  }

  if (agent.reputation >= MIN_REP_FOR_CLAIM) {
    const canClaimNow = agent.reputation < 6 ? true : Math.random() < claimProbability(profile);
    if (canClaimNow) {
      return { agentId, action: "claim" };
    }
  }

  // Accelerate early economy loop: build reputation quickly before first claim.
  if (agent.reputation < MIN_REP_FOR_CLAIM && agent.energy >= 2 && Math.random() < 0.6) {
    return { agentId, action: "gather" };
  }

  if (shouldPatrol(state, agentId, profile)) {
    return randomAdjacentMove(agentId, agent.location);
  }

  if (shouldVote(profile)) {
    return {
      agentId,
      action: "vote",
      votePolicy: preferredVote(profile, state.governance.activePolicy)
    };
  }

  // Keep the world visibly dynamic: each profile roams at a baseline rate.
  if (shouldRoam(profile)) {
    return randomAdjacentMove(agentId, agent.location);
  }

  const colocated = Object.values(state.agents).filter((a) => a.id !== agentId && a.location === agent.location);

  if (profile === "raider") {
    if (colocated.length > 0 && agent.energy >= 2) {
      return { agentId, action: "attack", targetAgentId: pickRandom(colocated).id };
    }

    if (Math.random() < 0.75) {
      return moveToward(agentId, agent.location, "forest");
    }
    return randomAdjacentMove(agentId, agent.location);
  }

  if (profile === "trader") {
    const trade = chooseTrade(state, agentId, colocated);
    if (trade) {
      return trade;
    }

    if (Math.random() < 0.65) {
      return moveToward(agentId, agent.location, "town");
    }
    return randomAdjacentMove(agentId, agent.location);
  }

  if (profile === "miner") {
    if (agent.location !== "cavern" && Math.random() < 0.7) {
      return moveToward(agentId, agent.location, "cavern");
    }
    if (agent.location === "cavern" && Math.random() < 0.22) {
      return randomAdjacentMove(agentId, agent.location);
    }
    return { agentId, action: "gather" };
  }

  // governor
  if (colocated.length > 0) {
    const trade = chooseTrade(state, agentId, colocated);
    if (trade) {
      return trade;
    }
  }

  if (Math.random() < 0.55) {
    return moveToward(agentId, agent.location, "town");
  }

  if (Math.random() < 0.25) {
    return randomAdjacentMove(agentId, agent.location);
  }

  return { agentId, action: "gather" };
}

function fallbackAction(state: WorldState, agentId: string, profile: AgentProfile): ActionRequest {
  const agent = state.agents[agentId];

  if (profile === "raider") {
    return moveToward(agentId, agent.location, "forest");
  }
  if (profile === "trader") {
    return moveToward(agentId, agent.location, "town");
  }
  if (profile === "miner") {
    return moveToward(agentId, agent.location, "cavern");
  }

  if (Math.random() < 0.5) {
    return randomAdjacentMove(agentId, agent.location);
  }
  return { agentId, action: "gather" };
}

function chooseTrade(
  state: WorldState,
  agentId: string,
  colocated: Array<WorldState["agents"][string]>
): ActionRequest | null {
  const actor = state.agents[agentId];
  const actorItem = firstItem(actor.inventory);
  if (!actorItem) {
    return null;
  }

  for (const target of colocated) {
    const targetItem = firstDifferentItem(target.inventory, actorItem.name);
    if (!targetItem) {
      continue;
    }

    return {
      agentId,
      action: "trade",
      targetAgentId: target.id,
      itemGive: actorItem.name,
      qtyGive: 1,
      itemTake: targetItem.name,
      qtyTake: 1
    };
  }

  return null;
}

function moveToward(agentId: string, from: LocationId, desired: LocationId): ActionRequest {
  if (from === desired) {
    return { agentId, action: "gather" };
  }

  if (from === "town") {
    return { agentId, action: "move", target: "forest" };
  }

  if (from === "cavern") {
    return { agentId, action: "move", target: "forest" };
  }

  // from forest
  return { agentId, action: "move", target: desired === "town" ? "town" : "cavern" };
}

function randomAdjacentMove(agentId: string, from: LocationId): ActionRequest {
  const options: Record<LocationId, LocationId[]> = {
    town: ["forest"],
    forest: ["town", "cavern"],
    cavern: ["forest"]
  };
  return { agentId, action: "move", target: pickRandom(options[from]) };
}

function firstItem(inventory: Record<string, number>): { name: string; qty: number } | null {
  for (const [name, qty] of Object.entries(inventory)) {
    if (qty > 0) {
      return { name, qty };
    }
  }
  return null;
}

function firstDifferentItem(inventory: Record<string, number>, excluded: string): { name: string; qty: number } | null {
  for (const [name, qty] of Object.entries(inventory)) {
    if (name !== excluded && qty > 0) {
      return { name, qty };
    }
  }
  return null;
}

function profileForAgent(agentId: string): AgentProfile {
  const profiles: AgentProfile[] = ["miner", "trader", "raider", "governor"];
  const hash = hashAgentId(agentId);
  return profiles[hash % profiles.length];
}

function hashAgentId(agentId: string): number {
  let hash = 0;
  for (let i = 0; i < agentId.length; i += 1) {
    hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function claimProbability(profile: AgentProfile): number {
  if (profile === "trader") return 0.32;
  if (profile === "miner") return 0.22;
  if (profile === "governor") return 0.25;
  return 0.12;
}


function shouldRoam(profile: AgentProfile): boolean {
  if (profile === "raider") return Math.random() < 0.45;
  if (profile === "trader") return Math.random() < 0.35;
  if (profile === "governor") return Math.random() < 0.3;
  return Math.random() < 0.25;
}

function shouldPatrol(state: WorldState, agentId: string, profile: AgentProfile): boolean {
  const cadence = profile === "raider" ? 3 : profile === "trader" ? 4 : profile === "governor" ? 5 : 4;
  const phase = hashAgentId(agentId) % cadence;
  return state.tick % cadence === phase;
}

function shouldVote(profile: AgentProfile): boolean {
  if (profile === "governor") return Math.random() < 0.4;
  if (profile === "trader") return Math.random() < 0.14;
  if (profile === "miner") return Math.random() < 0.09;
  // raider: more political drama, pushes aggressive policy more often.
  if (profile === "raider") return Math.random() < 0.22;
  return Math.random() < 0.06;
}

function preferredVote(profile: AgentProfile, current: VotePolicy): VotePolicy {
  if (profile === "governor") {
    return current === "aggressive" ? "neutral" : "cooperative";
  }
  if (profile === "raider") {
    return "aggressive";
  }
  if (profile === "trader") {
    return "cooperative";
  }
  return "neutral";
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function renderRuleReasoning(state: WorldState, agentId: string, profile: AgentProfile, req: ActionRequest): string {
  const a = state.agents[agentId];
  const wallet = state.wallets[a.walletAddress];
  const mon = wallet?.monBalance ?? 0;
  const invUnits = Object.values(a.inventory || {}).reduce((s, n) => s + n, 0);
  const policy = state.governance.activePolicy;

  const base = `I chose ${req.action}`;
  const ctx = `Context: profile=${profile}, policy=${policy}, location=${a.location}, energy=${a.energy}, rep=${a.reputation}, invUnits=${invUnits}, mon=${mon.toFixed(6)}.`;

  if (req.action === "rest") {
    return `${base} to recover energy and avoid failed actions. ${ctx}`;
  }
  if (req.action === "gather") {
    return `${base} to convert energy into inventory and reputation (faster progress loop). ${ctx}`;
  }
  if (req.action === "move") {
    return `${base} to reposition for better yields and interactions (target=${req.target}). ${ctx}`;
  }
  if (req.action === "trade") {
    return `${base} to diversify inventory and increase reputation through cooperation (targetAgent=${req.targetAgentId}). ${ctx}`;
  }
  if (req.action === "attack") {
    return `${base} to pressure nearby rivals and potentially steal resources (targetAgent=${req.targetAgentId}). ${ctx}`;
  }
  if (req.action === "vote") {
    return `${base} to shift governance toward my preferred policy (vote=${req.votePolicy}). ${ctx}`;
  }
  if (req.action === "claim") {
    return `${base} to convert reputation into MON rewards while the policy multiplier is favorable. ${ctx}`;
  }
  return `${base}. ${ctx}`;
}
