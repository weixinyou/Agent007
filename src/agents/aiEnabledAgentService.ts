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
  minAiCallIntervalMs: number;
  maxRecentEvents: number;
  shouldControlAgent?: (agentId: string) => boolean;
}

export interface AiDecisionProvider {
  decide(context: AiDecisionContext): Promise<{ request: ActionRequest; reasoning?: string }>;
}

export class AiEnabledAgentService {
  private timer: NodeJS.Timeout | null = null;
  private nextActionAtByAgent = new Map<string, number>();
  private nextAiCallAtByAgent = new Map<string, number>();
  private nextWorldActionAt = 0;
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
      for (const agentId of agentIds) {
        appendAiReasoningEvent(
          state,
          agentId,
          "rest",
          "AI control active; waiting for next decision window.",
          "fallback"
        );
      }
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
      const now = Date.now();
      if (now < this.nextWorldActionAt) {
        return;
      }

      for (let i = 0; i < this.config.actionsPerCycle; i += 1) {
        const snapshot = this.store.read();
        const agentIds = Object.keys(snapshot.agents).filter((agentId) => this.shouldControlAgent(agentId));
        if (agentIds.length === 0) {
          return;
        }

        pruneUnknownAgents(this.nextActionAtByAgent, agentIds);
        for (const agentId of agentIds) {
          if (this.nextActionAtByAgent.has(agentId)) {
            continue;
          }
          const delayMs = computeActionDelayMs(snapshot, agentId, this.config.minActionDelayMs, this.config.maxActionDelayMs);
          this.nextActionAtByAgent.set(agentId, now + delayMs);
        }

        const readyAgentIds = agentIds.filter((agentId) => now >= (this.nextActionAtByAgent.get(agentId) ?? 0));
        if (readyAgentIds.length === 0) {
          return;
        }

        const actorId = pickRandom(readyAgentIds);
        const actor = snapshot.agents[actorId];
        if (!actor) {
          return;
        }

        const context = buildDecisionContext(snapshot, actorId, this.config.maxRecentEvents);
        let request: ActionRequest;
        let reasoning: string | undefined;
        let decisionError: string | undefined;
        let reasoningSource: "ai" | "fallback" = "fallback";
        const nowMs = Date.now();
        const nextAiCallAt = this.nextAiCallAtByAgent.get(actorId) ?? 0;
        const canCallAi = nowMs >= nextAiCallAt;
        try {
          if (!canCallAi) {
            throw new Error(`AI call throttled until ${new Date(nextAiCallAt).toISOString()}`);
          }
          const decision = await this.aiClient.decide(context);
          request = decision.request;
          reasoning = decision.reasoning;
          reasoningSource = "ai";
          this.nextAiCallAtByAgent.set(actorId, nowMs + this.config.minAiCallIntervalMs);
        } catch (error) {
          request = fallbackAction(snapshot, actorId);
          const errorMessage = error instanceof Error ? error.message : String(error);
          decisionError = buildFallbackReasoning(
            snapshot,
            actorId,
            request,
            canCallAi ? undefined : nextAiCallAt,
            errorMessage
          );
          reasoningSource = "fallback";
        }

        this.store.update((state) => {
          const liveActor = state.agents[actorId];
          if (!liveActor) {
            return;
          }

          appendAiReasoningEvent(state, actorId, request.action, reasoning, reasoningSource, decisionError);

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
            this.nextWorldActionAt = nowMs + delayMs;
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
  if (agent.energy <= 1) {
    return { agentId, action: "rest" };
  }

  if (agent.location !== "town" && Math.random() < 0.3) {
    return moveToward(agentId, agent.location, "town");
  }
  if (agent.location !== "cavern" && Math.random() < 0.3) {
    return moveToward(agentId, agent.location, "cavern");
  }
  if (Math.random() < 0.15) {
    return {
      agentId,
      action: "vote",
      votePolicy: state.governance.activePolicy === "aggressive" ? "neutral" : "cooperative"
    };
  }
  return { agentId, action: "gather" };
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
  const agent = state.agents[agentId];
  const wallet = state.wallets[agent.walletAddress];
  const monBalance = wallet?.monBalance ?? 0;
  const inventoryUnits = Object.values(agent.inventory).reduce((sum, qty) => sum + qty, 0);

  const monDelayMs = Math.min(1, monBalance) * 8000;
  const inventoryDelayMs = Math.min(30, inventoryUnits) * 250;
  const reputationDelayMs = Math.min(10, Math.max(0, agent.reputation)) * 180;
  const urgencyDiscountMs = agent.energy <= 2 ? 2000 : 0;
  const computedMs = Math.round(minDelayMs + monDelayMs + inventoryDelayMs + reputationDelayMs - urgencyDiscountMs);
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

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
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
  const sourceTag = source === "ai" ? "[AI]" : "[FALLBACK]";
  state.events.push({
    id: `evt_ai_reason_${state.events.length + 1}`,
    at: new Date().toISOString(),
    agentId,
    type: "ai_reasoning",
    message: `${sourceTag} AI reasoning (${action}): ${clipped}`
  });
}

function buildFallbackReasoning(
  state: WorldState,
  agentId: string,
  action: ActionRequest,
  throttledUntilMs?: number,
  apiErrorMessage?: string
): string {
  if (apiErrorMessage !== undefined) {
    const detail = apiErrorMessage.trim().length > 0 ? apiErrorMessage : "empty error";
    return `AI request failed (${detail}); fallback to ${action.action} for this tick.`;
  }
  if (typeof throttledUntilMs === "number") {
    return `AI call throttled to one request per window; using fallback ${action.action} until ${new Date(throttledUntilMs).toISOString()}.`;
  }
  const agent = state.agents[agentId];
  if (!agent) {
    return "AI request failed; fallback to rest because the agent state is unavailable in the current tick.";
  }

  if (action.action === "rest") {
    return `AI request failed; fallback to rest because energy is low (${agent.energy}), and recovering energy keeps future action options open.`;
  }

  return `AI request failed; fallback to ${action.action} to keep the agent active this tick while preserving stable world progress.`;
}
