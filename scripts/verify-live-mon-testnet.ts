import fs from "node:fs";
import path from "node:path";

interface AgentPayment {
  agentId: string;
  walletAddress: string;
  paymentTxHash: string;
}

interface ApiResponse {
  status: number;
  body: unknown;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const apiBase = args["api-base"] ?? "http://localhost:3000";
  const agentsFile = args["agents-file"];

  if (!agentsFile) {
    throw new Error("Missing --agents-file <path>");
  }

  const raw = fs.readFileSync(path.resolve(agentsFile), "utf-8");
  const agents = JSON.parse(raw) as AgentPayment[];

  if (!Array.isArray(agents) || agents.length < 3) {
    throw new Error("agents-file must be a JSON array with at least 3 agents");
  }

  console.log(`Verifying ${agents.length} agents against ${apiBase}`);

  const health = await requestJson(`${apiBase}/health`, "GET");
  console.log("health:", health.status, health.body);

  const protocol = await requestJson(`${apiBase}/protocol`, "GET");
  console.log("protocol:", protocol.status);

  let confirmedCount = 0;
  let enteredCount = 0;

  for (const agent of agents) {
    ensureAgent(agent);

    const check = await requestJson(`${apiBase}/entry/check`, "POST", agent);
    const checkBody = check.body as Record<string, unknown>;

    const status = typeof checkBody.status === "string" ? checkBody.status : "unknown";
    if (status === "confirmed") {
      confirmedCount += 1;
    }

    let entryStatus = "skipped";
    let entryCode = 0;
    let entryBody: unknown = undefined;

    if (status === "confirmed") {
      const entry = await requestJson(`${apiBase}/entry`, "POST", agent);
      entryCode = entry.status;
      entryBody = entry.body;
      const ok = Boolean((entry.body as Record<string, unknown>).ok);
      if (ok) {
        enteredCount += 1;
        entryStatus = "entered";
      } else {
        entryStatus = "entry_failed";
      }
    } else {
      entryStatus = `not_entered_${status}`;
    }

    console.log(JSON.stringify({
      agentId: agent.agentId,
      checkStatusCode: check.status,
      checkStatus: status,
      checkBody,
      entryStatus,
      entryStatusCode: entryCode,
      entryBody
    }));
  }

  const state = await requestJson(`${apiBase}/state`, "GET");
  const stateBody = state.body as Record<string, unknown>;
  const agentsState = (stateBody.agents ?? {}) as Record<string, unknown>;

  const enteredAgents = agents.filter((a) => Object.prototype.hasOwnProperty.call(agentsState, a.agentId));

  console.log("summary:", {
    requestedAgents: agents.length,
    confirmedCount,
    enteredCount,
    presentInWorld: enteredAgents.length,
    presentAgentIds: enteredAgents.map((a) => a.agentId)
  });

  if (enteredAgents.length >= 3) {
    console.log("LIVE VERIFICATION PASS: at least 3 agents entered after confirmed payment");
    return;
  }

  console.log("LIVE VERIFICATION INCOMPLETE: fewer than 3 agents entered");
  process.exitCode = 2;
}

function ensureAgent(agent: AgentPayment): void {
  if (!agent.agentId || !agent.walletAddress || !agent.paymentTxHash) {
    throw new Error(`Invalid agent payload: ${JSON.stringify(agent)}`);
  }
}

async function requestJson(url: string, method: "GET" | "POST", payload?: unknown): Promise<ApiResponse> {
  const res = await fetch(url, {
    method,
    headers: payload ? { "content-type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined
  });

  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }

  return { status: res.status, body };
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith("--")) {
      out[key] = value;
      i += 1;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

main().catch((error) => {
  console.error("verify-live-mon-testnet failed:", error);
  process.exit(1);
});
