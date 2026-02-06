import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentRegistry } from "../../src/agents/agentRegistry.js";
import { WalletPaymentGateway } from "../../src/economy/walletPaymentGateway.js";
import { WalletService } from "../../src/economy/walletService.js";
import { ActionEngine } from "../../src/engine/actionEngine.js";
import { StateStore } from "../../src/persistence/stateStore.js";
import { EntryService } from "../../src/services/entryService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../../");

const tmpState = path.join(root, "data/state/test-world.json");
const seedPath = path.join(root, "data/seeds/world.seed.json");

if (fs.existsSync(tmpState)) fs.unlinkSync(tmpState);

const store = new StateStore(tmpState);
const state = store.initFromSeed(seedPath);

const entryService = new EntryService(new WalletPaymentGateway(new WalletService()), new AgentRegistry());
const actionEngine = new ActionEngine();

const enter = entryService.enter(state, { agentId: "agent_a", walletAddress: "demo_wallet" });
assert.equal(enter.ok, true);
assert.equal(enter.agentId, "agent_a");
assert.equal(enter.balance, 23);

const move = actionEngine.resolve(state, { agentId: "agent_a", action: "move", target: "forest" });
assert.equal(move.ok, true);
assert.equal(move.location, "forest");

const gather = await resolveWithRetry(() => actionEngine.resolve(state, { agentId: "agent_a", action: "gather" }));
assert.equal(gather.ok, true);

assert.equal(state.agents.agent_a.location, "forest");
assert.ok(Object.keys(state.agents.agent_a.inventory).length > 0);
assert.equal(state.tick, 3);
assert.equal(state.events.length, 3);

const badMove = await resolveWithRetry(() => actionEngine.resolve(state, { agentId: "agent_a", action: "move", target: "town" }));
assert.equal(badMove.ok, true);

const noAgentAction = actionEngine.resolve(state, { agentId: "no_such_agent", action: "rest" });
assert.equal(noAgentAction.ok, false);

state.wallets.low = { address: "low", monBalance: 1 };
const lowFunds = entryService.enter(state, { agentId: "agent_b", walletAddress: "low" });
assert.equal(lowFunds.ok, false);
assert.equal(lowFunds.reason, "Insufficient MON for entry fee");

console.log("basic integration passed");

async function resolveWithRetry<T extends { ok: boolean; message: string }>(
  run: () => T,
  maxAttempts = 20
): Promise<T> {
  for (let i = 0; i < maxAttempts; i += 1) {
    const result = run();
    if (result.ok || !result.message.includes("Agent is planning")) {
      return result;
    }
    await sleep(1000);
  }
  return run();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
