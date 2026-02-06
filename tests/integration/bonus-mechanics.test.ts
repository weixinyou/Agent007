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

const tmpState = path.join(root, "data/state/test-bonus-world.json");
const seedPath = path.join(root, "data/seeds/world.seed.json");

if (fs.existsSync(tmpState)) fs.unlinkSync(tmpState);

const store = new StateStore(tmpState);
const state = store.initFromSeed(seedPath);
const entryService = new EntryService(new WalletPaymentGateway(new WalletService()), new AgentRegistry());
const actionEngine = new ActionEngine();

state.wallets.w1 = { address: "w1", monBalance: 20 };
state.wallets.w2 = { address: "w2", monBalance: 20 };

assert.equal(entryService.enter(state, { agentId: "a1", walletAddress: "w1" }).ok, true);
assert.equal(entryService.enter(state, { agentId: "a2", walletAddress: "w2" }).ok, true);

state.agents.a1.location = "forest";
state.agents.a2.location = "forest";
state.agents.a1.inventory = { wood: 3, herb: 2 };
state.agents.a2.inventory = { ore: 4 };
state.agents.a1.reputation = 6;

const vote = actionEngine.resolve(state, { agentId: "a1", action: "vote", votePolicy: "cooperative" });
assert.equal(vote.ok, true);
assert.equal(state.governance.activePolicy, "cooperative");

const trade = await resolveWithRetry(() =>
  actionEngine.resolve(state, {
  agentId: "a1",
  action: "trade",
  targetAgentId: "a2",
  itemGive: "wood",
  qtyGive: 2,
  itemTake: "ore",
  qtyTake: 2
  })
);
assert.equal(trade.ok, true);
assert.equal((state.agents.a1.inventory.ore ?? 0) >= 2, true);
assert.equal((state.agents.a2.inventory.wood ?? 0) >= 2, true);

const beforeAttackEnergy = state.agents.a2.energy;
const attack = await resolveWithRetry(() => actionEngine.resolve(state, { agentId: "a1", action: "attack", targetAgentId: "a2" }));
assert.equal(attack.ok, true);
assert.equal(state.agents.a2.energy < beforeAttackEnergy, true);

const beforeClaimBalance = state.wallets.w1.monBalance;
const claim = await resolveWithRetry(() => actionEngine.resolve(state, { agentId: "a1", action: "claim" }));
assert.equal(claim.ok, true);
assert.equal(state.wallets.w1.monBalance > beforeClaimBalance, true);

console.log("bonus mechanics passed", {
  policy: state.governance.activePolicy,
  a1Wallet: state.wallets.w1.monBalance,
  a1Inventory: state.agents.a1.inventory,
  a2Energy: state.agents.a2.energy
});

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
