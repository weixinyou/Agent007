import { execFileSync } from "node:child_process";

interface JsonRpcResponse {
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export interface EvmTransaction {
  hash: string;
  from: string;
  to?: string | null;
  value: string;
  chainId?: string;
  input?: string;
}

export interface EvmTransactionReceipt {
  transactionHash: string;
  status: string;
  blockNumber: string;
  to?: string | null;
}

export interface MonTestnetRpcClient {
  getTransactionByHash(txHash: string): EvmTransaction | null;
  getTransactionReceipt(txHash: string): EvmTransactionReceipt | null;
  getBlockNumber(): bigint;
}

export class HttpMonTestnetRpcClient implements MonTestnetRpcClient {
  constructor(
    private readonly rpcUrl: string,
    private readonly timeoutMs: number,
    private readonly retries: number
  ) {}

  getTransactionByHash(txHash: string): EvmTransaction | null {
    return this.call("eth_getTransactionByHash", [txHash]) as EvmTransaction | null;
  }

  getTransactionReceipt(txHash: string): EvmTransactionReceipt | null {
    return this.call("eth_getTransactionReceipt", [txHash]) as EvmTransactionReceipt | null;
  }

  getBlockNumber(): bigint {
    const hex = this.call("eth_blockNumber", []) as string;
    if (typeof hex !== "string" || !hex.startsWith("0x")) {
      throw new Error("Invalid block number response from RPC");
    }
    return BigInt(hex);
  }

  private call(method: string, params: unknown[]): unknown {
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params
    });

    let lastError = "";
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const raw = execFileSync(
          "curl",
          [
            "-sS",
            "-X",
            "POST",
            this.rpcUrl,
            "-H",
            "content-type: application/json",
            "--max-time",
            String(Math.max(1, Math.ceil(this.timeoutMs / 1000))),
            "-d",
            payload
          ],
          { encoding: "utf-8" }
        );

        const parsed = JSON.parse(raw) as JsonRpcResponse;
        if (parsed.error) {
          lastError = `${parsed.error.code}:${parsed.error.message}`;
          continue;
        }

        return parsed.result ?? null;
      } catch (error) {
        lastError = `${error}`;
      }
    }

    throw new Error(`RPC call failed for ${method}: ${lastError}`);
  }
}
