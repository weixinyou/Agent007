import crypto from "node:crypto";
import http from "node:http";

export interface SignatureCheckResult {
  ok: boolean;
  reason?: string;
}

export class SignatureAuthService {
  private readonly maxSkewSec: number;

  constructor(
    private readonly secret: string | undefined,
    maxSkewSec: number = Number(process.env.AGENT007_HMAC_MAX_SKEW_SEC ?? "300")
  ) {
    this.maxSkewSec = Number.isFinite(maxSkewSec) && maxSkewSec > 0 ? maxSkewSec : 300;
  }

  requiresSignature(): boolean {
    return Boolean(this.secret);
  }

  verify(req: http.IncomingMessage, pathname: string, rawBody: string): SignatureCheckResult {
    if (!this.secret) {
      return { ok: true };
    }

    const signature = req.headers["x-signature"];
    const timestampRaw = req.headers["x-timestamp"];

    if (typeof signature !== "string" || signature.length === 0) {
      return { ok: false, reason: "Missing x-signature" };
    }

    if (typeof timestampRaw !== "string" || timestampRaw.length === 0) {
      return { ok: false, reason: "Missing x-timestamp" };
    }

    const timestamp = Number(timestampRaw);
    if (!Number.isFinite(timestamp)) {
      return { ok: false, reason: "Invalid x-timestamp" };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - timestamp) > this.maxSkewSec) {
      return { ok: false, reason: "Timestamp outside allowed skew" };
    }

    const method = req.method ?? "";
    const payload = `${method}\n${pathname}\n${timestampRaw}\n${rawBody}`;
    const expected = crypto.createHmac("sha256", this.secret).update(payload).digest("hex");

    if (!safeEqual(signature, expected)) {
      return { ok: false, reason: "Invalid signature" };
    }

    return { ok: true };
  }
}

function safeEqual(incoming: string, expected: string): boolean {
  const a = Buffer.from(incoming);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}
