import assert from "node:assert/strict";
import crypto from "node:crypto";
import { SignatureAuthService } from "../../src/services/signatureAuthService.js";

const service = new SignatureAuthService("test-secret", 300);

const method = "POST";
const pathname = "/entry";
const timestamp = `${Math.floor(Date.now() / 1000)}`;
const rawBody = JSON.stringify({ agentId: "a1", walletAddress: "w1" });

const payload = `${method}\n${pathname}\n${timestamp}\n${rawBody}`;
const signature = crypto.createHmac("sha256", "test-secret").update(payload).digest("hex");

const okReq = {
  method,
  headers: {
    "x-timestamp": timestamp,
    "x-signature": signature
  }
} as never;

const ok = service.verify(okReq, pathname, rawBody);
assert.equal(ok.ok, true);

const badReq = {
  method,
  headers: {
    "x-timestamp": timestamp,
    "x-signature": "deadbeef"
  }
} as never;

const bad = service.verify(badReq, pathname, rawBody);
assert.equal(bad.ok, false);
assert.equal(bad.reason, "Invalid signature");

const staleReq = {
  method,
  headers: {
    "x-timestamp": "1",
    "x-signature": signature
  }
} as never;

const stale = service.verify(staleReq, pathname, rawBody);
assert.equal(stale.ok, false);

console.log("signature auth checks passed");
