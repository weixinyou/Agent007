import { ActionEngine } from "../engine/actionEngine.js";
import { ActionRequest, LocationId, WorldState } from "../interfaces/types.js";
import { WorldStore } from "../persistence/worldStore.js";
import { LOCATION_GRAPH } from "../world/locations/map.js";
import { AiDecisionContext } from "./aiClient.js";

export interface AiEnabledAgentConfig {
  enabled: boolean;
  intervalMs: number;
  actionsPerCycle: number;
  minActionDelayMs: number;
  maxActionDelayMs: number;
  maxAgentIdleMs?: number;
  minAiCallIntervalMs: number;
  maxRecentEvents: number;
  emitAiCallEvents?: boolean;
  shouldControlAgent?: (agentId: string) => boolean;
}

export interface AiDecisionProvider {
  decide(context: AiDecisionContext): Promise<{ request: ActionRequest; reasoning?: string }>;
}

export class AiEnabledAgentService {
  private timer: NodeJS.Timeout | null = null;
  private nextActionAtByAgent = new Map<string, number>();
  private nextAiCallAtByAgent = new Map<string, number>();
  private nextGlobalAiCallAt = 0;
  private lastAiCallAtByAgent = new Map<string, number>();
  private lastActedAtByAgent = new Map<string, number>();
  private lastAiDecisionByAgent = new Map<string, { request: ActionRequest; reasoning?: string; decidedAtMs: number }>();
  private inFlightAiByAgent = new Map<string, Promise<void>>();
  private cycleInFlight = false;

  constructor(
    private readonly store: WorldStore,
    private readonly actionEngine: ActionEngine,
    private readonly aiClient: AiDecisionProvider,
    private readonly config: AiEnabledAgentConfig
  ) {}

  start(): void {
    if (!this.config.enabled || this.timer) {
      return;
    }

    this.store.update((state) => {
      const agentIds = Object.keys(state.agents).filter((agentId) => this.shouldControlAgent(agentId));
      // Stagger AI calls so agents rotate (A then B then C ...) instead of clustering.
      // Each agent still respects minAiCallIntervalMs (default 12s => 5/min per agent).
      const slotMs = Math.max(250, Math.floor(this.config.minAiCallIntervalMs / Math.max(1, agentIds.length)));
      const now = Date.now();
      for (let i = 0; i < agentIds.length; i += 1) {
        const id = agentIds[i];
        if (!this.nextAiCallAtByAgent.has(id)) {
          this.nextAiCallAtByAgent.set(id, now + i * slotMs);
        }
        if (!this.lastAiCallAtByAgent.has(id)) {
          this.lastAiCallAtByAgent.set(id, 0);
        }
      }
      for (const agentId of agentIds) {
        appendAiReasoningEvent(
          state,
          agentId,
          "rest",
          "AI control active; waiting for next decision window.",
          "fallback"
        );
      }

      // Ensure telemetry exists for AI API accounting (we do not emit AI_CALL events by default).
      state.telemetry = state.telemetry ?? {};
      state.telemetry.aiApi = state.telemetry.aiApi ?? { total: 0, success: 0, failed: 0 };
    });

    this.timer = setInterval(() => {
      void this.runCycle();
    }, this.config.intervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  private async runCycle(): Promise<void> {
    if (this.cycleInFlight) {
      return;
    }
    this.cycleInFlight = true;

    try {
      for (let i = 0; i < this.config.actionsPerCycle; i += 1) {
        const now = Date.now();
        const snapshot = this.store.read();
        const agentIds = Object.keys(snapshot.agents).filter((agentId) => this.shouldControlAgent(agentId));
        if (agentIds.length === 0) {
          return;
        }

        pruneUnknownAgents(this.nextActionAtByAgent, agentIds);
        pruneUnknownAgents(this.lastActedAtByAgent, agentIds);
        for (const agentId of agentIds) {
          if (this.nextActionAtByAgent.has(agentId)) {
            continue;
          }
          // New agents should act immediately once they enter the world.
          this.nextActionAtByAgent.set(agentId, now);
          if (!this.lastActedAtByAgent.has(agentId)) {
            this.lastActedAtByAgent.set(agentId, 0);
          }
        }

        const readyAgentIds = agentIds.filter((agentId) => {
          const nextAt = this.nextActionAtByAgent.get(agentId) ?? 0;
          const lastActedAt = this.lastActedAtByAgent.get(agentId) ?? 0;
          const maxIdleMs = this.config.maxAgentIdleMs ?? 15_000;
          const idleTooLong = now - lastActedAt >= maxIdleMs;
          return now >= nextAt || idleTooLong;
        });
        if (readyAgentIds.length === 0) {
          return;
        }

        // Prefer an agent eligible for the next AI call slot so calls rotate.
        const nowMs = Date.now();
        const globalSlotOpenForPick = nowMs >= this.nextGlobalAiCallAt;
        const aiEligibleReady = globalSlotOpenForPick
          ? readyAgentIds.filter((id) => nowMs >= (this.nextAiCallAtByAgent.get(id) ?? 0))
          : [];
        const preferredAiCaller =
          aiEligibleReady.length > 0
            ? aiEligibleReady
                .slice()
                .sort((a, b) => (this.lastAiCallAtByAgent.get(a) ?? 0) - (this.lastAiCallAtByAgent.get(b) ?? 0))[0]
            : null;

        const actorId = preferredAiCaller ?? pickFairReadyAgent(readyAgentIds, this.lastActedAtByAgent);
        const actor = snapshot.agents[actorId];
        if (!actor) {
          return;
        }

        const context = buildDecisionContext(snapshot, actorId, this.config.maxRecentEvents);
        const nextAiCallAt = this.nextAiCallAtByAgent.get(actorId) ?? 0;
        const globalSlotOpen = nowMs >= this.nextGlobalAiCallAt;
        const perAgentOpen = nowMs >= nextAiCallAt;
        const canStartAi = globalSlotOpen && perAgentOpen && !this.inFlightAiByAgent.has(actorId);

        // Start the AI call asynchronously so the world keeps updating quickly.
        // The returned decision will be cached and reused across multiple actions until the next refresh.
        if (canStartAi) {
          // Reserve windows up front so we don't start multiple calls concurrently for the same slot.
          this.nextAiCallAtByAgent.set(actorId, nowMs + this.config.minAiCallIntervalMs);
          const slotMs = Math.max(250, Math.floor(this.config.minAiCallIntervalMs / Math.max(1, agentIds.length)));
          this.nextGlobalAiCallAt = nowMs + slotMs;

          const task = (async () => {
            try {
              this.store.update((state) => bumpAiApiCounters(state, "total"));
              const decision = await this.aiClient.decide(context);
              let req = decision.request;
              let reason = decision.reasoning;
              const adjusted = avoidMoveStagnation(snapshot, actorId, req);
              const productivity = avoidLowImpactStagnation(snapshot, actorId, adjusted.request);
              req = productivity.request;
              const note = mergeReasoning(adjusted.note, productivity.note);
              reason = mergeReasoning(reason, note);
              this.lastAiDecisionByAgent.set(actorId, { request: req, reasoning: reason, decidedAtMs: Date.now() });
              this.lastAiCallAtByAgent.set(actorId, Date.now());
              this.store.update((state) => bumpAiApiCounters(state, "success"));
              if (this.config.emitAiCallEvents) {
                this.store.update((state) => {
                  appendAiCallResultEvent(state, actorId, "success", req.action);
                });
              }
            } catch (error) {
              const errorMessage = sanitizeAiErrorForEvent(error);
              this.store.update((state) => bumpAiApiCounters(state, "failed", errorMessage));
              if (this.config.emitAiCallEvents) {
                this.store.update((state) => {
                  appendAiCallResultEvent(state, actorId, "failed", "rest", errorMessage);
                });
              }
              // Keep the previous cached decision (if any). If none, the action loop will fallback.
            }
          })().finally(() => {
            this.inFlightAiByAgent.delete(actorId);
          });
          this.inFlightAiByAgent.set(actorId, task);
        }

        // Use cached AI plan if present; otherwise use a safe fallback.
        let request: ActionRequest;
        let reasoning: string | undefined;
        let adjustmentNote: string | undefined;
        let reasoningSource: "ai" | "fallback" = "fallback";
        const cached = this.lastAiDecisionByAgent.get(actorId);
        if (cached) {
          request = cached.request;
          reasoning = cached.reasoning;
          if (this.inFlightAiByAgent.has(actorId) || !perAgentOpen) {
            adjustmentNote = mergeReasoning(adjustmentNote, "Using cached AI plan while waiting for the next AI refresh.");
          }
          reasoningSource = "ai";
        } else {
          request = fallbackAction(snapshot, actorId);
          reasoning = "No cached AI plan yet; taking a safe action to keep momentum until the first AI decision arrives.";
          reasoningSource = "fallback";
        }

        this.store.update((state) => {
          const liveActor = state.agents[actorId];
          if (!liveActor) {
            return;
          }

          const mergedReasoning = mergeReasoning(reasoning, adjustmentNote);

          // Encourage visible multi-agent interaction: if another agent is co-located, occasionally attack.
          // This keeps the demo showing agent-to-agent dynamics and on-chain micro-transfers (if enabled).
          const colocated = Object.values(state.agents).filter((a) => a.id !== actorId && a.location === liveActor.location);
          let interactionNote: string | undefined;
          if (
            request.action !== "attack" &&
            request.action !== "trade" &&
            colocated.length > 0 &&
            liveActor.energy >= 2 &&
            Math.random() < 0.12
          ) {
            const target = colocated[Math.floor(Math.random() * colocated.length)];
            request = { agentId: actorId, action: "attack", targetAgentId: target.id };
            interactionNote = `Interaction nudge: another agent is nearby (${target.id}); choosing attack to create visible agent-to-agent dynamics.`;
          }

          appendAiReasoningEvent(
            state,
            actorId,
            request.action,
            mergeReasoning(mergedReasoning, interactionNote),
            reasoningSource
          );

          let result = this.actionEngine.resolve(state, request);
          if (!result.ok) {
            const fallback = liveActor.energy <= 1 ? ({ agentId: actorId, action: "rest" } as const) : fallbackAction(state, actorId);
            appendAiReasoningEvent(
              state,
              actorId,
              fallback.action,
              `Primary action ${request.action} failed (${result.message}); fallback to ${fallback.action} to keep progress while reducing immediate failure risk.`,
              "fallback"
            );
            result = this.actionEngine.resolve(state, fallback);
          }

          if (result.ok) {
            const nowMs = Date.now();
            const delayMs = computeActionDelayMs(state, actorId, this.config.minActionDelayMs, this.config.maxActionDelayMs);
            this.nextActionAtByAgent.set(actorId, nowMs + delayMs);
            this.lastActedAtByAgent.set(actorId, nowMs);
          }
        });
      }
    } finally {
      this.cycleInFlight = false;
    }
  }

  private shouldControlAgent(agentId: string): boolean {
    return this.config.shouldControlAgent ? this.config.shouldControlAgent(agentId) : true;
  }
}

function bumpAiApiCounters(state: WorldState, kind: "total" | "success" | "failed", lastError?: string): void {
  state.telemetry = state.telemetry ?? {};
  state.telemetry.aiApi = state.telemetry.aiApi ?? { total: 0, success: 0, failed: 0 };
  const now = new Date().toISOString();
  state.telemetry.aiApi.total = Math.max(0, (state.telemetry.aiApi.total ?? 0) + (kind === "total" ? 1 : 0));
  state.telemetry.aiApi.success = Math.max(0, (state.telemetry.aiApi.success ?? 0) + (kind === "success" ? 1 : 0));
  state.telemetry.aiApi.failed = Math.max(0, (state.telemetry.aiApi.failed ?? 0) + (kind === "failed" ? 1 : 0));
  if (kind === "success") {
    state.telemetry.aiApi.lastOkAt = now;
  }
  if (kind === "failed") {
    state.telemetry.aiApi.lastFailAt = now;
    if (typeof lastError === "string" && lastError.trim().length > 0) {
      state.telemetry.aiApi.lastError = lastError.trim().slice(0, 240);
    }
  }
}

function buildDecisionContext(state: WorldState, agentId: string, maxRecentEvents: number): AiDecisionContext {
  const agent = state.agents[agentId];
  const monBalance = state.wallets[agent.walletAddress]?.monBalance ?? 0;
  const nearbyAgents = Object.values(state.agents)
    .filter((other) => other.id !== agentId && other.location === agent.location)
    .map((other) => ({
      id: other.id,
      location: other.location,
      energy: other.energy,
      reputation: other.reputation
    }));

  return {
    agent: {
      id: agent.id,
      location: agent.location,
      energy: agent.energy,
      reputation: agent.reputation,
      inventory: agent.inventory,
      monBalance
    },
    world: {
      tick: state.tick,
      governance: state.governance,
      reachableLocations: LOCATION_GRAPH[agent.location],
      nearbyAgents,
      recentEvents: state.events.slice(-maxRecentEvents).map((event) => ({
        at: event.at,
        agentId: event.agentId,
        type: event.type,
        message: event.message
      }))
    }
  };
}

function fallbackAction(state: WorldState, agentId: string): ActionRequest {
  const agent = state.agents[agentId];
  if (!agent) {
    return { agentId, action: "rest" };
  }

  const colocatedAgents = Object.values(state.agents).filter(
    (other) => other.id !== agentId && other.location === agent.location
  );
  const inventoryUnits = Object.values(agent.inventory).reduce((sum, qty) => sum + qty, 0);
  const recentVoteCount = state.events.slice(-18).filter((event) => event.type === "vote").length;

  if (agent.energy <= 1) {
    return { agentId, action: "rest" };
  }

  const explorationMove = forceExplorationMoveIfStuck(state, agentId);
  if (explorationMove) {
    return explorationMove;
  }

  // Realistic politics: selective, biased voting instead of force-balancing.
  if (recentVoteCount === 0 ? Math.random() < 0.12 : Math.random() < voteProbabilityForAgent(agentId)) {
    return {
      agentId,
      action: "vote",
      votePolicy: preferredFallbackVote(agentId, state.governance.activePolicy)
    };
  }

  // Guarantee regular gather cycles when economy is underdeveloped.
  if (agent.reputation < 2 && agent.energy >= 2 && (inventoryUnits < 8 || Math.random() < 0.75)) {
    return { agentId, action: "gather" };
  }

  // Prioritize monetization when claimable reputation exists so balances visibly evolve.
  if (agent.reputation >= 2 && Math.random() < 0.6) {
    return { agentId, action: "claim" };
  }

  // Make world politics and conflict visibly dynamic in fallback mode.
  if (colocatedAgents.length > 0 && agent.energy >= 3 && Math.random() < 0.35) {
    return { agentId, action: "attack", targetAgentId: pickRandom(colocatedAgents).id };
  }

  if (Math.random() < 0.2) {
    return {
      agentId,
      action: "vote",
      votePolicy: chooseDramaticPolicy(state.governance.activePolicy)
    };
  }

  // Keep core world stats moving quickly.
  if (agent.energy >= 2 && Math.random() < 0.7) {
    return { agentId, action: "gather" };
  }

  if (agent.location !== "town" && Math.random() < 0.3) {
    return moveToward(agentId, agent.location, "town");
  }
  if (agent.location !== "cavern" && Math.random() < 0.3) {
    return moveToward(agentId, agent.location, "cavern");
  }
  return { agentId, action: "gather" };
}

function avoidMoveStagnation(
  state: WorldState,
  agentId: string,
  request: ActionRequest
): { request: ActionRequest; note?: string } {
  const explorationMove = forceExplorationMoveIfStuck(state, agentId);
  if (explorationMove && request.action !== "move") {
    return {
      request: explorationMove,
      note: "Adjusted to move because agent stayed in one location for too long."
    };
  }

  if (request.action !== "move") {
    return { request };
  }
  const agent = state.agents[agentId];
  if (!agent) {
    return { request };
  }
  const inventoryUnits = Object.values(agent.inventory).reduce((sum, qty) => sum + qty, 0);

  // Ensure early-world economy starts moving instead of all agents roaming first.
  if (inventoryUnits === 0 && agent.reputation === 0 && agent.energy >= 2) {
    return {
      request: { agentId, action: "gather" },
      note: "Adjusted to gather early so inventory and reputation start evolving immediately."
    };
  }

  const recentOwnEvents = state.events
    .slice(-10)
    .filter((event) => event.agentId === agentId && ["move", "gather", "trade", "attack", "vote", "claim", "rest"].includes(event.type));
  let consecutiveMoves = 0;
  for (let i = recentOwnEvents.length - 1; i >= 0; i -= 1) {
    if (recentOwnEvents[i].type !== "move") {
      break;
    }
    consecutiveMoves += 1;
  }

  if (consecutiveMoves < 2) {
    return { request };
  }

  if (agent.energy >= 2) {
    return {
      request: { agentId, action: "gather" },
      note: "Adjusted to gather after repeated move-only loop so inventory and reputation continue evolving."
    };
  }
  return {
    request: { agentId, action: "rest" },
    note: "Adjusted to rest after repeated move-only loop with low energy."
  };
}

function avoidLowImpactStagnation(
  state: WorldState,
  agentId: string,
  request: ActionRequest
): { request: ActionRequest; note?: string } {
  const agent = state.agents[agentId];
  if (!agent) {
    return { request };
  }
  const inventoryUnits = Object.values(agent.inventory).reduce((sum, qty) => sum + qty, 0);

  // Early progression: prefer gather over repeated low-impact voting while economy is empty.
  if (
    request.action === "vote" &&
    agent.energy >= 2 &&
    (inventoryUnits < 2 || agent.reputation < 1)
  ) {
    return {
      request: { agentId, action: "gather" },
      note: "Adjusted vote to gather so energy/reputation/inventory evolve faster."
    };
  }

  const recentOwnActions = state.events
    .slice(-8)
    .filter((event) => event.agentId === agentId && ["vote", "rest", "move", "gather", "claim", "attack", "trade"].includes(event.type))
    .map((event) => event.type);

  const lastTwoLowImpact = recentOwnActions.slice(-2).every((type) => type === "vote" || type === "rest");
  if (lastTwoLowImpact && agent.energy >= 2 && request.action !== "gather") {
    return {
      request: { agentId, action: "gather" },
      note: "Adjusted to gather after repeated low-impact actions."
    };
  }

  return { request };
}

function forceExplorationMoveIfStuck(state: WorldState, agentId: string): ActionRequest | undefined {
  const agent = state.agents[agentId];
  if (!agent || agent.energy < 2) {
    return undefined;
  }

  const recentOwnActions = state.events
    .slice(-18)
    .filter(
      (event) =>
        event.agentId === agentId &&
        ["move", "gather", "rest", "vote", "claim", "trade", "attack"].includes(event.type)
    );

  const colocatedCount = Object.values(state.agents).filter(
    (other) => other.id !== agentId && other.location === agent.location
  ).length;
  const requiredStationaryTurns = colocatedCount > 0 ? 2 : 4;

  const recentStationaryWindow = recentOwnActions.slice(-requiredStationaryTurns);
  const recentStationary = recentStationaryWindow.filter((event) => event.type !== "move").length;
  if (recentStationary < requiredStationaryTurns) {
    return undefined;
  }

  const reachable = LOCATION_GRAPH[agent.location] ?? [];
  if (reachable.length === 0) {
    return undefined;
  }

  const target = pickReachableLocationForExploration(state, reachable, agent.location);
  return { agentId, action: "move", target };
}

function pickReachableLocationForExploration(
  state: WorldState,
  reachable: LocationId[],
  current: LocationId
): LocationId {
  // Prefer the least crowded reachable location to break agent clumping.
  const counts = new Map<LocationId, number>();
  for (const candidate of reachable) {
    counts.set(
      candidate,
      Object.values(state.agents).filter((agent) => agent.location === candidate).length
    );
  }
  const leastCrowded = reachable
    .slice()
    .sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0));
  if (leastCrowded.length > 0 && leastCrowded[0] !== current) {
    return leastCrowded[0];
  }

  const priority: LocationId[] = ["forest", "town", "cavern"];
  for (const candidate of priority) {
    if (candidate !== current && reachable.includes(candidate)) {
      return candidate;
    }
  }
  return reachable[0];
}

function mergeReasoning(reasoning?: string, note?: string): string | undefined {
  if (reasoning && note) {
    return `${reasoning} ${note}`;
  }
  return reasoning ?? note;
}

function chooseDramaticPolicy(current: WorldState["governance"]["activePolicy"]): WorldState["governance"]["activePolicy"] {
  const roll = Math.random();
  // Keep politics swingy so governance panel changes frequently.
  if (current === "aggressive") {
    if (roll < 0.25) return "cooperative";
    if (roll < 0.45) return "neutral";
    return "aggressive";
  }
  if (roll < 0.7) return "aggressive";
  if (roll < 0.88) return "cooperative";
  return "neutral";
}

function voteProbabilityForAgent(agentId: string): number {
  const profile = hashAgentId(agentId) % 4;
  if (profile === 0) return 0.32;
  if (profile === 1) return 0.2;
  if (profile === 2) return 0.12;
  return 0.08;
}

function preferredFallbackVote(
  agentId: string,
  active: WorldState["governance"]["activePolicy"]
): WorldState["governance"]["activePolicy"] {
  const roll = Math.random();
  const profile = hashAgentId(agentId) % 4;

  if (profile === 0) {
    if (roll < 0.7) return "aggressive";
    if (roll < 0.9) return "neutral";
    return "cooperative";
  }
  if (profile === 1) {
    if (roll < 0.6) return "cooperative";
    if (roll < 0.85) return "neutral";
    return "aggressive";
  }
  if (profile === 2) {
    if (roll < 0.65) return "neutral";
    if (roll < 0.9) return "cooperative";
    return "aggressive";
  }

  if (active === "aggressive") return roll < 0.75 ? "cooperative" : "neutral";
  if (active === "cooperative") return roll < 0.75 ? "aggressive" : "neutral";
  return roll < 0.7 ? "aggressive" : "cooperative";
}

function hashAgentId(agentId: string): number {
  let hash = 0;
  for (let i = 0; i < agentId.length; i += 1) {
    hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  }
  return hash;
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
  return { agentId, action: "move", target: desired === "town" ? "town" : "cavern" };
}

function computeActionDelayMs(state: WorldState, agentId: string, minDelayMs: number, maxDelayMs: number): number {
  const span = Math.max(0, maxDelayMs - minDelayMs);
  if (span === 0) {
    return minDelayMs;
  }
  return minDelayMs + Math.floor(Math.random() * (span + 1));
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

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function pickFairReadyAgent(readyAgentIds: string[], lastActedAtByAgent: Map<string, number>): string {
  return readyAgentIds
    .slice()
    .sort((a, b) => {
      const aLast = lastActedAtByAgent.get(a) ?? 0;
      const bLast = lastActedAtByAgent.get(b) ?? 0;
      if (aLast !== bLast) {
        return aLast - bLast;
      }
      return a.localeCompare(b);
    })[0];
}

function appendAiReasoningEvent(
  state: WorldState,
  agentId: string,
  action: ActionRequest["action"],
  reasoning: string | undefined,
  source: "ai" | "fallback",
  fallbackMessage?: string
): void {
  const raw = typeof reasoning === "string" && reasoning.trim().length > 0 ? reasoning : fallbackMessage ?? "No reasoning provided.";
  const normalized = raw.replace(/\s+/g, " ").trim();
  const clipped = normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
  const sourceTag = "[AI]";
  state.events.push({
    id: `evt_ai_reason_${state.events.length + 1}`,
    at: new Date().toISOString(),
    agentId,
    type: "ai_reasoning",
    message: `${sourceTag} AI reasoning (${action}): ${clipped}`
  });
}

function appendAiCallResultEvent(
  state: WorldState,
  agentId: string,
  status: "success" | "failed",
  action: ActionRequest["action"],
  reason?: string
): void {
  const detail = reason && reason.trim().length > 0 ? ` (${reason.trim()})` : "";
  state.events.push({
    id: `evt_ai_call_${state.events.length + 1}`,
    at: new Date().toISOString(),
    agentId,
    type: "ai_call",
    message:
      status === "success"
        ? `[AI] API call succeeded; accepted action=${action}.`
        : `[AI] API call failed; fallback action=${action}${detail}.`
  });
}

function buildFallbackReasoning(
  state: WorldState,
  agentId: string,
  action: ActionRequest,
  throttledUntilMs?: number,
  apiErrorMessage?: string
): string {
  const agent = state.agents[agentId];
  const wallet = agent ? state.wallets[agent.walletAddress] : undefined;
  const monBalance = wallet?.monBalance ?? 0;
  const inventoryUnits = agent ? Object.values(agent.inventory).reduce((sum, qty) => sum + qty, 0) : 0;

  const contextLine = agent
    ? `I observed location=${agent.location}, energy=${agent.energy}, reputation=${agent.reputation}, inventoryUnits=${inventoryUnits}, mon=${monBalance.toFixed(4)}.`
    : "I observed limited world context for this turn.";

  if (typeof throttledUntilMs === "number") {
    return `${contextLine} I chose ${action.action} as a low-risk step while waiting for the next decision window.`;
  }
  if (!agent) {
    return "I chose rest because conserving momentum is safer when state visibility is limited.";
  }

  if (action.action === "rest") {
    return `${contextLine} I chose rest because low energy limits success probability for higher-value actions.`;
  }

  if (apiErrorMessage !== undefined) {
    return `${contextLine} I chose ${action.action} to keep progress stable this tick and improve next-turn options.`;
  }

  return `${contextLine} I chose ${action.action} to maintain momentum and improve next-turn options.`;
}

function sanitizeAiErrorForEvent(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const text = (raw || "").trim();
  if (text.length === 0) {
    return "transient inference issue";
  }

  const lowered = text.toLowerCase();
  if (lowered.includes("openai_api_key") || lowered.includes("api key")) {
    return "temporary model unavailability";
  }
  if (lowered.includes("rate") && lowered.includes("limit")) {
    return "capacity throttling";
  }
  if (lowered.includes("timed out") || lowered.includes("timeout")) {
    return "response timeout";
  }

  return text.slice(0, 80);
}
