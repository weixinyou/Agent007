import { Wallet } from "../interfaces/types.js";

// Default initial balance is intentionally small so demos can create many wallets cheaply.
const rawInitialBalanceMon = Number(process.env.WALLET_INITIAL_BALANCE_MON ?? "0.001");
const DEFAULT_WALLET_INITIAL_BALANCE_MON =
  Number.isFinite(rawInitialBalanceMon) && rawInitialBalanceMon >= 0 ? rawInitialBalanceMon : 0.001;

export class WalletService {
  ensureWallet(wallets: Record<string, Wallet>, address: string): Wallet {
    if (!wallets[address]) {
      wallets[address] = { address, monBalance: DEFAULT_WALLET_INITIAL_BALANCE_MON };
    }

    return wallets[address];
  }

  debit(wallet: Wallet, amount: number): boolean {
    if (wallet.monBalance < amount) {
      return false;
    }

    wallet.monBalance -= amount;
    return true;
  }

  credit(wallet: Wallet, amount: number): void {
    wallet.monBalance += amount;
  }
}
