import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentRegistry } from "../../src/agents/agentRegistry.js";
import { createAppServer } from "../../src/api/app.js";
import { WalletPaymentGateway } from "../../src/economy/walletPaymentGateway.js";
import { WalletService } from "../../src/economy/walletService.js";
import { ActionEngine } from "../../src/engine/actionEngine.js";
import { parseWorldState } from "../../src/interfaces/types.js";
import { StateStore } from "../../src/persistence/stateStore.js";
import { SnapshotStore } from "../../src/persistence/snapshotStore.js";
import { AuthService } from "../../src/services/authService.js";
import { EntryService } from "../../src/services/entryService.js";
import { SignatureAuthService } from "../../src/services/signatureAuthService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../../");

const tmpState = path.join(root, "data/state/test-api-world.json");
const seedPath = path.join(root, "data/seeds/world.seed.json");
const snapshotDir = path.join(root, "data/snapshots");

if (fs.existsSync(tmpState)) {
  fs.unlinkSync(tmpState);
}

const store = new StateStore(tmpState);
store.initFromSeed(seedPath);

const server = createAppServer({
  store,
  snapshotStore: new SnapshotStore(snapshotDir),
  entryService: new EntryService(new WalletPaymentGateway(new WalletService()), new AgentRegistry()),
  actionEngine: new ActionEngine(),
  authService: new AuthService(undefined),
  signatureAuthService: new SignatureAuthService(undefined),
  storeMode: "json"
});

const port = await listenOnRandomPort(server);

try {
  const health = await requestJson(port, "GET", "/health");
  assert.equal(health.statusCode, 200);
  assert.equal(health.body.ok, true);

  const entry = await requestJson(port, "POST", "/entry", {
    agentId: "http_agent",
    walletAddress: "demo_wallet"
  });
  assert.equal(entry.statusCode, 200);
  assert.equal(entry.body.ok, true);

  const check = await requestJson(port, "POST", "/entry/check", {
    agentId: "http_agent",
    walletAddress: "demo_wallet"
  });
  assert.equal(check.statusCode, 400);

  // Entry spawn is randomized; pick a valid adjacent move target.
  const beforeState = await requestJson(port, "GET", "/state");
  assert.equal(beforeState.statusCode, 200);
  const beforeWorld = parseWorldState(beforeState.body);
  const startLoc = beforeWorld.agents.http_agent.location;
  const moveTarget = startLoc === "town" ? "forest" : startLoc === "forest" ? "town" : "forest";

  const action = await requestJson(port, "POST", "/action", {
    agentId: "http_agent",
    action: "move",
    target: moveTarget
  });
  assert.equal(action.statusCode, 200);
  assert.equal(action.body.ok, true);

  const state = await requestJson(port, "GET", "/state");
  assert.equal(state.statusCode, 200);
  const world = parseWorldState(state.body);
  assert.equal(world.agents.http_agent.location, moveTarget);

  const dashboard = await requestText(port, "GET", "/dashboard");
  assert.equal(dashboard.statusCode, 200);
  assert.equal(dashboard.body.includes("Agent007 World Dashboard"), true);

  console.log("api e2e passed", { port });
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
  payload?: unknown,
  headers: Record<string, string> = {}
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const bodyRaw = payload === undefined ? "" : JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path: pathname,
        headers: {
          ...(bodyRaw ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(bodyRaw)) } : {}),
          ...headers
        }
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
    if (bodyRaw) {
      req.write(bodyRaw);
    }
    req.end();
  });
}

function requestText(
  port: number,
  method: "GET" | "POST",
  pathname: string,
  payload?: string
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path: pathname,
        headers: payload
          ? { "content-type": "text/plain", "content-length": String(Buffer.byteLength(payload)) }
          : {}
      },
      (res) => {
        let chunks = "";
        res.on("data", (chunk) => {
          chunks += chunk;
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode ?? 0, body: chunks });
        });
      }
    );

    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}
