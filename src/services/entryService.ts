import { AgentRegistry } from "../agents/agentRegistry.js";
import { PaymentGateway } from "../economy/paymentGateway.js";
import { EntryRequest, WorldState } from "../interfaces/types.js";
import { createEvent } from "../world/events/eventFactory.js";

export class EntryService {
  constructor(
    private readonly paymentGateway: PaymentGateway,
    private readonly agentRegistry: AgentRegistry
  ) {}

  enter(
    state: WorldState,
    request: EntryRequest
  ): { ok: boolean; reason?: string; balance?: number; agentId?: string; txId?: string } {
    if (state.agents[request.agentId]) {
      const wallet = state.wallets[request.walletAddress];
      return { ok: true, balance: wallet?.monBalance, agentId: request.agentId };
    }

    const receipt = this.paymentGateway.chargeEntryFee(state, request);
    if (!receipt.ok) {
      return { ok: false, reason: receipt.reason, balance: receipt.balance };
    }

    if (receipt.txHash) {
      state.processedPaymentTxHashes.push(receipt.txHash.toLowerCase());
    }

    if (!state.wallets[request.walletAddress]) {
      state.wallets[request.walletAddress] = {
        address: request.walletAddress,
        monBalance: receipt.balance ?? 0
      };
    } else if (receipt.balance !== undefined) {
      state.wallets[request.walletAddress].monBalance = receipt.balance;
    }

    state.tick += 1;
    state.agents[request.agentId] = this.agentRegistry.create(request.agentId, request.walletAddress);
    state.events.push(
      createEvent(
        state.events.length + 1,
        state.tick,
        request.agentId,
        "entry",
        `Agent entered by paying ${receipt.amountMon ?? "unknown"} MON (tx: ${receipt.txId ?? "n/a"})`
      )
    );
    return { ok: true, balance: receipt.balance, agentId: request.agentId, txId: receipt.txId };
  }
}
