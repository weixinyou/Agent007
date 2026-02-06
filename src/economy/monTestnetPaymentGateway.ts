import { EntryRequest, WorldState } from "../interfaces/types.js";
import { PaymentGateway, PaymentReceipt } from "./paymentGateway.js";
import { MonTestnetRpcClient } from "./monTestnetRpcClient.js";

export interface MonTestnetGatewayConfig {
  treasuryAddress: string;
  requiredConfirmations: number;
  expectedChainIdHex?: string;
  entryFeeMon: number;
  decimals: number;
  entryContractAddress?: string;
  entryContractMethodSelector?: string;
}

export class MonTestnetPaymentGateway implements PaymentGateway {
  constructor(
    private readonly rpcClient: MonTestnetRpcClient,
    private readonly config: MonTestnetGatewayConfig
  ) {}

  chargeEntryFee(state: WorldState, request: EntryRequest): PaymentReceipt {
    const txHash = request.paymentTxHash?.toLowerCase();
    if (!txHash) {
      return { ok: false, reason: "paymentTxHash is required for mon-testnet backend" };
    }

    if (state.processedPaymentTxHashes.includes(txHash)) {
      return { ok: false, reason: "paymentTxHash has already been used" };
    }

    const tx = this.rpcClient.getTransactionByHash(txHash);
    if (!tx) {
      return { ok: false, reason: "transaction not found on mon testnet" };
    }

    const receipt = this.rpcClient.getTransactionReceipt(txHash);
    if (!receipt) {
      return { ok: false, reason: "transaction is pending confirmation" };
    }

    if (receipt.status !== "0x1") {
      return { ok: false, reason: "transaction failed on-chain" };
    }

    const expectedFrom = request.walletAddress.toLowerCase();
    if ((tx.from ?? "").toLowerCase() !== expectedFrom) {
      return { ok: false, reason: "transaction sender does not match walletAddress" };
    }

    const expectedDestination = (this.config.entryContractAddress ?? this.config.treasuryAddress).toLowerCase();
    const txTo = (tx.to ?? receipt.to ?? "").toLowerCase();
    if (txTo !== expectedDestination) {
      const targetLabel = this.config.entryContractAddress ? "entry contract address" : "treasury address";
      return { ok: false, reason: `transaction recipient does not match ${targetLabel}` };
    }

    if (this.config.entryContractAddress && this.config.entryContractMethodSelector) {
      const selector = normalizeSelector(this.config.entryContractMethodSelector);
      const input = (tx.input ?? "").toLowerCase();
      if (!input.startsWith(selector)) {
        return { ok: false, reason: "transaction does not call expected entry contract method" };
      }
    }

    if (this.config.expectedChainIdHex) {
      const txChainId = (tx.chainId ?? "").toLowerCase();
      const expectedChainId = this.config.expectedChainIdHex.toLowerCase();
      if (txChainId && txChainId !== expectedChainId) {
        return { ok: false, reason: "transaction chain id mismatch" };
      }
    }

    const valueWei = BigInt(tx.value);
    const requiredWei = this.monToWeiBigInt(this.config.entryFeeMon, this.config.decimals);
    if (valueWei < requiredWei) {
      return { ok: false, reason: `insufficient on-chain amount, required ${this.config.entryFeeMon} MON` };
    }

    const latestBlock = this.rpcClient.getBlockNumber();
    const txBlock = BigInt(receipt.blockNumber);
    const confirmations = latestBlock - txBlock + 1n;
    if (confirmations < BigInt(this.config.requiredConfirmations)) {
      return {
        ok: false,
        reason: `insufficient confirmations: ${confirmations}/${this.config.requiredConfirmations}`
      };
    }

    return {
      ok: true,
      txHash,
      txId: txHash,
      amountMon: this.config.entryFeeMon
    };
  }

  private monToWeiBigInt(amountMon: number, decimals: number): bigint {
    const [wholeRaw, fractionRaw = ""] = amountMon.toString().split(".");
    const whole = BigInt(wholeRaw);
    const fractionPadded = (fractionRaw + "0".repeat(decimals)).slice(0, decimals);
    const fraction = BigInt(fractionPadded || "0");
    return whole * 10n ** BigInt(decimals) + fraction;
  }
}

function normalizeSelector(selector: string): string {
  const trimmed = selector.trim().toLowerCase();
  if (!/^0x[0-9a-f]{8}$/.test(trimmed)) {
    throw new Error("entryContractMethodSelector must be 4-byte hex selector (0x????????)");
  }
  return trimmed;
}
