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

const testStatePath = path.join(root, "data/state/sim-world.json");
const seedPath = path.join(root, "data/seeds/world.seed.json");

if (fs.existsSync(testStatePath)) fs.unlinkSync(testStatePath);

const store = new StateStore(testStatePath);
store.initFromSeed(seedPath);

const entryService = new EntryService(new WalletPaymentGateway(new WalletService()), new AgentRegistry());
const actionEngine = new ActionEngine();

const wallets = ["w1", "w2", "w3"];
for (const wallet of wallets) {
  store.update((state) => {
    state.wallets[wallet] = { address: wallet, monBalance: 20 };
  });
}

for (let i = 0; i < 3; i += 1) {
  const agentId = `agent_${i + 1}`;
  const walletAddress = wallets[i];
  store.update((state) => {
    const enter = entryService.enter(state, { agentId, walletAddress });
    assert.equal(enter.ok, true);
  });
}

const plans = [
  { agentId: "agent_1", steps: ["move", "gather", "rest"] as const },
  { agentId: "agent_2", steps: ["move", "move", "gather"] as const },
  { agentId: "agent_3", steps: ["rest", "move", "gather"] as const }
];

for (const plan of plans) {
  for (const step of plan.steps) {
    store.update((state) => {
      if (step === "move") {
        const current = state.agents[plan.agentId].location;
        const target = current === "town" ? "forest" : "town";
        actionEngine.resolve(state, { agentId: plan.agentId, action: "move", target });
        return;
      }
      actionEngine.resolve(state, { agentId: plan.agentId, action: step });
    });
  }
}

const finalState = store.read();
assert.equal(Object.keys(finalState.agents).length >= 3, true);
assert.equal(finalState.tick > 0, true);
assert.equal(finalState.events.length > 0, true);

console.log("multi-agent simulation passed", {
  tick: finalState.tick,
  eventCount: finalState.events.length,
  agents: Object.keys(finalState.agents)
});
