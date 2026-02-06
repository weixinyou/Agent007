import assert from "node:assert/strict";
import { ProviderPaymentGateway } from "../../src/economy/providerPaymentGateway.js";
import { ProviderPaymentClient } from "../../src/economy/providerPaymentClient.js";
import { WalletService } from "../../src/economy/walletService.js";
import { WorldState } from "../../src/interfaces/types.js";

const baseState: WorldState = {
  tick: 1,
  agents: {},
  wallets: {
    w1: { address: "w1", monBalance: 5 }
  },
  events: [],
  processedPaymentTxHashes: [],
  governance: {
    activePolicy: "neutral",
    votes: {
      neutral: 0,
      cooperative: 0,
      aggressive: 0
    }
  }
};

class AcceptClient implements ProviderPaymentClient {
  chargeEntry(): { ok: boolean; txId: string } {
    return { ok: true, txId: "provider_tx_ok" };
  }
}

class RejectClient implements ProviderPaymentClient {
  chargeEntry(): { ok: boolean; reason: string } {
    return { ok: false, reason: "provider unavailable" };
  }
}

const successState = structuredClone(baseState);
const okGateway = new ProviderPaymentGateway(new WalletService(), new AcceptClient());
const ok = okGateway.chargeEntryFee(successState, { agentId: "a1", walletAddress: "w1" });
assert.equal(ok.ok, true);
assert.equal(ok.txId, "provider_tx_ok");
assert.equal(successState.wallets.w1.monBalance, 3);

const failState = structuredClone(baseState);
const failGateway = new ProviderPaymentGateway(new WalletService(), new RejectClient());
const fail = failGateway.chargeEntryFee(failState, { agentId: "a1", walletAddress: "w1" });
assert.equal(fail.ok, false);
assert.equal(fail.reason, "provider unavailable");
assert.equal(failState.wallets.w1.monBalance, 5);

console.log("provider gateway checks passed");
