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
      enum: ["move", "gather", "rest", "trade", "attack", "vote", "claim"]
    },
    target: {
      type: "string",
      enum: ["town", "forest", "cavern"]
    },
    targetAgentId: {
      type: "string"
    },
    itemGive: {
      type: "string"
    },
    qtyGive: {
      type: "integer",
      minimum: 1
    },
    itemTake: {
      type: "string"
    },
    qtyTake: {
      type: "integer",
      minimum: 1
    },
    votePolicy: {
      type: "string",
      enum: ["neutral", "cooperative", "aggressive"]
    },
    reasoning: {
      type: "string",
      minLength: 20
    }
  },
  required: ["action", "reasoning"]
};

export class AiClient {
  constructor(private readonly config: AiClientConfig) {}

  async decide(context: AiDecisionContext): Promise<{ request: ActionRequest; reasoning?: string }> {
    const fetchImpl = globalThis.fetch;
    if (!fetchImpl) {
      throw new Error("Global fetch is not available; cannot call AI API");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetchImpl(this.config.baseUrl ?? OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          input: [
            {
              role: "system",
              content:
                "You control one game agent. Return a single valid JSON action object. " +
                "Prefer actions likely to succeed now. Never include markdown. " +
                "Reasoning must explain current constraints and why this action is best now."
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
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`AI API error: HTTP ${response.status}`);
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const text = extractOutputText(payload);
      const parsed = JSON.parse(text) as RawAiAction;

      const request = parseActionRequest({
        agentId: context.agent.id,
        action: parsed.action,
        target: parsed.target,
        targetAgentId: parsed.targetAgentId,
        itemGive: parsed.itemGive,
        qtyGive: parsed.qtyGive,
        itemTake: parsed.itemTake,
        qtyTake: parsed.qtyTake,
        votePolicy: parsed.votePolicy
      });

      return { request, reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined };
    } finally {
      clearTimeout(timeout);
    }
  }
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
