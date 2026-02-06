import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AiEnabledAgentConfig, AiEnabledAgentService } from "../../src/agents/aiEnabledAgentService.js";
import { ActionEngine } from "../../src/engine/actionEngine.js";
import { ActionRequest } from "../../src/interfaces/types.js";
import { StateStore } from "../../src/persistence/stateStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../../");

const seedPath = path.join(root, "data/seeds/world.seed.json");
const config: AiEnabledAgentConfig = {
  enabled: true,
  intervalMs: 20,
  actionsPerCycle: 1,
  minAiCallIntervalMs: 1,
  minActionDelayMs: 1,
  maxActionDelayMs: 50,
  maxRecentEvents: 12
};

async function runAiDecisionCase(): Promise<void> {
  const tmpState = path.join(root, "data/state/test-ai-agent-world.json");
  cleanupStateFiles(tmpState);

  const store = new StateStore(tmpState);
  store.initFromSeed(seedPath);
  seedSingleAgent(store, "ai_ok", "w_ai_ok");
  const initialTick = store.read().tick;

  const mockAi = new MockAiProvider(() => ({ agentId: "ai_ok", action: "gather" }));
  const service = new AiEnabledAgentService(store, new ActionEngine(), mockAi, config);

  service.start();
  try {
    await waitFor(() => store.read().tick > initialTick, 2000);
  } finally {
    service.stop();
  }

  const next = store.read();
  assert.equal(mockAi.calls > 0, true);
  assert.equal(next.tick > initialTick, true);
  assert.equal(next.events[next.events.length - 1]?.agentId, "ai_ok");
}

async function runAiFallbackCase(): Promise<void> {
  const tmpState = path.join(root, "data/state/test-ai-agent-fallback-world.json");
  cleanupStateFiles(tmpState);

  const store = new StateStore(tmpState);
  store.initFromSeed(seedPath);
  seedSingleAgent(store, "ai_fail", "w_ai_fail");
  const initialTick = store.read().tick;

  const throwingAi = new MockAiProvider(() => {
    throw new Error("simulated ai failure");
  });
  const service = new AiEnabledAgentService(store, new ActionEngine(), throwingAi, config);

  service.start();
  try {
    await waitFor(() => store.read().tick > initialTick, 2000);
  } finally {
    service.stop();
  }

  const next = store.read();
  assert.equal(throwingAi.calls > 0, true);
  assert.equal(next.tick > initialTick, true);
  assert.equal(next.events[next.events.length - 1]?.agentId, "ai_fail");
}

function seedSingleAgent(store: StateStore, agentId: string, walletAddress: string): void {
  const state = store.read();
  state.wallets[walletAddress] = { address: walletAddress, monBalance: 0 };
  state.agents[agentId] = {
    id: agentId,
    walletAddress,
    enteredAt: new Date().toISOString(),
    location: "town",
    energy: 6,
    inventory: {},
    reputation: 0
  };
  store.write(state);
}

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
    await sleep(20);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class MockAiProvider {
  calls = 0;

  constructor(private readonly planner: () => ActionRequest) {}

  async decide(): Promise<{ request: ActionRequest; reasoning?: string }> {
    this.calls += 1;
    return { request: this.planner(), reasoning: "mock decision" };
  }
}

await runAiDecisionCase();
await runAiFallbackCase();

console.log("ai agent mode integration passed");
