import http from "node:http";
import { renderDashboardHtml } from "./dashboard.js";
import { API_PROTOCOL } from "../interfaces/protocol.js";
import { parseActionRequest, parseEntryRequest } from "../interfaces/types.js";
import { WorldStore } from "../persistence/worldStore.js";
import { SnapshotStore } from "../persistence/snapshotStore.js";
import { AuthService } from "../services/authService.js";
import { EntryService } from "../services/entryService.js";
import { SignatureAuthService } from "../services/signatureAuthService.js";
import { ActionEngine } from "../engine/actionEngine.js";

export interface AppServerDeps {
  store: WorldStore;
  snapshotStore: SnapshotStore;
  entryService: EntryService;
  actionEngine: ActionEngine;
  authService: AuthService;
  signatureAuthService: SignatureAuthService;
  storeMode: string;
  paymentMode?: "wallet" | "provider" | "mon-testnet";
}

function readRawBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      resolve(body);
    });
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendHtml(res: http.ServerResponse, code: number, html: string): void {
  res.writeHead(code, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

export function createAppServer(deps: AppServerDeps): http.Server {
  const {
    store,
    snapshotStore,
    entryService,
    actionEngine,
    authService,
    signatureAuthService,
    storeMode,
    paymentMode = "wallet"
  } = deps;
  const sseClients = new Set<http.ServerResponse>();

  function stateVersion(state: ReturnType<typeof store.read>): string {
    return `${state.tick}:${state.events.length}:${Object.keys(state.agents).length}:${state.governance.activePolicy}`;
  }

  function broadcastState(state = store.read()): void {
    if (sseClients.size === 0) return;
    const payload = JSON.stringify(state);
    for (const client of sseClients) {
      client.write(`event: state\n`);
      client.write(`data: ${payload}\n\n`);
    }
  }
  let lastVersion = stateVersion(store.read());
  const watcher = setInterval(() => {
    const nextState = store.read();
    const nextVersion = stateVersion(nextState);
    if (nextVersion !== lastVersion) {
      lastVersion = nextVersion;
      broadcastState(nextState);
    }
  }, 1000);

  const server = http.createServer(async (req, res) => {
    if (!req.url || !req.method || !req.headers.host) {
      send(res, 400, { error: "Invalid request" });
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (req.method === "GET" && pathname === "/health") {
      send(res, 200, {
        ok: true,
        service: "agent007-api",
        apiKeyRequired: authService.requiresAuth(),
        signatureRequired: signatureAuthService.requiresSignature(),
        storeMode,
        paymentMode
      });
      return;
    }

    if (req.method === "GET" && pathname === "/protocol") {
      send(res, 200, API_PROTOCOL);
      return;
    }

    if (req.method === "GET" && pathname === "/dashboard") {
      sendHtml(res, 200, renderDashboardHtml());
      return;
    }

    if (req.method === "GET" && pathname === "/state") {
      send(res, 200, store.read());
      return;
    }

    if (req.method === "GET" && pathname === "/metrics") {
      const state = store.read();
      const recentEvents = state.events.slice(-200);
      const aiReasoningEvents = recentEvents.filter((event) => event.type === "ai_reasoning");
      const aiReasoningAi = aiReasoningEvents.filter((event) => event.message.startsWith("[AI]")).length;
      const aiReasoningFallback = aiReasoningEvents.filter((event) => event.message.startsWith("[FALLBACK]")).length;
      send(res, 200, {
        tick: state.tick,
        agentCount: Object.keys(state.agents).length,
        walletCount: Object.keys(state.wallets).length,
        eventCount: state.events.length,
        activePolicy: state.governance.activePolicy,
        votes: state.governance.votes,
        aiReasoning: {
          recentWindowSize: recentEvents.length,
          total: aiReasoningEvents.length,
          ai: aiReasoningAi,
          fallback: aiReasoningFallback
        }
      });
      return;
    }

    if (req.method === "GET" && pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      });
      res.write("\n");
      sseClients.add(res);

      const heartbeat = setInterval(() => {
        res.write(": ping\n\n");
      }, 15000);

      res.write(`event: state\n`);
      res.write(`data: ${JSON.stringify(store.read())}\n\n`);

      req.on("close", () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
      });
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/agents/")) {
      const agentId = pathname.replace("/agents/", "");
      const state = store.read();
      const agent = state.agents[agentId];

      if (!agent) {
        send(res, 404, { error: "Agent not found" });
        return;
      }

      send(res, 200, agent);
      return;
    }

    if (req.method === "POST" && pathname === "/entry") {
      const rawBody = await readRawBody(req);

      if (!authService.authorize(req)) {
        send(res, 401, { error: "Unauthorized" });
        return;
      }
      const signatureCheck = signatureAuthService.verify(req, pathname, rawBody);
      if (!signatureCheck.ok) {
        send(res, 401, { error: "Unauthorized", detail: signatureCheck.reason });
        return;
      }

      try {
        const parsed = parseEntryRequest(rawBody ? JSON.parse(rawBody) : {});
        const result = store.update((state) => entryService.enter(state, parsed));
        send(res, result.ok ? 200 : 402, result);
        if (result.ok) {
          broadcastState();
        }
      } catch (error) {
        send(res, 400, { error: "Invalid entry payload", detail: `${error}` });
      }
      return;
    }

    if (req.method === "POST" && pathname === "/entry/check") {
      if (paymentMode !== "mon-testnet") {
        send(res, 400, { error: "entry check is only available in mon-testnet payment mode" });
        return;
      }

      const rawBody = await readRawBody(req);

      if (!authService.authorize(req)) {
        send(res, 401, { error: "Unauthorized" });
        return;
      }
      const signatureCheck = signatureAuthService.verify(req, pathname, rawBody);
      if (!signatureCheck.ok) {
        send(res, 401, { error: "Unauthorized", detail: signatureCheck.reason });
        return;
      }

      try {
        const parsed = parseEntryRequest(rawBody ? JSON.parse(rawBody) : {});
        const dryRunState = structuredClone(store.read());
        const result = entryService.enter(dryRunState, parsed);

        if (result.ok) {
          send(res, 200, { status: "confirmed", txId: result.txId, txHash: parsed.paymentTxHash });
          return;
        }

        const reason = (result.reason ?? "").toLowerCase();
        const pending = reason.includes("pending") || reason.includes("confirmations");
        send(res, 200, {
          status: pending ? "pending" : "failed",
          reason: result.reason ?? "payment verification failed"
        });
      } catch (error) {
        send(res, 400, { error: "Invalid entry check payload", detail: `${error}` });
      }
      return;
    }

    if (req.method === "POST" && pathname === "/action") {
      const rawBody = await readRawBody(req);

      if (!authService.authorize(req)) {
        send(res, 401, { error: "Unauthorized" });
        return;
      }
      const signatureCheck = signatureAuthService.verify(req, pathname, rawBody);
      if (!signatureCheck.ok) {
        send(res, 401, { error: "Unauthorized", detail: signatureCheck.reason });
        return;
      }

      try {
        const parsed = parseActionRequest(rawBody ? JSON.parse(rawBody) : {});
        const result = store.update((state) => actionEngine.resolve(state, parsed));
        send(res, result.ok ? 200 : 400, result);
        if (result.ok) {
          broadcastState();
        }
      } catch (error) {
        send(res, 400, { error: "Invalid action payload", detail: `${error}` });
      }
      return;
    }

    if (req.method === "POST" && pathname === "/snapshot") {
      const rawBody = await readRawBody(req);

      if (!authService.authorize(req)) {
        send(res, 401, { error: "Unauthorized" });
        return;
      }
      const signatureCheck = signatureAuthService.verify(req, pathname, rawBody);
      if (!signatureCheck.ok) {
        send(res, 401, { error: "Unauthorized", detail: signatureCheck.reason });
        return;
      }

      try {
        const state = store.read();
        const snapshotPath = snapshotStore.save(state);
        send(res, 201, { ok: true, snapshotPath });
      } catch (error) {
        send(res, 500, { error: "Snapshot failed", detail: `${error}` });
      }
      return;
    }

    send(res, 404, { error: "Not found" });
  });

  server.on("close", () => {
    clearInterval(watcher);
    sseClients.clear();
  });

  return server;
}
