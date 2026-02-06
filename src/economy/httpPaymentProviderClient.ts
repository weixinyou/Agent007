import { execFileSync } from "node:child_process";
import { ProviderChargeRequest, ProviderChargeResult, ProviderPaymentClient } from "./providerPaymentClient.js";

interface HttpProviderConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  retries: number;
}

export class HttpPaymentProviderClient implements ProviderPaymentClient {
  constructor(private readonly config: HttpProviderConfig) {}

  chargeEntry(request: ProviderChargeRequest): ProviderChargeResult {
    const errors: string[] = [];

    for (let attempt = 1; attempt <= this.config.retries + 1; attempt += 1) {
      const result = this.tryOnce(request);
      if (result.ok) {
        return result;
      }

      errors.push(result.reason ?? `attempt ${attempt} failed`);
    }

    return { ok: false, reason: errors.join(" | ") };
  }

  private tryOnce(request: ProviderChargeRequest): ProviderChargeResult {
    const payload = JSON.stringify(request);
    const headers = ["content-type: application/json"];
    if (this.config.apiKey) {
      headers.push(`authorization: bearer ${this.config.apiKey}`);
    }

    const args = [
      "-sS",
      "-X",
      "POST",
      `${this.config.baseUrl.replace(/\/$/, "")}/charge-entry`,
      "--max-time",
      String(Math.max(1, Math.ceil(this.config.timeoutMs / 1000))),
      ...headers.flatMap((header) => ["-H", header]),
      "-d",
      payload
    ];

    try {
      const raw = execFileSync("curl", args, { encoding: "utf-8" });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.ok !== true) {
        return { ok: false, reason: String(parsed.reason ?? "provider rejected charge") };
      }

      const txId = typeof parsed.txId === "string" && parsed.txId.length > 0 ? parsed.txId : undefined;
      return { ok: true, txId };
    } catch (error) {
      return { ok: false, reason: `provider http error: ${error}` };
    }
  }
}
