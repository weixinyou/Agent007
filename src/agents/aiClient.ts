import { ActionRequest, LocationId, VotePolicy, WorldState, parseActionRequest } from "../interfaces/types.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export interface AiDecisionContext {
  agent: {
    id: string;
    location: LocationId;
    energy: number;
    reputation: number;
    inventory: Record<string, number>;
    monBalance: number;
  };
  world: {
    tick: number;
    governance: WorldState["governance"];
    reachableLocations: LocationId[];
    nearbyAgents: Array<{
      id: string;
      location: LocationId;
      energy: number;
      reputation: number;
    }>;
    recentEvents: Array<{
      at: string;
      agentId: string;
      type: string;
      message: string;
    }>;
  };
}

export interface AiClientConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs: number;
  maxAttempts?: number;
}

interface RawAiAction {
  action: ActionRequest["action"];
  target?: LocationId;
  targetAgentId?: string;
  itemGive?: string;
  qtyGive?: number;
  itemTake?: string;
  qtyTake?: number;
  votePolicy?: VotePolicy;
  reasoning?: string;
}

const ACTION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: ["move", "gather", "rest", "trade", "attack", "vote", "claim", "sell", "aid"]
    },
    target: {
      type: ["string", "null"],
      enum: ["town", "forest", "cavern", null]
    },
    targetAgentId: {
      type: ["string", "null"]
    },
    itemGive: {
      type: ["string", "null"]
    },
    qtyGive: {
      type: ["integer", "null"],
      minimum: 1
    },
    itemTake: {
      type: ["string", "null"]
    },
    qtyTake: {
      type: ["integer", "null"],
      minimum: 1
    },
    votePolicy: {
      type: ["string", "null"],
      enum: ["neutral", "cooperative", "aggressive", null]
    },
    reasoning: {
      type: "string",
      minLength: 20
    }
  },
  required: ["action", "target", "targetAgentId", "itemGive", "qtyGive", "itemTake", "qtyTake", "votePolicy", "reasoning"]
};

export class AiClient {
  constructor(private readonly config: AiClientConfig) {}

  async decide(context: AiDecisionContext): Promise<{ request: ActionRequest; reasoning?: string }> {
    const fetchImpl = globalThis.fetch;
    if (!fetchImpl) {
      throw new Error("Global fetch is not available; cannot call AI API");
    }

    const requestBody = JSON.stringify({
      model: this.config.model,
      input: [
        {
          role: "system",
          content:
            "You control one game agent. Return a single valid JSON action object. " +
            "Prefer actions likely to succeed now. Never include markdown. " +
            "Reasoning must explain current constraints and why this action is best now. " +
            "Politics: voting is optional, but occasionally voting is encouraged. Over time, try to avoid leaving any governance option at 0 votes for long (neutral/cooperative/aggressive), as long as it does not obviously harm the agent. " +
            "Economy: if there are nearbyAgents at the same location and you have inventory, consider proposing trades sometimes (trade triggers an on-chain MON micro-transfer that is traceable). " +
            "Market: if you are in town and have a lot of inventory, consider selling some items via action=sell (uses itemGive/qtyGive). Selling pays MON from the world treasury (on-chain in mon-testnet mode) and reduces inventory."
            + " Aid: if another agent is co-located and appears low energy or recently attacked, consider helping via action=aid (uses targetAgentId and optionally itemGive/qtyGive)."
        },
        {
          role: "user",
          content:
            "Choose one action for this agent based on world context. " +
            "Use move only to reachable locations. " +
            "Use attack/trade only with nearbyAgents ids.\n" +
            JSON.stringify(context)
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "agent_action",
          schema: ACTION_RESPONSE_SCHEMA,
          strict: true
        }
      }
    });

    const maxAttempts = Math.max(1, this.config.maxAttempts ?? 3);
    let attempt = 0;
    let lastError: Error | null = null;
    while (attempt < maxAttempts) {
      attempt += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await fetchImpl(this.config.baseUrl ?? OPENAI_RESPONSES_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`
          },
          body: requestBody,
          signal: controller.signal
        });

        if (!response.ok) {
          const raw = await response.text().catch(() => "");
          const err = new Error(`AI API error: HTTP ${response.status}${raw ? ` ${raw.slice(0, 220)}` : ""}`);
          const shouldRetry = response.status >= 500 || response.status === 429 || response.status === 408;
          if (shouldRetry && attempt < maxAttempts) {
            await sleepMs(350 * attempt);
            lastError = err;
            continue;
          }
          throw err;
        }

        const payload = (await response.json()) as Record<string, unknown>;
        const text = extractOutputText(payload);
        const parsed = JSON.parse(text) as RawAiAction;

        const request = parseActionRequest({
          agentId: context.agent.id,
          action: parsed.action,
          target: parsed.target ?? undefined,
          targetAgentId: parsed.targetAgentId ?? undefined,
          itemGive: parsed.itemGive ?? undefined,
          qtyGive: parsed.qtyGive ?? undefined,
          itemTake: parsed.itemTake ?? undefined,
          qtyTake: parsed.qtyTake ?? undefined,
          votePolicy: parsed.votePolicy ?? undefined
        });

        return { request, reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const transient = /timed out|timeout|ECONNRESET|ENOTFOUND|fetch failed|aborted/i.test(message);
        if (transient && attempt < maxAttempts) {
          await sleepMs(350 * attempt);
          lastError = error instanceof Error ? error : new Error(message);
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError ?? new Error("AI request failed after retries");
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractOutputText(payload: Record<string, unknown>): string {
  const outputText = payload.output_text;
  if (typeof outputText === "string" && outputText.trim().length > 0) {
    return outputText;
  }

  const output = payload.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!item || typeof item !== "object") continue;
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;
      for (const entry of content) {
        if (!entry || typeof entry !== "object") continue;
        const typed = entry as { type?: unknown; text?: unknown };
        if ((typed.type === "output_text" || typed.type === "text") && typeof typed.text === "string") {
          return typed.text;
        }
      }
    }
  }

  throw new Error("AI API did not return text output");
}
