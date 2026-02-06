import { ENTRY_FEE_MON } from "../interfaces/protocol.js";

export interface ProviderChargeRequest {
  walletAddress: string;
  amountMon: number;
  metadata?: Record<string, string>;
}

export interface ProviderChargeResult {
  ok: boolean;
  txId?: string;
  reason?: string;
}

export interface ProviderPaymentClient {
  chargeEntry(request: ProviderChargeRequest): ProviderChargeResult;
}

export class StubProviderPaymentClient implements ProviderPaymentClient {
  chargeEntry(request: ProviderChargeRequest): ProviderChargeResult {
    if (request.amountMon !== ENTRY_FEE_MON) {
      return { ok: false, reason: "Unsupported amount" };
    }

    return {
      ok: true,
      txId: `provider_stub_${request.walletAddress.slice(0, 8)}_${Date.now()}`
    };
  }
}
