import { ENTRY_FEE_MON } from "../interfaces/protocol.js";
import { EntryRequest, WorldState } from "../interfaces/types.js";
import { PaymentGateway, PaymentReceipt } from "./paymentGateway.js";
import { WalletService } from "./walletService.js";

export class WalletPaymentGateway implements PaymentGateway {
  constructor(private readonly walletService: WalletService) {}

  chargeEntryFee(state: WorldState, request: EntryRequest): PaymentReceipt {
    const wallet = this.walletService.ensureWallet(state.wallets, request.walletAddress);
    const paid = this.walletService.debit(wallet, ENTRY_FEE_MON);

    if (!paid) {
      return { ok: false, reason: "Insufficient MON for entry fee", balance: wallet.monBalance };
    }

    return {
      ok: true,
      balance: wallet.monBalance,
      amountMon: ENTRY_FEE_MON,
      txId: this.makeTxId(request.walletAddress, state.tick)
    };
  }

  private makeTxId(walletAddress: string, tick: number): string {
    const walletTag = walletAddress.slice(0, 8) || "wallet";
    return `tx_entry_${walletTag}_t${tick}_${Date.now()}`;
  }
}
