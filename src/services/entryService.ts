import { AgentRegistry } from "../agents/agentRegistry.js";
import { PaymentGateway } from "../economy/paymentGateway.js";
import { EntryRequest, LocationId, WorldState } from "../interfaces/types.js";
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

    // Mirror entry fees into the world treasury wallet credits so the dashboard shows
    // a consistent economy (fees go somewhere, not just disappear).
    const treasuryAddress = worldTreasuryAddress();
    if (treasuryAddress && typeof receipt.amountMon === "number" && receipt.amountMon > 0) {
      const t = state.wallets[treasuryAddress] ?? { address: treasuryAddress, monBalance: 0 };
      t.monBalance = Number((t.monBalance + receipt.amountMon).toFixed(6));
      state.wallets[treasuryAddress] = t;
    }

    state.tick += 1;
    const spawnLocation = randomSpawnLocation();
    state.agents[request.agentId] = this.agentRegistry.create(request.agentId, request.walletAddress, spawnLocation);
    state.events.push(
      createEvent(
        state.events.length + 1,
        state.tick,
        request.agentId,
        "entry",
        `Agent entered at ${spawnLocation} by paying ${receipt.amountMon ?? "unknown"} MON (tx: ${receipt.txId ?? "n/a"})`
      )
    );
    return { ok: true, balance: receipt.balance, agentId: request.agentId, txId: receipt.txId };
  }
}

function worldTreasuryAddress(): string | null {
  const addr = (process.env.MON_TEST_TREASURY_ADDRESS ?? "").trim();
  if (addr.length > 0) return addr;
  // Wallet/provider demo modes: use a stable pseudo-address so it shows up in state.wallets.
  return "world_treasury";
}

function randomSpawnLocation(): LocationId {
  const locations: LocationId[] = ["town", "forest", "cavern"];
  return locations[Math.floor(Math.random() * locations.length)];
}
