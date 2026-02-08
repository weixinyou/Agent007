import assert from "node:assert/strict";
import { ProviderPaymentGateway } from "../../src/economy/providerPaymentGateway.js";
import { ProviderPaymentClient } from "../../src/economy/providerPaymentClient.js";
import { WalletService } from "../../src/economy/walletService.js";
import { WorldState } from "../../src/interfaces/types.js";
import { ENTRY_FEE_MON } from "../../src/interfaces/protocol.js";

const baseState: WorldState = {
  tick: 1,
  agents: {},
  wallets: {
    w1: { address: "w1", monBalance: 5 }
  },
  events: [],
  processedPaymentTxHashes: [],
  telemetry: {
    aiApi: { total: 0, success: 0, failed: 0 }
  },
  economy: {
    marketPricesMon: { wood: 0.000001, herb: 0.0000015, ore: 0.000002, crystal: 0.000003, coin: 0.0000008 },
    attackPenaltyMon: 0.000001,
    tradeReputationReward: 1,
    aidReputationReward: 2,
    governor: { lastEventIndex: 0, lastRunAt: "1970-01-01T00:00:00.000Z" }
  },
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
assert.equal(Number(successState.wallets.w1.monBalance.toFixed(6)), Number((5 - ENTRY_FEE_MON).toFixed(6)));

const failState = structuredClone(baseState);
const failGateway = new ProviderPaymentGateway(new WalletService(), new RejectClient());
const fail = failGateway.chargeEntryFee(failState, { agentId: "a1", walletAddress: "w1" });
assert.equal(fail.ok, false);
assert.equal(fail.reason, "provider unavailable");
assert.equal(failState.wallets.w1.monBalance, 5);

console.log("provider gateway checks passed");
