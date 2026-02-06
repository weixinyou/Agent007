import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentRegistry } from "../../src/agents/agentRegistry.js";
import { createAppServer } from "../../src/api/app.js";
import { PaymentGateway, PaymentReceipt } from "../../src/economy/paymentGateway.js";
import { EntryRequest, WorldState, parseWorldState } from "../../src/interfaces/types.js";
import { StateStore } from "../../src/persistence/stateStore.js";
import { SnapshotStore } from "../../src/persistence/snapshotStore.js";
import { AuthService } from "../../src/services/authService.js";
import { EntryService } from "../../src/services/entryService.js";
import { SignatureAuthService } from "../../src/services/signatureAuthService.js";
import { ActionEngine } from "../../src/engine/actionEngine.js";

class FakeMonGateway implements PaymentGateway {
  chargeEntryFee(state: WorldState, request: EntryRequest): PaymentReceipt {
    const txHash = request.paymentTxHash?.toLowerCase();
    if (!txHash) {
      return { ok: false, reason: "paymentTxHash is required for mon-testnet backend" };
    }

    if (state.processedPaymentTxHashes.includes(txHash)) {
      return { ok: false, reason: "paymentTxHash has already been used" };
    }

    if (txHash.endsWith("1")) {
      return { ok: false, reason: "transaction is pending confirmation" };
    }

    if (txHash.endsWith("2")) {
      return { ok: false, reason: "insufficient confirmations: 1/2" };
    }

    if (txHash.endsWith("3")) {
      return { ok: false, reason: "transaction failed on-chain" };
    }

    return { ok: true, txId: txHash, txHash };
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../../");
const seedPath = path.join(root, "data/seeds/world.seed.json");
const tmpState = path.join(root, "data/state/test-entry-check-world.json");

if (fs.existsSync(tmpState)) fs.unlinkSync(tmpState);

const store = new StateStore(tmpState);
store.initFromSeed(seedPath);

const server = createAppServer({
  store,
  snapshotStore: new SnapshotStore(path.join(root, "data/snapshots")),
  entryService: new EntryService(new FakeMonGateway(), new AgentRegistry()),
  actionEngine: new ActionEngine(),
  authService: new AuthService(undefined),
  signatureAuthService: new SignatureAuthService(undefined),
  storeMode: "json",
  paymentMode: "mon-testnet"
});

const port = await listenOnRandomPort(server);

try {
  const base = { agentId: "check_agent", walletAddress: "0x1111111111111111111111111111111111111111" };

  const pending = await requestJson(port, "POST", "/entry/check", {
    ...base,
    paymentTxHash: "0x" + "a".repeat(63) + "1"
  });
  assert.equal(pending.statusCode, 200);
  assert.equal(pending.body.status, "pending");

  const pending2 = await requestJson(port, "POST", "/entry/check", {
    ...base,
    paymentTxHash: "0x" + "a".repeat(63) + "2"
  });
  assert.equal(pending2.statusCode, 200);
  assert.equal(pending2.body.status, "pending");

  const failed = await requestJson(port, "POST", "/entry/check", {
    ...base,
    paymentTxHash: "0x" + "a".repeat(63) + "3"
  });
  assert.equal(failed.statusCode, 200);
  assert.equal(failed.body.status, "failed");

  const confirmedCheck = await requestJson(port, "POST", "/entry/check", {
    ...base,
    paymentTxHash: "0x" + "b".repeat(64)
  });
  assert.equal(confirmedCheck.statusCode, 200);
  assert.equal(confirmedCheck.body.status, "confirmed");

  const stateAfterCheck = parseWorldState((await requestJson(port, "GET", "/state")).body);
  assert.equal(Object.keys(stateAfterCheck.agents).includes("check_agent"), false);

  const entered = await requestJson(port, "POST", "/entry", {
    ...base,
    paymentTxHash: "0x" + "b".repeat(64)
  });
  assert.equal(entered.statusCode, 200);
  assert.equal(entered.body.ok, true);

  const replay = await requestJson(port, "POST", "/entry/check", {
    ...base,
    agentId: "check_agent_2",
    paymentTxHash: "0x" + "b".repeat(64)
  });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.status, "failed");

  console.log("entry check e2e passed", { port });
} finally {
  await closeServer(server);
}

function listenOnRandomPort(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to bind test server"));
        return;
      }
      resolve(address.port);
    });
    server.once("error", reject);
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function requestJson(
  port: number,
  method: "GET" | "POST",
  pathname: string,
  payload?: unknown
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const bodyRaw = payload === undefined ? "" : JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path: pathname,
        headers: bodyRaw
          ? {
              "content-type": "application/json",
              "content-length": String(Buffer.byteLength(bodyRaw))
            }
          : {}
      },
      (res) => {
        let chunks = "";
        res.on("data", (chunk) => {
          chunks += chunk;
        });
        res.on("end", () => {
          try {
            resolve({
              statusCode: res.statusCode ?? 0,
              body: chunks ? (JSON.parse(chunks) as Record<string, unknown>) : {}
            });
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.on("error", reject);
    if (bodyRaw) req.write(bodyRaw);
    req.end();
  });
}
