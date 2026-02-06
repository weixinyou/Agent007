import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AutoAgentService } from "../../src/agents/autoAgentService.js";
import { AiEnabledAgentService } from "../../src/agents/aiEnabledAgentService.js";
import { ActionEngine } from "../../src/engine/actionEngine.js";
import { ActionRequest } from "../../src/interfaces/types.js";
import { StateStore } from "../../src/persistence/stateStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../../");
const tmpState = path.join(root, "data/state/test-mixed-agent-world.json");
const seedPath = path.join(root, "data/seeds/world.seed.json");

class MockAiProvider {
  constructor(private readonly planner: () => ActionRequest) {}

  async decide(): Promise<{ request: ActionRequest; reasoning?: string }> {
    return { request: this.planner(), reasoning: "Gathering improves inventory efficiency." };
  }
}

cleanupStateFiles(tmpState);

const store = new StateStore(tmpState);
store.initFromSeed(seedPath);
store.update((state) => {
  state.wallets.w_rule = { address: "w_rule", monBalance: 0.4 };
  state.wallets.w_ai = { address: "w_ai", monBalance: 0.4 };
  state.agents.rule_1 = {
    id: "rule_1",
    walletAddress: "w_rule",
    enteredAt: new Date().toISOString(),
    location: "town",
    energy: 8,
    inventory: {},
    reputation: 0
  };
  state.agents.ai_1 = {
    id: "ai_1",
    walletAddress: "w_ai",
    enteredAt: new Date().toISOString(),
    location: "town",
    energy: 8,
    inventory: {},
    reputation: 0
  };
});

const engine = new ActionEngine();
const auto = new AutoAgentService(store, engine, {
  enabled: true,
  intervalMs: 20,
  actionsPerCycle: 1,
  minActionDelayMs: 1,
  maxActionDelayMs: 60,
  shouldControlAgent: (agentId) => agentId === "rule_1"
});

const ai = new AiEnabledAgentService(
  store,
  engine,
  new MockAiProvider(() => ({ agentId: "ai_1", action: "gather" })),
  {
    enabled: true,
    intervalMs: 20,
    actionsPerCycle: 1,
    minAiCallIntervalMs: 1,
    minActionDelayMs: 1,
    maxActionDelayMs: 60,
    maxRecentEvents: 8,
    shouldControlAgent: (agentId) => agentId === "ai_1"
  }
);

auto.start();
ai.start();

try {
  await waitFor(() => {
    const s = store.read();
    const recent = s.events.slice(-20);
    const ruleHasEvent = recent.some((ev) => ev.agentId === "rule_1" && ev.type !== "ai_reasoning");
    const aiHasReason = recent.some((ev) => ev.agentId === "ai_1" && ev.type === "ai_reasoning");
    return ruleHasEvent && aiHasReason;
  }, 3000);
} finally {
  auto.stop();
  ai.stop();
}

const state = store.read();
const recent = state.events.slice(-40);
assert.equal(recent.some((ev) => ev.agentId === "rule_1" && ev.type !== "ai_reasoning"), true);
assert.equal(recent.some((ev) => ev.agentId === "ai_1" && ev.type === "ai_reasoning"), true);

console.log("mixed agent mode integration passed", {
  tick: state.tick,
  events: state.events.length
});

function cleanupStateFiles(statePath: string): void {
  if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  const lockPath = `${statePath}.lock`;
  if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms`);
    }
    await sleep(25);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
