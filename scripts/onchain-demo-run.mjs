#!/usr/bin/env node
/**
 * End-to-end mon-testnet demo runner.
 *
 * Behavior:
 * - Auto-generates a fresh treasury + 3 agent wallets under /tmp if not present.
 * - Uses Foundry keystores for signing (auto-creates agent keystores).
 * - Funding account can be provided as:
 *   - MON_TEST_FUNDING_KEYSTORE + MON_TEST_KEYSTORE_PASSWORD_FILE (preferred), or
 *   - MON_TEST_FUNDING_PRIVATE_KEY (convenience for local demos; creates a temp keystore).
 *
 * Outputs:
 * - Writes tx hashes to /tmp/onchain_demo_payments.json for easy on-chain tracing.
 */
import { existsSync, mkdirSync, readFileSync, chmodSync, writeFileSync } from "node:fs";
import { openSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import crypto from "node:crypto";

const RPC_URL = process.env.MON_TEST_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const PORT = Number(process.env.PORT ?? "3001");

const TREASURY_FILE = process.env.MON_TEST_TREASURY_FILE ?? "/tmp/treasury_addr.txt";
const AGENT_ADDRS_FILE = process.env.MON_TEST_AGENT_ADDRS_FILE ?? "/tmp/agent_addrs.txt";

const FUNDING_KEYSTORE = process.env.MON_TEST_FUNDING_KEYSTORE ?? "/tmp/agent007-keystores/funding_onchain_demo";
const KEYSTORE_PASSWORD_FILE = process.env.MON_TEST_KEYSTORE_PASSWORD_FILE ?? "/tmp/agent007-keystores/pass.txt";
const KEYSTORE_DIR = process.env.MON_TEST_AGENT_KEYSTORE_DIR ?? "/tmp/agent007-keystores";

const FUND_PER_AGENT_MON = Number(process.env.MON_TEST_FUND_PER_AGENT_MON ?? "0.001");
const ENTRY_FEE_MON = Number(process.env.MON_TEST_ENTRY_FEE_MON ?? "0.0001");
const MIN_CONFIRMATIONS = Number(process.env.MON_TEST_MIN_CONFIRMATIONS ?? "1");
// Monad RPC occasionally returns estimateGas errors for plain value transfers.
// We default to a realistic gas limit for simple value transfers (21k) plus headroom.
// Important: for EIP-1559 txs, nodes may check `balance >= value + gasLimit * maxFeePerGas`,
// so setting an excessively high gas limit can cause false "insufficient balance" failures.
const GAS_LIMIT = Number(process.env.MON_TEST_GAS_LIMIT ?? "30000");

const OUT_PAYMENTS = process.env.MON_TEST_OUT_PAYMENTS ?? "/tmp/onchain_demo_payments.json";
const OUT_LOG = process.env.MON_TEST_SERVER_LOG ?? "/tmp/onchain_demo_server.log";
const WALLETS_JSON = process.env.MON_TEST_WALLETS_JSON ?? "/tmp/onchain_demo_wallets.json";
const FUNDING_PRIVATE_KEY = process.env.MON_TEST_FUNDING_PRIVATE_KEY ?? "";
const DEMO_META_PATH = process.env.AGENT007_DEMO_META_PATH ?? "/tmp/agent007-demo-meta.json";

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (res.error) throw res.error;
  return res;
}

function mustOk(res, label) {
  if (res.status !== 0) {
    throw new Error(`${label} failed: exit=${res.status} stderr=${(res.stderr || "").slice(0, 300)}`);
  }
  return res;
}

function readText(path) {
  return readFileSync(path, "utf8").trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpJson(path, payload) {
  return new Promise((resolve, reject) => {
    const d = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(d),
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          let j = null;
          try {
            j = b ? JSON.parse(b) : null;
          } catch {
            // ignore
          }
          resolve({ status: res.statusCode || 0, body: j, raw: b });
        });
      }
    );
    req.on("error", reject);
    req.write(d);
    req.end();
  });
}

function killPort(port) {
  const probe = sh("lsof", ["-n", "-P", `-iTCP:${port}`, "-sTCP:LISTEN"]);
  const lines = (probe.stdout || "").trim().split("\n").slice(1).filter(Boolean);
  const pids = lines
    .map((l) => l.trim().split(/\s+/)[1])
    .filter((p) => p && /^[0-9]+$/.test(p))
    .map((p) => Number(p));
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore
    }
  }
  return pids;
}

function castAddressFromKeystore(keystorePath) {
  const res = sh("cast", ["wallet", "address", "--keystore", keystorePath, "--password-file", KEYSTORE_PASSWORD_FILE]);
  mustOk(res, "cast wallet address");
  return (res.stdout || "").trim();
}

function ensureKeystoreDirAndPasswordFile() {
  if (!existsSync(KEYSTORE_DIR)) {
    mkdirSync(KEYSTORE_DIR, { recursive: true });
  }
  try {
    chmodSync(KEYSTORE_DIR, 0o700);
  } catch {
    // ignore
  }

  if (!existsSync(KEYSTORE_PASSWORD_FILE)) {
    const pass = crypto.randomBytes(16).toString("hex");
    writeFileSync(KEYSTORE_PASSWORD_FILE, pass);
    try {
      chmodSync(KEYSTORE_PASSWORD_FILE, 0o600);
    } catch {
      // ignore
    }
  }
}

function deriveAddressFromPrivateKey(privateKeyHex) {
  const pk = privateKeyHex.startsWith("0x") ? privateKeyHex : `0x${privateKeyHex}`;
  const res = sh("cast", ["wallet", "address", "--private-key", pk]);
  mustOk(res, "cast wallet address --private-key");
  return (res.stdout || "").trim();
}

function ensureWalletArtifacts() {
  if (existsSync(WALLETS_JSON)) {
    // Always ensure the legacy helper files exist too. This makes "clean /tmp" behavior
    // predictable without requiring any pre-step.
    try {
      const wallets = JSON.parse(readFileSync(WALLETS_JSON, "utf8"));
      if (wallets?.treasury?.address && !existsSync(TREASURY_FILE)) {
        writeFileSync(TREASURY_FILE, `${wallets.treasury.address}\n`);
      }
      if (Array.isArray(wallets?.agents) && !existsSync(AGENT_ADDRS_FILE)) {
        writeFileSync(
          AGENT_ADDRS_FILE,
          wallets.agents.map((a) => `${a.id} ${a.address}`).join("\n") + "\n"
        );
      }
      if (existsSync(TREASURY_FILE) && existsSync(AGENT_ADDRS_FILE)) {
        return;
      }
    } catch {
      // Fall through to regenerate.
    }
  }

  // Create fresh wallets and persist them so tx hashes can be traced later.
  const mk = (id) => {
    const pk = `0x${crypto.randomBytes(32).toString("hex")}`;
    const addr = deriveAddressFromPrivateKey(pk);
    return { id, address: addr, privateKey: pk };
  };
  const wallets = {
    createdAt: new Date().toISOString(),
    treasury: mk("treasury"),
    agents: [mk("onchain_demo_1"), mk("onchain_demo_2"), mk("onchain_demo_3")],
  };

  writeFileSync(WALLETS_JSON, JSON.stringify(wallets, null, 2));
  try {
    chmodSync(WALLETS_JSON, 0o600);
  } catch {
    // ignore
  }

  writeFileSync(TREASURY_FILE, `${wallets.treasury.address}\n`);
  writeFileSync(
    AGENT_ADDRS_FILE,
    wallets.agents.map((a) => `${a.id} ${a.address}`).join("\n") + "\n"
  );
}

function importKeystoreFromPrivateKey({ name, privateKeyHex, keystorePath }) {
  const pk = privateKeyHex.startsWith("0x") ? privateKeyHex.slice(2) : privateKeyHex;
  const pass = readText(KEYSTORE_PASSWORD_FILE);
  const res = sh("cast", [
    "wallet",
    "import",
    name,
    "--keystore-dir",
    KEYSTORE_DIR,
    "--unsafe-password",
    pass,
    "--private-key",
    pk,
  ]);
  mustOk(res, "cast wallet import");
  if (!existsSync(keystorePath)) {
    throw new Error(`keystore import did not create file: ${keystorePath}`);
  }
}

function castBalance(address) {
  const res = sh("cast", ["balance", address, "--rpc-url", RPC_URL]);
  mustOk(res, "cast balance");
  return (res.stdout || "").trim();
}

function castNoncePending(address) {
  const res = sh("cast", ["nonce", address, "--rpc-url", RPC_URL, "--block", "pending"]);
  mustOk(res, "cast nonce");
  const raw = (res.stdout || "").trim();
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`unexpected nonce output: ${raw.slice(0, 80)}`);
  }
  return n;
}

function castSendValue({ keystorePath, to, valueMon, nonce, gasLimit }) {
  const gl = Number.isFinite(Number(gasLimit)) ? Number(gasLimit) : GAS_LIMIT;
  const res = sh("cast", [
    "send",
    "--async",
    "--rpc-url",
    RPC_URL,
    "--keystore",
    keystorePath,
    "--password-file",
    KEYSTORE_PASSWORD_FILE,
    "--gas-limit",
    String(gl),
    ...(Number.isFinite(nonce) ? ["--nonce", String(nonce)] : []),
    "--value",
    `${valueMon}ether`,
    to,
  ]);
  mustOk(res, "cast send");
  const stdout = (res.stdout || "").trim();
  const match = stdout.match(/0x[a-fA-F0-9]{64}/);
  if (!match) {
    throw new Error(`unexpected tx hash output: ${stdout.slice(0, 160)}`);
  }
  return match[0];
}

async function waitTxConfirmed(txHash, label) {
  const deadline = Date.now() + 120_000;
  let lastErr = "";
  while (Date.now() < deadline) {
    const res = sh("cast", [
      "receipt",
      "--rpc-url",
      RPC_URL,
      "--confirmations",
      String(MIN_CONFIRMATIONS),
      "--rpc-timeout",
      "45",
      txHash,
    ]);
    if (res.status === 0) return;
    lastErr = (res.stderr || "").trim().slice(0, 240);
    await sleep(1500);
  }
  throw new Error(`tx not confirmed in time (${label}): ${txHash} ${lastErr ? `err=${lastErr}` : ""}`);
}

async function waitForHealth(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await new Promise((resolve, reject) => {
        const req = http.request({ hostname: "127.0.0.1", port: PORT, path: "/health", method: "GET" }, (r) => {
          let b = "";
          r.on("data", (c) => (b += c));
          r.on("end", () => resolve({ status: r.statusCode || 0, body: b }));
        });
        req.on("error", reject);
        req.end();
      });
      if (res.status === 200) return;
    } catch {
      // ignore
    }
    await sleep(500);
  }
  throw new Error("timed out waiting for /health");
}

async function main() {
  // Hard dependency for on-chain mode.
  // If Foundry isn't installed, fail fast with a clear message.
  try {
    mustOk(sh("cast", ["--version"]), "cast");
  } catch (e) {
    throw new Error(
      `Missing dependency: Foundry (cast).\n` +
        `Install Foundry and ensure 'cast' is on PATH, then re-run demo.\n` +
        `Original: ${String(e?.message || e).slice(0, 200)}`
    );
  }

  ensureKeystoreDirAndPasswordFile();
  ensureWalletArtifacts();

  // Primary source of truth is WALLETS_JSON; TREASURY_FILE / AGENT_ADDRS_FILE are helpers.
  const wallets = JSON.parse(readFileSync(WALLETS_JSON, "utf8"));
  const treasury = String(wallets?.treasury?.address || "").trim();
  if (!treasury) {
    throw new Error(`Invalid wallets file; missing treasury.address: ${WALLETS_JSON}`);
  }
  const agents = (wallets?.agents || []).map((a) => ({ agentId: a.id, walletAddress: a.address }));
  if (agents.length < 1) {
    throw new Error(`Invalid wallets file; missing agents[]: ${WALLETS_JSON}`);
  }

  killPort(PORT);

  // Ensure funding keystore exists (or create it from a provided private key for local convenience).
  if (!existsSync(FUNDING_KEYSTORE)) {
    if (!FUNDING_PRIVATE_KEY || FUNDING_PRIVATE_KEY.trim().length === 0) {
      const msg =
        `Missing funding keystore: ${FUNDING_KEYSTORE}\n` +
        `Set MON_TEST_FUNDING_PRIVATE_KEY to run the on-chain demo automatically, or create a Foundry keystore and set:\n` +
        `  MON_TEST_FUNDING_KEYSTORE=/path/to/keystore\n` +
        `  MON_TEST_KEYSTORE_PASSWORD_FILE=/path/to/password_file\n` +
        `Wallets were generated:\n` +
        `  treasury: ${treasury}\n` +
        `  agents: ${agents.map((a) => a.walletAddress).join(", ")}\n` +
        `Secrets file (keep private): ${WALLETS_JSON}\n`;
      throw new Error(msg);
    }
    importKeystoreFromPrivateKey({
      name: "funding_onchain_demo",
      privateKeyHex: FUNDING_PRIVATE_KEY,
      keystorePath: FUNDING_KEYSTORE,
    });
  }

  // Ensure agent keystores exist (derived from generated wallets file).
  for (const a of wallets.agents || []) {
    const ks = `${KEYSTORE_DIR}/${a.id}`;
    if (!existsSync(ks)) {
      importKeystoreFromPrivateKey({ name: a.id, privateKeyHex: a.privateKey, keystorePath: ks });
    }
  }

  const funderAddress = castAddressFromKeystore(FUNDING_KEYSTORE);
  const treasuryBalBefore = castBalance(treasury);

  // Fund agents for (entry fee + gas + actions).
  let nonce = castNoncePending(funderAddress);
  const fundingTxs = [];
  for (const a of agents) {
    const tx = castSendValue({
      keystorePath: FUNDING_KEYSTORE,
      to: a.walletAddress,
      valueMon: FUND_PER_AGENT_MON,
      nonce,
      gasLimit: GAS_LIMIT,
    });
    fundingTxs.push({ agentId: a.agentId, walletAddress: a.walletAddress, txHash: tx });
    nonce += 1;
  }
  for (const t of fundingTxs) {
    await waitTxConfirmed(t.txHash, `fund ${t.agentId}`);
  }

  // Start backend in mon-testnet mode.
  const env = {
    ...process.env,
    PORT: String(PORT),
    PAYMENT_BACKEND: "mon-testnet",
    MON_TEST_RPC_URL: RPC_URL,
    MON_TEST_TREASURY_ADDRESS: treasury,
    MON_TEST_ENTRY_FEE_MON: String(ENTRY_FEE_MON),
    MON_TEST_MIN_CONFIRMATIONS: String(MIN_CONFIRMATIONS),
    AUTO_AGENT_ENABLED: "true",
    AGENT_BRAIN_MODE: process.env.AGENT_BRAIN_MODE ?? "rule",
  };

  // Ensure demo stop can find the server PID even for on-chain runner.
  // This is best-effort; demo:stop also kills by port.
  try {
    writeFileSync(
      DEMO_META_PATH,
      JSON.stringify(
        {
          mode: "mon-testnet",
          port: PORT,
          startedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
  } catch {
    // ignore
  }

  const outFd = openSync(OUT_LOG, "a");
  const child = spawn("npm", ["run", "dev"], {
    cwd: process.cwd(),
    env,
    detached: true,
    stdio: ["ignore", outFd, outFd],
  });
  child.unref();
  try {
    const meta = JSON.parse(existsSync(DEMO_META_PATH) ? readFileSync(DEMO_META_PATH, "utf8") : "{}");
    meta.pid = child.pid;
    writeFileSync(DEMO_META_PATH, JSON.stringify(meta, null, 2));
  } catch {
    // ignore
  }

  await waitForHealth(30_000);

  // Agents pay entry fee to treasury and then enter via paymentTxHash verification.
  const payments = [];
  for (const a of agents) {
    const ks = `${KEYSTORE_DIR}/${a.agentId}`;
    const paymentTxHash = castSendValue({ keystorePath: ks, to: treasury, valueMon: ENTRY_FEE_MON, gasLimit: GAS_LIMIT });
    payments.push({ ...a, paymentTxHash });
  }
  writeFileSync(OUT_PAYMENTS, JSON.stringify(payments, null, 2));

  for (const p of payments) {
    await waitTxConfirmed(p.paymentTxHash, `entry fee ${p.agentId}`);
    // Poll confirmation, then submit /entry.
    let last = null;
    for (let i = 0; i < 24; i++) {
      last = await httpJson("/entry/check", p);
      if (last.status === 200 && last.body && last.body.status === "confirmed") break;
      await sleep(1500);
    }
    if (!(last && last.status === 200 && last.body && last.body.status === "confirmed")) {
      throw new Error(`entry/check did not confirm for ${p.agentId}: ${JSON.stringify(last)}`);
    }
    const ent = await httpJson("/entry", p);
    if (!(ent.status === 200 && ent.body && ent.body.ok === true)) {
      throw new Error(`entry failed for ${p.agentId}: ${JSON.stringify(ent)}`);
    }
  }

  const treasuryBalAfter = castBalance(treasury);

  // Minimal summary (full tx hashes are written to OUT_PAYMENTS).
  console.log(
    JSON.stringify(
      {
        ok: true,
        rpcUrl: RPC_URL,
        port: PORT,
        funderAddress,
        treasury,
        treasuryBalanceWei: { before: treasuryBalBefore, after: treasuryBalAfter },
        agents: agents.map((a) => a.agentId),
        paymentsFile: OUT_PAYMENTS,
        dashboard: `http://localhost:${PORT}/dashboard`,
        note: `Server logs: ${OUT_LOG}`,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(String(err?.message || err));
  process.exit(1);
});
