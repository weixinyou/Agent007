import { spawnSync } from "node:child_process";

export interface MonSettlementConfig {
  rpcUrl: string;
  treasuryPrivateKey: string;
  agentPrivateKeysById?: Record<string, string>;
  gasLimit: number; // typically 21000 for value transfer
  gasPriceGwei: number; // legacy gas price baseline (will be bumped on low-fee errors)
  minConfirmations: number;
}

export interface PayoutResult {
  ok: boolean;
  txHash?: string;
  reason?: string;
}

type RpcResponse<T> = { jsonrpc: string; id: number; result?: T; error?: { code: number; message: string } };

export class MonSettlement {
  constructor(private readonly config: MonSettlementConfig) {}

  transferFromAgent(agentId: string, toAddress: string, amountMon: number): PayoutResult {
    const pk = this.config.agentPrivateKeysById?.[agentId];
    if (!pk) {
      return { ok: false, reason: "missing agent private key for on-chain transfer" };
    }
    return this.transferFromPrivateKey(pk, toAddress, amountMon, `agent:${agentId}`);
  }

  payout(toAddress: string, amountMon: number): PayoutResult {
    return this.transferFromPrivateKey(this.config.treasuryPrivateKey, toAddress, amountMon, "treasury");
  }

  private transferFromPrivateKey(privateKey: string, toAddress: string, amountMon: number, label: string): PayoutResult {
    try {
      if (!toAddress || typeof toAddress !== "string") {
        return { ok: false, reason: "invalid payout recipient" };
      }
      if (!Number.isFinite(amountMon) || amountMon <= 0) {
        return { ok: false, reason: "invalid payout amount" };
      }

      const fromAddress = mustCastWalletAddress(privateKey);
      const chainIdHex = rpcCallSync<string>(this.config.rpcUrl, "eth_chainId", []);
      const nonceHex = rpcCallSync<string>(this.config.rpcUrl, "eth_getTransactionCount", [fromAddress, "pending"]);

      const gasLimit = Math.max(21000, Math.floor(this.config.gasLimit));
      let gasPriceGwei = Math.max(1, Math.floor(this.config.gasPriceGwei));
      const maxAttempts = 5;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const rawTx = mustCastMkTx({
          to: toAddress,
          chainIdHex,
          nonceHex,
          gasLimit,
          gasPriceGwei,
          valueMon: amountMon,
          privateKey
        });

        const txHash = rpcCallSync<string>(this.config.rpcUrl, "eth_sendRawTransaction", [rawTx]);
        const ok = waitForConfirmationsSync(this.config.rpcUrl, txHash, Math.max(1, this.config.minConfirmations));
        if (ok) {
          return { ok: true, txHash };
        }
        return { ok: false, reason: "transaction failed on-chain" };
      }

      return { ok: false, reason: "payout failed after retries" };
    } catch (e) {
      const msg = String((e as any)?.message || e || "").trim();
      const feeTooLow =
        /transaction fee too low/i.test(msg) ||
        /fee too low/i.test(msg) ||
        /underpriced/i.test(msg) ||
        /max fee per gas less than block base fee/i.test(msg) ||
        /replacement transaction underpriced/i.test(msg);
      if (feeTooLow) {
        return { ok: false, reason: `transaction fee too low (${label})` };
      }
      return { ok: false, reason: msg.slice(0, 240) || `transfer failed (${label})` };
    }
  }
}

function mustCastWalletAddress(privateKey: string): string {
  const pk = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const res = spawnSync("cast", ["wallet", "address", "--private-key", pk], { encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`cast wallet address failed: ${(res.stderr || res.stdout || "").trim().slice(0, 200)}`);
  }
  return (res.stdout || "").trim();
}

function mustCastMkTx(args: {
  to: string;
  chainIdHex: string;
  nonceHex: string;
  gasLimit: number;
  gasPriceGwei: number;
  valueMon: number;
  privateKey: string;
}): string {
  const pk = args.privateKey.startsWith("0x") ? args.privateKey : `0x${args.privateKey}`;
  const chainIdDec = parseInt(args.chainIdHex, 16);
  const nonceDec = parseInt(args.nonceHex, 16);
  const res = spawnSync(
    "cast",
    [
      "mktx",
      "--legacy",
      "--chain",
      String(chainIdDec),
      "--nonce",
      String(nonceDec),
      "--gas-limit",
      String(args.gasLimit),
      "--gas-price",
      `${args.gasPriceGwei}gwei`,
      "--value",
      `${args.valueMon}ether`,
      "--private-key",
      pk,
      args.to
    ],
    { encoding: "utf8" }
  );
  if (res.status !== 0) {
    throw new Error(`cast mktx failed: ${(res.stderr || res.stdout || "").trim().slice(0, 240)}`);
  }
  const raw = (res.stdout || "").trim();
  if (!raw.startsWith("0x") || raw.length < 10) {
    throw new Error(`unexpected cast mktx output: ${raw.slice(0, 120)}`);
  }
  return raw;
}

function rpcCallSync<T>(rpcUrl: string, method: string, params: unknown[]): T {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const res = spawnSync("curl", ["-sS", rpcUrl, "-H", "content-type: application/json", "-d", body], { encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`rpc ${method} transport error: ${(res.stderr || "").trim().slice(0, 200)}`);
  }
  const json = JSON.parse(res.stdout || "{}") as RpcResponse<T>;
  if (json.error) {
    throw new Error(`rpc ${method} error: ${json.error.message}`);
  }
  if (json.result === undefined) {
    throw new Error(`rpc ${method} missing result`);
  }
  return json.result;
}

function waitForConfirmationsSync(rpcUrl: string, txHash: string, minConfirmations: number): boolean {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const receipt = rpcCallSync<any>(rpcUrl, "eth_getTransactionReceipt", [txHash]);
    if (receipt && receipt.blockNumber) {
      const bn = BigInt(receipt.blockNumber);
      const statusOk = String(receipt.status || "").toLowerCase() === "0x1";
      const latest = BigInt(rpcCallSync<string>(rpcUrl, "eth_blockNumber", []));
      const conf = latest - bn + 1n;
      if (conf >= BigInt(minConfirmations)) {
        return statusOk;
      }
    }
    sleepMsSync(1500);
  }
  throw new Error(`tx not confirmed in time: ${txHash}`);
}

function sleepMsSync(ms: number): void {
  // Node sync sleep
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
