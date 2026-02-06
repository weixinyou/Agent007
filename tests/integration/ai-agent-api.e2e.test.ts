import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentRegistry } from "../../src/agents/agentRegistry.js";
import { AiClient } from "../../src/agents/aiClient.js";
import { AiEnabledAgentService } from "../../src/agents/aiEnabledAgentService.js";
import { createAppServer } from "../../src/api/app.js";
import { WalletPaymentGateway } from "../../src/economy/walletPaymentGateway.js";
import { WalletService } from "../../src/economy/walletService.js";
import { ActionEngine } from "../../src/engine/actionEngine.js";
import { StateStore } from "../../src/persistence/stateStore.js";
import { SnapshotStore } from "../../src/persistence/snapshotStore.js";
import { AuthService } from "../../src/services/authService.js";
import { EntryService } from "../../src/services/entryService.js";
import { SignatureAuthService } from "../../src/services/signatureAuthService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../../");

const tmpState = path.join(root, "data/state/test-ai-api-world.json");
const seedPath = path.join(root, "data/seeds/world.seed.json");
const snapshotDir = path.join(root, "data/snapshots");
cleanupStateFiles(tmpState);

const store = new StateStore(tmpState);
store.initFromSeed(seedPath);
store.update((state) => {
  state.wallets.w_ai_api = { address: "w_ai_api", monBalance: 0.2 };
  state.agents.ai_api_1 = {
    id: "ai_api_1",
    walletAddress: "w_ai_api",
    enteredAt: new Date().toISOString(),
    location: "town",
    energy: 8,
    inventory: {},
    reputation: 0
  };
});

const appServer = createAppServer({
  store,
  snapshotStore: new SnapshotStore(snapshotDir),
  entryService: new EntryService(new WalletPaymentGateway(new WalletService()), new AgentRegistry()),
  actionEngine: new ActionEngine(),
  authService: new AuthService(undefined),
  signatureAuthService: new SignatureAuthService(undefined),
  storeMode: "json"
});

let aiCalls = 0;
const mockAiServer = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/v1/responses") {
    await readRaw(req);
    aiCalls += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        output_text: JSON.stringify({
          action: "gather",
          reasoning: "Gather to grow inventory and reputation."
        })
      })
    );
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

const mockAiPort = await listenOnRandomPort(mockAiServer);
const aiService = new AiEnabledAgentService(
  store,
  new ActionEngine(),
  new AiClient({
    apiKey: "test-key",
    model: "test-model",
    baseUrl: `http://127.0.0.1:${mockAiPort}/v1/responses`,
    timeoutMs: 1500
  }),
  {
    enabled: true,
    intervalMs: 30,
    actionsPerCycle: 1,
    minAiCallIntervalMs: 1,
    minActionDelayMs: 1,
    maxActionDelayMs: 60,
    maxRecentEvents: 8
  }
);

const appPort = await listenOnRandomPort(appServer);
aiService.start();

try {
  const before = await requestJson(appPort, "GET", "/state");
  const startTick = Number(before.tick ?? 0);

  await waitFor(async () => {
    const state = await requestJson(appPort, "GET", "/state");
    return Number(state.tick ?? 0) > startTick;
  }, 2500);

  const after = await requestJson(appPort, "GET", "/state");
  assert.equal(Number(after.tick) > startTick, true);
  assert.equal(aiCalls > 0, true);
  assert.equal(Array.isArray(after.events), true);
  console.log("ai agent api e2e passed", { appPort, mockAiPort, aiCalls, tick: after.tick });
} finally {
  aiService.stop();
  await closeServer(appServer);
  await closeServer(mockAiServer);
}

function cleanupStateFiles(statePath: string): void {
  if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  const lockPath = `${statePath}.lock`;
  if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
}

function readRaw(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function listenOnRandomPort(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to bind server"));
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
): Promise<Record<string, unknown>> {
  const bodyRaw = payload === undefined ? "" : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path: pathname,
        headers: bodyRaw
          ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(bodyRaw)) }
          : {}
      },
      (res) => {
        let chunks = "";
        res.on("data", (chunk) => {
          chunks += chunk;
        });
        res.on("end", () => {
          try {
            resolve(chunks ? (JSON.parse(chunks) as Record<string, unknown>) : {});
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

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (true) {
    if (await check()) {
      return;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
