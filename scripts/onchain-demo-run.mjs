#!/usr/bin/env node
/**
 * On-chain mon-testnet demo runner that avoids `cast send` (which can crash on some macOS setups).
 *
 * It uses:
 * - `cast mktx` to build + sign legacy txs locally
 * - direct JSON-RPC (`fetch`) to broadcast raw txs
 *
 * One command:
 *   npm run demo:setup
 *
 * Required in `.env.local` (gitignored):
 *   MON_TEST_FUNDING_PRIVATE_KEY=0x...
 *   OPENAI_API_KEY=... (optional, enables live AI decisions)
 *
 * Optional:
 *   MON_TEST_ENTRY_CONTRACT_ADDRESS=0x...  (Agent007EntryGate)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!key) continue;
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
function loadEnvDefaults() {
  const cwd = process.cwd();
  loadEnvFile(path.join(cwd, ".env.local"));
  loadEnvFile(path.join(cwd, ".env"));
}
loadEnvDefaults();

const RPC_URL = process.env.MON_TEST_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const PORT = Number(process.env.PORT ?? "3001");
const FUNDING_PRIVATE_KEY = (process.env.MON_TEST_FUNDING_PRIVATE_KEY ?? "").trim();

const KEYSTORE_DIR = process.env.MON_TEST_AGENT_KEYSTORE_DIR ?? "/tmp/agent007-keystores";
const KEYSTORE_PASSWORD_FILE = process.env.MON_TEST_KEYSTORE_PASSWORD_FILE ?? "/tmp/agent007-keystores/pass.txt";
const WALLETS_JSON = process.env.MON_TEST_WALLETS_JSON ?? "/tmp/onchain_demo_wallets.json";
const OUT_PAYMENTS = process.env.MON_TEST_OUT_PAYMENTS ?? "/tmp/onchain_demo_payments.json";
const OUT_LOG = process.env.MON_TEST_SERVER_LOG ?? "/tmp/onchain_demo_server.log";
const DEMO_META_PATH = process.env.AGENT007_DEMO_META_PATH ?? "/tmp/agent007-demo-meta.json";

// Defaults tuned for mass testing: small funding + tiny entry fee.
const FUND_PER_AGENT_MON = Number(process.env.MON_TEST_FUND_PER_AGENT_MON ?? "0.001");
const ENTRY_FEE_MON = Number(process.env.MON_TEST_ENTRY_FEE_MON ?? "0.0001");
const MIN_CONFIRMATIONS = Number(process.env.MON_TEST_MIN_CONFIRMATIONS ?? "1");
const TREASURY_FLOAT_MON = Number(process.env.MON_TEST_TREASURY_FLOAT_MON ?? "0.001");

const GAS_LIMIT_VALUE_TX = Number(process.env.MON_TEST_GAS_LIMIT ?? "21000");
const ENTRY_CONTRACT_ADDRESS = (process.env.MON_TEST_ENTRY_CONTRACT_ADDRESS ?? "").trim();
const ENTRY_CONTRACT_METHOD = (process.env.MON_TEST_ENTRY_CONTRACT_METHOD ?? "payEntry(string)").trim();
const ENTRY_CONTRACT_GAS_LIMIT = Number(process.env.MON_TEST_ENTRY_CONTRACT_GAS_LIMIT ?? "150000");

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function rpcCall(method, params) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  const json = await res.json();
  if (json.error) throw new Error(`rpc ${method} error: ${json.error.message}`);
  return json.result;
}

function mustCastWalletAddress(privateKey) {
  const pk = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const res = spawnSync("cast", ["wallet", "address", "--private-key", pk], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`cast wallet address failed: ${(res.stderr || res.stdout || "").trim().slice(0, 200)}`);
  return (res.stdout || "").trim();
}

function mustCastMkTx({ to, sig, args, chainId, nonce, gasLimit, gasPriceGwei, valueMon, privateKey }) {
  const pk = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const cmd = [
    "mktx",
    "--legacy",
    "--chain",
    String(chainId),
    "--nonce",
    String(nonce),
    "--gas-limit",
    String(gasLimit),
    "--gas-price",
    `${gasPriceGwei}gwei`,
    "--value",
    `${valueMon}ether`,
    "--private-key",
    pk,
    to
  ];
  if (sig) cmd.push(sig, ...(args || []));
  const res = spawnSync("cast", cmd, { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`cast mktx failed: ${(res.stderr || res.stdout || "").trim().slice(0, 240)}`);
  const raw = (res.stdout || "").trim();
  if (!raw.startsWith("0x")) throw new Error(`unexpected cast mktx output: ${raw.slice(0, 80)}`);
  return raw;
}

async function sendRawTx(rawTx) {
  return rpcCall("eth_sendRawTransaction", [rawTx]);
}

function isFeeTooLowError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("transaction fee too low") ||
    msg.includes("fee too low") ||
    msg.includes("underpriced") ||
    msg.includes("replacement transaction underpriced") ||
    msg.includes("max fee per gas less than block base fee") ||
    msg.includes("intrinsic gas too low")
  );
}

function isInsufficientBalanceError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("insufficient balance") || msg.includes("insufficient funds");
}

async function sendTxWithRetries(makeRawTx, label) {
  let gasPriceGwei = await pickGasPriceGwei();
  const maxAttempts = 5;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const raw = makeRawTx(gasPriceGwei);
      const tx = await sendRawTx(raw);
      await waitConfirmed(tx, label);
      return { ok: true, tx, gasPriceGwei };
    } catch (e) {
      lastErr = e;
      if (isInsufficientBalanceError(e)) {
        throw new Error(`${label} failed: Signer had insufficient balance`);
      }
      if (isFeeTooLowError(e) && attempt < maxAttempts) {
        gasPriceGwei = Math.min(5000, Math.ceil(gasPriceGwei * 1.45));
        await sleep(400 * attempt);
        continue;
      }
      throw e;
    }
  }
  throw lastErr ?? new Error(`${label} failed`);
}

async function waitConfirmed(txHash, label) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const receipt = await rpcCall("eth_getTransactionReceipt", [txHash]);
    if (receipt && receipt.blockNumber) {
      const bn = BigInt(receipt.blockNumber);
      const latest = BigInt(await rpcCall("eth_blockNumber", []));
      const conf = latest - bn + 1n;
      if (conf >= BigInt(MIN_CONFIRMATIONS)) {
        if (String(receipt.status || "").toLowerCase() !== "0x1") {
          throw new Error(`tx failed (${label}): ${txHash}`);
        }
        return;
      }
    }
    await sleep(1500);
  }
  throw new Error(`tx not confirmed in time (${label}): ${txHash}`);
}

async function pickGasPriceGwei() {
  const env = process.env.MON_TEST_GAS_PRICE_GWEI;
  if (env && Number.isFinite(Number(env)) && Number(env) > 0) return Math.floor(Number(env));
  const wei = BigInt(await rpcCall("eth_gasPrice", []));
  const gwei = Number(wei / 1_000_000_000n);
  return Math.max(5, Math.min(3000, Math.ceil(gwei * 2.5)));
}

function ensureKeystoreDirAndPasswordFile() {
  if (!fs.existsSync(KEYSTORE_DIR)) fs.mkdirSync(KEYSTORE_DIR, { recursive: true });
  try { fs.chmodSync(KEYSTORE_DIR, 0o700); } catch {}
  if (!fs.existsSync(KEYSTORE_PASSWORD_FILE)) {
    const pass = crypto.randomBytes(16).toString("hex");
    fs.writeFileSync(KEYSTORE_PASSWORD_FILE, pass);
    try { fs.chmodSync(KEYSTORE_PASSWORD_FILE, 0o600); } catch {}
  }
}

function resetLocalWorldStateFiles() {
  const root = process.cwd();
  const stateDir = path.join(root, "data", "state");
  const snapshotDir = path.join(root, "data", "snapshots");
  for (const f of ["world.json", "world.json.lock", "world.db"]) {
    try { fs.rmSync(path.join(stateDir, f), { force: true }); } catch {}
  }
  try { fs.rmSync(snapshotDir, { recursive: true, force: true }); } catch {}
}

function killPort(port) {
  try {
    const probe = spawnSync("lsof", ["-n", "-P", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    const lines = (probe.stdout || "").trim().split("\n").slice(1).filter(Boolean);
    for (const line of lines) {
      const pid = line.trim().split(/\s+/)[1];
      if (pid && /^[0-9]+$/.test(pid)) {
        spawnSync("kill", ["-9", pid]);
      }
    }
  } catch {}
}

async function ensureWalletArtifacts() {
  if (fs.existsSync(WALLETS_JSON)) {
    try {
      const w = JSON.parse(fs.readFileSync(WALLETS_JSON, "utf8"));
      if (w?.treasury?.address && Array.isArray(w?.agents) && w.agents.length >= 3) return w;
    } catch {}
  }
  const mk = (id) => {
    const pk = `0x${crypto.randomBytes(32).toString("hex")}`;
    const addr = mustCastWalletAddress(pk);
    return { id, address: addr, privateKey: pk };
  };
  const wallets = {
    createdAt: new Date().toISOString(),
    treasury: mk("treasury"),
    agents: [mk("onchain_demo_1"), mk("onchain_demo_2"), mk("onchain_demo_3")]
  };
  fs.writeFileSync(WALLETS_JSON, JSON.stringify(wallets, null, 2));
  try { fs.chmodSync(WALLETS_JSON, 0o600); } catch {}
  return wallets;
}

async function waitForHealth(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await new Promise((resolve, reject) => {
        const req = http.request({ hostname: "127.0.0.1", port: PORT, path: "/health", method: "GET" }, (r) => {
          r.on("data", () => {});
          r.on("end", () => resolve(r.statusCode || 0));
        });
        req.on("error", reject);
        req.end();
      });
      if (res === 200) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("timed out waiting for /health");
}

async function getLocalState() {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: PORT, path: "/state", method: "GET" }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => {
        try {
          resolve(b ? JSON.parse(b) : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  must(FUNDING_PRIVATE_KEY.length > 0, "Missing MON_TEST_FUNDING_PRIVATE_KEY (put it in .env.local).");
  ensureKeystoreDirAndPasswordFile();

  killPort(PORT);
  const resetWorld = (process.env.AGENT007_DEMO_RESET_WORLD ?? "false").toLowerCase() === "true";
  if (resetWorld) {
    resetLocalWorldStateFiles();
  }

  const wallets = await ensureWalletArtifacts();
  const baseGasPriceGwei = await pickGasPriceGwei();
  // If entry is via contract, agents need more balance to cover gas.
  const entryGasLimit = ENTRY_CONTRACT_ADDRESS ? Math.max(21000, ENTRY_CONTRACT_GAS_LIMIT) : GAS_LIMIT_VALUE_TX;
  const estimatedEntryGasMon = (entryGasLimit * baseGasPriceGwei) / 1e9;
  const minAgentMonForEntry = Number((ENTRY_FEE_MON + estimatedEntryGasMon + 0.0002).toFixed(6));
  const effectiveFundPerAgentMon = Math.max(FUND_PER_AGENT_MON, minAgentMonForEntry);

  // Start backend.
  const env = {
    ...process.env,
    PORT: String(PORT),
    PAYMENT_BACKEND: "mon-testnet",
    MON_TEST_RPC_URL: RPC_URL,
    MON_TEST_TREASURY_ADDRESS: wallets.treasury.address,
    MON_TEST_TREASURY_PRIVATE_KEY: wallets.treasury.privateKey,
    MON_TEST_WALLETS_JSON: WALLETS_JSON,
    MON_TEST_ENTRY_FEE_MON: String(ENTRY_FEE_MON),
    MON_TEST_MIN_CONFIRMATIONS: String(MIN_CONFIRMATIONS),
    MON_TEST_GAS_LIMIT: String(GAS_LIMIT_VALUE_TX),
    MON_TEST_GAS_PRICE_GWEI: String(baseGasPriceGwei),
    WALLET_INITIAL_BALANCE_MON: process.env.WALLET_INITIAL_BALANCE_MON ?? String(Math.max(0, FUND_PER_AGENT_MON - ENTRY_FEE_MON)),
    MON_REWARD_PER_UNIT: process.env.MON_REWARD_PER_UNIT ?? "0.000001",
    MON_TRADE_PAYMENT_MON: process.env.MON_TRADE_PAYMENT_MON ?? "0.000001",
    MON_ATTACK_LOOT_MON: process.env.MON_ATTACK_LOOT_MON ?? "0.000001",
    MON_AGENT_TX_MIN_INTERVAL_MS: process.env.MON_AGENT_TX_MIN_INTERVAL_MS ?? "30000",
    AUTO_AGENT_ENABLED: "true",
    AUTO_AGENT_INTERVAL_MS: process.env.AUTO_AGENT_INTERVAL_MS ?? "400",
    AUTO_AGENT_ACTIONS_PER_CYCLE: process.env.AUTO_AGENT_ACTIONS_PER_CYCLE ?? "3",
    AUTO_AGENT_MIN_ACTION_DELAY_MS: process.env.AUTO_AGENT_MIN_ACTION_DELAY_MS ?? "800",
    AUTO_AGENT_MAX_ACTION_DELAY_MS: process.env.AUTO_AGENT_MAX_ACTION_DELAY_MS ?? "2500",
    ACTION_MIN_COOLDOWN_MS: process.env.ACTION_MIN_COOLDOWN_MS ?? "800",
    ACTION_MAX_COOLDOWN_MS: process.env.ACTION_MAX_COOLDOWN_MS ?? "2500",
    AGENT_BRAIN_MODE: process.env.AGENT_BRAIN_MODE ?? (process.env.OPENAI_API_KEY ? "ai" : "rule"),
    AI_AGENT_MIN_CALL_INTERVAL_MS: process.env.AI_AGENT_MIN_CALL_INTERVAL_MS ?? "12000",
    AI_AGENT_MIN_ACTION_DELAY_MS: process.env.AI_AGENT_MIN_ACTION_DELAY_MS ?? "800",
    AI_AGENT_MAX_ACTION_DELAY_MS: process.env.AI_AGENT_MAX_ACTION_DELAY_MS ?? "2500",
    ...(ENTRY_CONTRACT_ADDRESS
      ? {
          MON_TEST_ENTRY_CONTRACT_ADDRESS: ENTRY_CONTRACT_ADDRESS,
          MON_TEST_ENTRY_CONTRACT_METHOD_SELECTOR: process.env.MON_TEST_ENTRY_CONTRACT_METHOD_SELECTOR ?? "",
        }
      : {})
  };

  fs.writeFileSync(DEMO_META_PATH, JSON.stringify({ mode: "mon-testnet", port: PORT, startedAt: new Date().toISOString() }, null, 2));
  console.log(`[demo:setup] Starting server in payment mode=mon-testnet on port ${PORT}`);
  console.log(`[demo:setup] RPC=${RPC_URL}`);
  const outFd = fs.openSync(OUT_LOG, "a");
  const child = spawn("npm", ["run", "dev"], { cwd: process.cwd(), env, detached: true, stdio: ["ignore", outFd, outFd] });
  child.unref();
  const meta = JSON.parse(fs.readFileSync(DEMO_META_PATH, "utf8"));
  meta.pid = child.pid;
  fs.writeFileSync(DEMO_META_PATH, JSON.stringify(meta, null, 2));

  try {
    await waitForHealth(30_000);

    // If the world already has agents, treat this as a reload: do not re-fund or re-pay entry.
    // This keeps history persistent across restarts.
    const existing = await getLocalState();
    const existingAgents = existing && existing.agents && typeof existing.agents === "object" ? Object.keys(existing.agents) : [];
    if (!resetWorld && existingAgents.length > 0) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            mode: "reload",
            rpcUrl: RPC_URL,
            port: PORT,
            treasury: wallets.treasury.address,
            agentCount: existingAgents.length,
            dashboard: `http://localhost:${PORT}/dashboard`,
            note: `World state preserved (no new entry payments were made). Set AGENT007_DEMO_RESET_WORLD=true to start fresh.`
          },
          null,
          2
        )
      );
      return;
    }

    // Fresh boot: fund wallets and pay entry on-chain, then call /entry.
    const chainIdHex = await rpcCall("eth_chainId", []);
    const chainId = parseInt(chainIdHex, 16);

    const funderAddr = mustCastWalletAddress(FUNDING_PRIVATE_KEY);
    let nonce = parseInt(await rpcCall("eth_getTransactionCount", [funderAddr, "pending"]), 16);

    // Fund treasury float.
    if (TREASURY_FLOAT_MON > 0) {
      const fund = await sendTxWithRetries(
        (gasPriceGwei) =>
          mustCastMkTx({
            to: wallets.treasury.address,
            chainId,
            nonce,
            gasLimit: GAS_LIMIT_VALUE_TX,
            gasPriceGwei,
            valueMon: TREASURY_FLOAT_MON,
            privateKey: FUNDING_PRIVATE_KEY
          }),
        "fund treasury"
      );
      nonce += 1;
    }

    // Fund agents.
    for (const a of wallets.agents) {
      await sendTxWithRetries(
        (gasPriceGwei) =>
          mustCastMkTx({
            to: a.address,
            chainId,
            nonce,
            gasLimit: GAS_LIMIT_VALUE_TX,
            gasPriceGwei,
            valueMon: effectiveFundPerAgentMon,
            privateKey: FUNDING_PRIVATE_KEY
          }),
        `fund ${a.id}`
      );
      nonce += 1;
    }

    // Entry txs (agent pays).
    const payments = [];
    for (const a of wallets.agents) {
      const fromAddr = a.address;
      const agentNonce = parseInt(await rpcCall("eth_getTransactionCount", [fromAddr, "pending"]), 16);
      const gasLimit = entryGasLimit;
      const sent = await sendTxWithRetries(
        (gasPriceGwei) =>
          mustCastMkTx({
            to: ENTRY_CONTRACT_ADDRESS || wallets.treasury.address,
            sig: ENTRY_CONTRACT_ADDRESS ? ENTRY_CONTRACT_METHOD : undefined,
            args: ENTRY_CONTRACT_ADDRESS ? [a.id] : undefined,
            chainId,
            nonce: agentNonce,
            gasLimit,
            gasPriceGwei,
            valueMon: ENTRY_FEE_MON,
            privateKey: a.privateKey
          }),
        `entry fee ${a.id}`
      );
      payments.push({ agentId: a.id, walletAddress: a.address, paymentTxHash: sent.tx });
    }
    fs.writeFileSync(OUT_PAYMENTS, JSON.stringify(payments, null, 2));

    for (const p of payments) {
      // /entry/check then /entry
      let last = null;
      for (let i = 0; i < 24; i++) {
        last = await new Promise((resolve, reject) => {
          const d = JSON.stringify(p);
          const req = http.request(
            { hostname: "127.0.0.1", port: PORT, path: "/entry/check", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(d) } },
            (res) => {
              let b = "";
              res.on("data", (c) => (b += c));
              res.on("end", () => {
                try { resolve({ status: res.statusCode || 0, body: b ? JSON.parse(b) : null }); } catch { resolve({ status: res.statusCode || 0, body: null }); }
              });
            }
          );
          req.on("error", reject);
          req.write(d);
          req.end();
        });
        if (last.status === 200 && last.body && last.body.status === "confirmed") break;
        await sleep(1500);
      }
      if (!(last && last.status === 200 && last.body && last.body.status === "confirmed")) {
        throw new Error(`entry/check did not confirm for ${p.agentId}: ${JSON.stringify(last)}`);
      }
      const ent = await new Promise((resolve, reject) => {
        const d = JSON.stringify(p);
        const req = http.request(
          { hostname: "127.0.0.1", port: PORT, path: "/entry", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(d) } },
          (res) => {
            let b = "";
            res.on("data", (c) => (b += c));
            res.on("end", () => {
              try { resolve({ status: res.statusCode || 0, body: b ? JSON.parse(b) : null, raw: b }); } catch { resolve({ status: res.statusCode || 0, body: null, raw: b }); }
            });
          }
        );
        req.on("error", reject);
        req.write(d);
        req.end();
      });
      if (!(ent.status === 200 && ent.body && ent.body.ok === true)) {
        throw new Error(`entry failed for ${p.agentId}: ${JSON.stringify(ent)}`);
      }
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          rpcUrl: RPC_URL,
          port: PORT,
          treasury: wallets.treasury.address,
          agents: wallets.agents.map((a) => ({ id: a.id, address: a.address })),
          entryTarget: ENTRY_CONTRACT_ADDRESS || wallets.treasury.address,
          paymentsFile: OUT_PAYMENTS,
          dashboard: `http://localhost:${PORT}/dashboard`,
          note: `Server logs: ${OUT_LOG}`
        },
        null,
        2
      )
    );
  } catch (e) {
    killPort(PORT);
    throw e;
  }
}

main().catch((err) => {
  console.error(String(err?.message || err));
  process.exit(1);
});
