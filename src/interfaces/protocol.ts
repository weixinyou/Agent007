// Default entry fee is intentionally small so reviewers can spawn many agents cheaply.
const rawEntryFeeMon = Number(process.env.ENTRY_FEE_MON ?? "0.0001");
export const ENTRY_FEE_MON = Number.isFinite(rawEntryFeeMon) && rawEntryFeeMon > 0 ? rawEntryFeeMon : 0.0001;

export const API_PROTOCOL = {
  version: "v1",
  entryFeeMon: ENTRY_FEE_MON,
  actions: ["move", "gather", "rest", "trade", "attack", "vote", "claim"] as const,
  auth: {
    apiKey: {
      mode: "optional-header",
      header: "x-api-key",
      envVar: "AGENT007_API_KEY"
    },
    signature: {
      mode: "optional-hmac-sha256",
      headers: ["x-timestamp", "x-signature"] as const,
      envVar: "AGENT007_HMAC_SECRET",
      maxSkewEnvVar: "AGENT007_HMAC_MAX_SKEW_SEC",
      signingString: "METHOD\\nPATHNAME\\nTIMESTAMP\\nRAW_BODY",
      digestFormat: "hex"
    }
  },
  persistence: {
    default: "json",
    envVar: "WORLD_STORE",
    supported: ["json", "sqlite"] as const
  },
  payments: {
    backendEnvVar: "PAYMENT_BACKEND",
    supportedBackends: ["wallet", "provider", "mon-testnet"] as const,
    monTestnet: {
      rpcUrlEnvVar: "MON_TEST_RPC_URL",
      treasuryAddressEnvVar: "MON_TEST_TREASURY_ADDRESS",
      chainIdEnvVar: "MON_TEST_CHAIN_ID_HEX",
      minConfirmationsEnvVar: "MON_TEST_MIN_CONFIRMATIONS",
      decimalsEnvVar: "MON_TEST_DECIMALS",
      entryFeeEnvVar: "MON_TEST_ENTRY_FEE_MON",
      entryContractAddressEnvVar: "MON_TEST_ENTRY_CONTRACT_ADDRESS",
      entryContractMethodSelectorEnvVar: "MON_TEST_ENTRY_CONTRACT_METHOD_SELECTOR",
      txHashField: "paymentTxHash"
    },
    wallet: {
      entryFeeEnvVar: "ENTRY_FEE_MON",
      initialBalanceEnvVar: "WALLET_INITIAL_BALANCE_MON"
    },
    provider: {
      urlEnvVar: "PAYMENT_PROVIDER_URL",
      apiKeyEnvVar: "PAYMENT_PROVIDER_API_KEY",
      timeoutEnvVar: "PAYMENT_PROVIDER_TIMEOUT_MS",
      retriesEnvVar: "PAYMENT_PROVIDER_RETRIES",
      endpoint: "POST /charge-entry",
      entryFeeEnvVar: "ENTRY_FEE_MON",
      initialBalanceEnvVar: "WALLET_INITIAL_BALANCE_MON"
    }
  },
  endpoints: {
    health: "GET /health",
    protocol: "GET /protocol",
    dashboard: "GET /dashboard",
    events: "GET /events (SSE)",
    state: "GET /state",
    metrics: "GET /metrics",
    agentById: "GET /agents/:id",
    entry: "POST /entry",
    entryCheck: "POST /entry/check",
    action: "POST /action",
    snapshot: "POST /snapshot"
  }
};
