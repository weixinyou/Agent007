import { ENTRY_FEE_MON } from "../interfaces/protocol.js";
import { EntryRequest, WorldState } from "../interfaces/types.js";
import { PaymentGateway, PaymentReceipt } from "./paymentGateway.js";
import { ProviderPaymentClient } from "./providerPaymentClient.js";
import { WalletService } from "./walletService.js";

export class ProviderPaymentGateway implements PaymentGateway {
  constructor(
    private readonly walletService: WalletService,
    private readonly providerClient: ProviderPaymentClient
  ) {}

  chargeEntryFee(state: WorldState, request: EntryRequest): PaymentReceipt {
    const wallet = this.walletService.ensureWallet(state.wallets, request.walletAddress);
    if (wallet.monBalance < ENTRY_FEE_MON) {
      return { ok: false, reason: "Insufficient MON for entry fee", balance: wallet.monBalance };
    }

    const providerResult = this.providerClient.chargeEntry({
      walletAddress: request.walletAddress,
      amountMon: ENTRY_FEE_MON,
      metadata: {
        tick: String(state.tick)
      }
    });

    if (!providerResult.ok) {
      return { ok: false, reason: providerResult.reason ?? "Payment provider rejected charge", balance: wallet.monBalance };
    }

    const debited = this.walletService.debit(wallet, ENTRY_FEE_MON);
    if (!debited) {
      return { ok: false, reason: "Insufficient MON for entry fee", balance: wallet.monBalance };
    }

    return {
      ok: true,
      balance: wallet.monBalance,
      amountMon: ENTRY_FEE_MON,
      txId: providerResult.txId ?? `provider_tx_${Date.now()}`
    };
  }
}
