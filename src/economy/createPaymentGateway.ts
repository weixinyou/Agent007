import { HttpMonTestnetRpcClient } from "./monTestnetRpcClient.js";
import { MonTestnetPaymentGateway } from "./monTestnetPaymentGateway.js";
import { HttpPaymentProviderClient } from "./httpPaymentProviderClient.js";
import { PaymentGateway } from "./paymentGateway.js";
import { ProviderPaymentGateway } from "./providerPaymentGateway.js";
import { StubProviderPaymentClient } from "./providerPaymentClient.js";
import { WalletPaymentGateway } from "./walletPaymentGateway.js";
import { WalletService } from "./walletService.js";

export interface PaymentGatewaySelection {
  gateway: PaymentGateway;
  paymentMode: "wallet" | "provider" | "mon-testnet";
}

export function createPaymentGateway(walletService: WalletService): PaymentGatewaySelection {
  const mode = (process.env.PAYMENT_BACKEND ?? "wallet").toLowerCase();

  if (mode === "wallet") {
    return { gateway: new WalletPaymentGateway(walletService), paymentMode: "wallet" };
  }

  if (mode === "mon-testnet") {
    const rpcUrl = process.env.MON_TEST_RPC_URL;
    const treasuryAddress = process.env.MON_TEST_TREASURY_ADDRESS;
    if (!rpcUrl || !treasuryAddress) {
      throw new Error("mon-testnet backend requires MON_TEST_RPC_URL and MON_TEST_TREASURY_ADDRESS");
    }

    const rpcTimeoutMs = parseInt(process.env.MON_TEST_RPC_TIMEOUT_MS ?? "2000", 10);
    const rpcRetries = parseInt(process.env.MON_TEST_RPC_RETRIES ?? "2", 10);
    const confirmations = parseInt(process.env.MON_TEST_MIN_CONFIRMATIONS ?? "2", 10);
    const decimals = parseInt(process.env.MON_TEST_DECIMALS ?? "18", 10);
    const entryFeeMon = parseFloat(process.env.MON_TEST_ENTRY_FEE_MON ?? "2");
    const entryContractAddress = process.env.MON_TEST_ENTRY_CONTRACT_ADDRESS;
    const entryContractMethodSelector = process.env.MON_TEST_ENTRY_CONTRACT_METHOD_SELECTOR;

    return {
      gateway: new MonTestnetPaymentGateway(
        new HttpMonTestnetRpcClient(
          rpcUrl,
          Number.isNaN(rpcTimeoutMs) ? 2000 : Math.max(300, rpcTimeoutMs),
          Number.isNaN(rpcRetries) ? 2 : Math.max(0, rpcRetries)
        ),
        {
          treasuryAddress,
          requiredConfirmations: Number.isNaN(confirmations) ? 2 : Math.max(1, confirmations),
          expectedChainIdHex: process.env.MON_TEST_CHAIN_ID_HEX,
          decimals: Number.isNaN(decimals) ? 18 : Math.max(0, decimals),
          entryFeeMon: Number.isNaN(entryFeeMon) ? 2 : Math.max(0, entryFeeMon),
          entryContractAddress: entryContractAddress && entryContractAddress.length > 0 ? entryContractAddress : undefined,
          entryContractMethodSelector:
            entryContractMethodSelector && entryContractMethodSelector.length > 0 ? entryContractMethodSelector : undefined
        }
      ),
      paymentMode: "mon-testnet"
    };
  }

  if (mode !== "provider") {
    throw new Error(`Unsupported PAYMENT_BACKEND '${mode}'. Expected wallet, provider, or mon-testnet.`);
  }

  const providerUrl = process.env.PAYMENT_PROVIDER_URL;
  const retries = parseInt(process.env.PAYMENT_PROVIDER_RETRIES ?? "2", 10);
  const timeoutMs = parseInt(process.env.PAYMENT_PROVIDER_TIMEOUT_MS ?? "1500", 10);

  if (providerUrl && providerUrl.length > 0) {
    const client = new HttpPaymentProviderClient({
      baseUrl: providerUrl,
      apiKey: process.env.PAYMENT_PROVIDER_API_KEY,
      retries: Number.isNaN(retries) ? 2 : Math.max(0, retries),
      timeoutMs: Number.isNaN(timeoutMs) ? 1500 : Math.max(200, timeoutMs)
    });

    return {
      gateway: new ProviderPaymentGateway(walletService, client),
      paymentMode: "provider"
    };
  }

  return {
    gateway: new ProviderPaymentGateway(walletService, new StubProviderPaymentClient()),
    paymentMode: "provider"
  };
}
