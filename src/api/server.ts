import path from "node:path";
import { AgentRegistry } from "../agents/agentRegistry.js";
import { AiClient } from "../agents/aiClient.js";
import { AiEnabledAgentService } from "../agents/aiEnabledAgentService.js";
import { AutoAgentService } from "../agents/autoAgentService.js";
import { createPaymentGateway } from "../economy/createPaymentGateway.js";
import { WalletService } from "../economy/walletService.js";
import { ActionEngine } from "../engine/actionEngine.js";
import { createWorldStore } from "../persistence/createWorldStore.js";
import { SnapshotStore } from "../persistence/snapshotStore.js";
import { AuthService } from "../services/authService.js";
import { EntryService } from "../services/entryService.js";
import { SignatureAuthService } from "../services/signatureAuthService.js";
import { createAppServer } from "./app.js";

const root = process.cwd();

const seedPath = path.join(root, "data/seeds/world.seed.json");
const jsonStatePath = path.join(root, "data/state/world.json");
const sqliteStatePath = path.join(root, "data/state/world.db");
const snapshotDir = path.join(root, "data/snapshots");
const storeMode = (process.env.WORLD_STORE ?? "json").toLowerCase();
const walletService = new WalletService();
const payment = createPaymentGateway(walletService);
const entryService = new EntryService(payment.gateway, new AgentRegistry());

const store = createWorldStore(jsonStatePath, sqliteStatePath);
store.initFromSeed(seedPath);
const actionEngine = new ActionEngine();

const server = createAppServer({
  store,
  snapshotStore: new SnapshotStore(snapshotDir),
  entryService,
  actionEngine,
  authService: new AuthService(process.env.AGENT007_API_KEY),
  signatureAuthService: new SignatureAuthService(process.env.AGENT007_HMAC_SECRET),
  storeMode,
  paymentMode: payment.paymentMode
});

const autoAgentConfig = {
  enabled: (process.env.AUTO_AGENT_ENABLED ?? "true").toLowerCase() !== "false",
  intervalMs: Math.max(500, Number(process.env.AUTO_AGENT_INTERVAL_MS ?? "2500")),
  actionsPerCycle: Math.max(1, Number(process.env.AUTO_AGENT_ACTIONS_PER_CYCLE ?? "1")),
  minActionDelayMs: Math.max(1_000, Number(process.env.AUTO_AGENT_MIN_ACTION_DELAY_MS ?? "5000")),
  maxActionDelayMs: Math.max(
    Math.max(1_000, Number(process.env.AUTO_AGENT_MIN_ACTION_DELAY_MS ?? "5000")),
    Number(process.env.AUTO_AGENT_MAX_ACTION_DELAY_MS ?? "15000")
  )
};
const aiMinActionDelayMs = Math.max(
  1_000,
  Number(process.env.AI_AGENT_MIN_ACTION_DELAY_MS ?? String(autoAgentConfig.minActionDelayMs))
);
const aiMaxActionDelayMs = Math.max(
  aiMinActionDelayMs,
  Number(process.env.AI_AGENT_MAX_ACTION_DELAY_MS ?? String(autoAgentConfig.maxActionDelayMs))
);

type AutonomousService = {
  start(): void;
  stop(): void;
};

const brainMode = (process.env.AGENT_BRAIN_MODE ?? "rule").toLowerCase();
let activeBrainMode = brainMode;
const autonomousServices: AutonomousService[] = [];
const aiAgentIds = new Set(
  (process.env.AI_AGENT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
);

if (brainMode === "rule") {
  autonomousServices.push(new AutoAgentService(store, actionEngine, autoAgentConfig));
} else if (brainMode === "ai") {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("AGENT_BRAIN_MODE=ai requested, but OPENAI_API_KEY is missing. Running AI fallback reasoning mode.");
    activeBrainMode = "ai(fallback)";
    autonomousServices.push(
      new AiEnabledAgentService(
        store,
        actionEngine,
        {
          async decide() {
            throw new Error("OPENAI_API_KEY missing");
          }
        },
        {
          ...autoAgentConfig,
          minActionDelayMs: aiMinActionDelayMs,
          maxActionDelayMs: aiMaxActionDelayMs,
          minAiCallIntervalMs: Math.max(5_000, Number(process.env.AI_AGENT_MIN_CALL_INTERVAL_MS ?? "300000")),
          maxRecentEvents: Math.max(5, Number(process.env.AI_AGENT_MAX_RECENT_EVENTS ?? "12"))
        }
      )
    );
  } else {
    autonomousServices.push(
      new AiEnabledAgentService(
        store,
        actionEngine,
        new AiClient({
          apiKey: process.env.OPENAI_API_KEY,
          model: process.env.AI_AGENT_MODEL ?? "gpt-5-nano",
          baseUrl: process.env.AI_AGENT_BASE_URL,
          timeoutMs: Math.max(1000, Number(process.env.AI_AGENT_TIMEOUT_MS ?? "15000"))
        }),
        {
          ...autoAgentConfig,
          minActionDelayMs: aiMinActionDelayMs,
          maxActionDelayMs: aiMaxActionDelayMs,
          minAiCallIntervalMs: Math.max(5_000, Number(process.env.AI_AGENT_MIN_CALL_INTERVAL_MS ?? "300000")),
          maxRecentEvents: Math.max(5, Number(process.env.AI_AGENT_MAX_RECENT_EVENTS ?? "12"))
        }
      )
    );
  }
} else if (brainMode === "mixed") {
  if (!process.env.OPENAI_API_KEY) {
    if (aiAgentIds.size === 0) {
      console.warn("AGENT_BRAIN_MODE=mixed requested without OPENAI_API_KEY and empty AI_AGENT_IDS; falling back to rule mode.");
      activeBrainMode = "rule";
      autonomousServices.push(new AutoAgentService(store, actionEngine, autoAgentConfig));
    } else {
      console.warn("AGENT_BRAIN_MODE=mixed requested without OPENAI_API_KEY; AI-designated agents will run AI fallback reasoning.");
      activeBrainMode = "mixed(ai-fallback)";
      autonomousServices.push(
        new AutoAgentService(store, actionEngine, {
          ...autoAgentConfig,
          shouldControlAgent: (agentId) => !aiAgentIds.has(agentId)
        })
      );
      autonomousServices.push(
        new AiEnabledAgentService(
          store,
          actionEngine,
          {
            async decide() {
              throw new Error("OPENAI_API_KEY missing");
            }
          },
          {
            ...autoAgentConfig,
            minActionDelayMs: aiMinActionDelayMs,
            maxActionDelayMs: aiMaxActionDelayMs,
            minAiCallIntervalMs: Math.max(5_000, Number(process.env.AI_AGENT_MIN_CALL_INTERVAL_MS ?? "300000")),
            maxRecentEvents: Math.max(5, Number(process.env.AI_AGENT_MAX_RECENT_EVENTS ?? "12")),
            shouldControlAgent: (agentId) => aiAgentIds.has(agentId)
          }
        )
      );
    }
  } else if (aiAgentIds.size === 0) {
    console.warn("AGENT_BRAIN_MODE=mixed requested, but AI_AGENT_IDS is empty. Falling back to rule mode.");
    activeBrainMode = "rule";
    autonomousServices.push(new AutoAgentService(store, actionEngine, autoAgentConfig));
  } else {
    autonomousServices.push(
      new AutoAgentService(store, actionEngine, {
        ...autoAgentConfig,
        shouldControlAgent: (agentId) => !aiAgentIds.has(agentId)
      })
    );
    autonomousServices.push(
      new AiEnabledAgentService(
        store,
        actionEngine,
        new AiClient({
          apiKey: process.env.OPENAI_API_KEY,
          model: process.env.AI_AGENT_MODEL ?? "gpt-5-nano",
          baseUrl: process.env.AI_AGENT_BASE_URL,
          timeoutMs: Math.max(1000, Number(process.env.AI_AGENT_TIMEOUT_MS ?? "15000"))
        }),
        {
          ...autoAgentConfig,
          minActionDelayMs: aiMinActionDelayMs,
          maxActionDelayMs: aiMaxActionDelayMs,
          minAiCallIntervalMs: Math.max(5_000, Number(process.env.AI_AGENT_MIN_CALL_INTERVAL_MS ?? "300000")),
          maxRecentEvents: Math.max(5, Number(process.env.AI_AGENT_MAX_RECENT_EVENTS ?? "12")),
          shouldControlAgent: (agentId) => aiAgentIds.has(agentId)
        }
      )
    );
  }
} else {
  console.warn(`Unknown AGENT_BRAIN_MODE=${brainMode}. Falling back to rule mode.`);
  activeBrainMode = "rule";
  autonomousServices.push(new AutoAgentService(store, actionEngine, autoAgentConfig));
}

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
server.listen(port, () => {
  for (const service of autonomousServices) {
    service.start();
  }
  bootstrapDefaultAgents(entryService, actionEngine);
  console.log(`Agent007 API listening on http://localhost:${port} (brain mode: ${activeBrainMode})`);
});

server.on("close", () => {
  for (const service of autonomousServices) {
    service.stop();
  }
});

function bootstrapDefaultAgents(entryService: EntryService, actionEngine: ActionEngine): void {
  const bootstrapEnabled = (process.env.BOOTSTRAP_DEFAULT_AGENTS ?? "false").toLowerCase() === "true";
  if (!bootstrapEnabled) {
    return;
  }

  const specs = parseBootstrapAgents();
  if (specs.length === 0) {
    return;
  }

  const results = store.update((state) =>
    specs.map((spec) =>
      entryService.enter(state, {
        agentId: spec.agentId,
        walletAddress: spec.walletAddress
      })
    )
  );

  // Prime governance panel so reviewers immediately see non-zero policy data.
  store.update((state) => {
    const totalVotes =
      (state.governance.votes.neutral ?? 0) +
      (state.governance.votes.cooperative ?? 0) +
      (state.governance.votes.aggressive ?? 0);
    if (totalVotes > 0) {
      return;
    }
    const firstAgentId = specs[0]?.agentId;
    if (!firstAgentId || !state.agents[firstAgentId]) {
      return;
    }
    actionEngine.resolve(state, { agentId: firstAgentId, action: "vote", votePolicy: "neutral" });
  });

  const enteredCount = results.filter((result) => result.ok).length;
  console.log(`Bootstrap default agents completed: ${enteredCount}/${specs.length} entries accepted`);
}

function parseBootstrapAgents(): Array<{ agentId: string; walletAddress: string }> {
  const raw = process.env.BOOTSTRAP_AGENT_SPECS?.trim();
  if (raw) {
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => {
        const [agentIdRaw, walletAddressRaw] = entry.split(":");
        const agentId = (agentIdRaw ?? "").trim();
        const walletAddress = (walletAddressRaw ?? `wallet_${agentId}`).trim();
        return { agentId, walletAddress };
      })
      .filter((entry) => entry.agentId.length > 0 && entry.walletAddress.length > 0);
  }

  return [
    { agentId: "ai_demo_1", walletAddress: "wallet_ai_demo_1" },
    { agentId: "ai_demo_2", walletAddress: "wallet_ai_demo_2" },
    { agentId: "ai_demo_3", walletAddress: "wallet_ai_demo_3" }
  ];
}
