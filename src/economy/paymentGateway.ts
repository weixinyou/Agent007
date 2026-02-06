import { EntryRequest, WorldState } from "../interfaces/types.js";

export interface PaymentReceipt {
  ok: boolean;
  reason?: string;
  txId?: string;
  txHash?: string;
  amountMon?: number;
  balance?: number;
}

export interface PaymentGateway {
  chargeEntryFee(state: WorldState, request: EntryRequest): PaymentReceipt;
}
