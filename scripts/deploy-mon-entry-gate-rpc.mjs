#!/usr/bin/env node
/**
 * Deploy Agent007EntryGate to Monad testnet without `forge create` / `cast send`.
 *
 * Why: some macOS setups hit Foundry networking panics when using provider-backed commands.
 * This deployer uses:
 * - `forge build` + `forge inspect` (local compilation only)
 * - `cast abi-encode` (local encoding only)
 * - `cast mktx --create` (local signing only)
 * - raw JSON-RPC via `curl` for broadcast + confirmation polling
 *
 * Usage:
 *   MON_TEST_DEPLOYER_PRIVATE_KEY=0x... \
 *   MON_TEST_TREASURY_ADDRESS=0x... \
 *   MON_TEST_RPC_URL=https://testnet-rpc.monad.xyz \
 *   MON_TEST_ENTRY_FEE_MON=0.0001 \
 *   node scripts/deploy-mon-entry-gate-rpc.mjs
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

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
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const ROOT = process.cwd();
loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env"));

const RPC_URL = (process.env.MON_TEST_RPC_URL ?? "https://testnet-rpc.monad.xyz").trim();
const DEPLOYER_PK = (process.env.MON_TEST_DEPLOYER_PRIVATE_KEY ?? "").trim();
const TREASURY = (process.env.MON_TEST_TREASURY_ADDRESS ?? "").trim();
const ENTRY_FEE_MON = Number(process.env.MON_TEST_ENTRY_FEE_MON ?? "0.0001");
const GAS_LIMIT_ENV = Number(process.env.MON_TEST_ENTRY_GATE_DEPLOY_GAS_LIMIT ?? "1200000");
const MIN_CONFIRMATIONS = Number(process.env.MON_TEST_MIN_CONFIRMATIONS ?? "1");

function requireCond(cond, msg) {
  if (!cond) throw new Error(msg);
}

function sleepMsSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function rpcCallSync(method, params) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const res = spawnSync("curl", ["-sS", RPC_URL, "-H", "content-type: application/json", "-d", body], { encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`rpc ${method} transport error: ${(res.stderr || "").trim().slice(0, 200)}`);
  }
  const json = JSON.parse(res.stdout || "{}");
  if (json.error) throw new Error(`rpc ${method} error: ${json.error.message}`);
  if (json.result === undefined) throw new Error(`rpc ${method} missing result`);
  return json.result;
}

function hexToBigInt(hex) {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}

function pickGasPriceGweiSync() {
  const env = process.env.MON_TEST_GAS_PRICE_GWEI;
  if (env && Number.isFinite(Number(env)) && Number(env) > 0) return Math.floor(Number(env));
  const wei = hexToBigInt(rpcCallSync("eth_gasPrice", []));
  const gwei = Number(wei / 1_000_000_000n);
  return Math.max(5, Math.min(5000, Math.ceil(gwei * 2.5)));
}

function mustCastWalletAddress(privateKey) {
  const pk = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const res = spawnSync("cast", ["wallet", "address", "--private-key", pk], { encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`cast wallet address failed: ${(res.stderr || res.stdout || "").trim().slice(0, 200)}`);
  }
  return (res.stdout || "").trim();
}

function runMust(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${(res.stderr || res.stdout || "").trim().slice(0, 240)}`);
  }
  return (res.stdout || "").trim();
}

function toWeiString(mon) {
  // 18 decimals
  const s = String(mon);
  const [wholeRaw, fracRaw = ""] = s.split(".");
  const whole = BigInt(wholeRaw || "0");
  const frac = (fracRaw + "0".repeat(18)).slice(0, 18);
  return (whole * 10n ** 18n + BigInt(frac || "0")).toString();
}

function waitForConfirmations(txHash, minConfirmations) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const receipt = rpcCallSync("eth_getTransactionReceipt", [txHash]);
    if (receipt && receipt.blockNumber) {
      const bn = hexToBigInt(receipt.blockNumber);
      const latest = hexToBigInt(rpcCallSync("eth_blockNumber", []));
      const conf = latest - bn + 1n;
      if (conf >= BigInt(minConfirmations)) {
        const ok = String(receipt.status || "").toLowerCase() === "0x1";
        if (!ok) throw new Error(`deployment tx reverted: ${txHash}`);
        return receipt;
      }
    }
    sleepMsSync(1500);
  }
  throw new Error(`tx not confirmed in time: ${txHash}`);
}

function isFeeTooLowError(msg) {
  const m = String(msg || "").toLowerCase();
  return (
    m.includes("transaction fee too low") ||
    m.includes("fee too low") ||
    m.includes("underpriced") ||
    m.includes("replacement transaction underpriced") ||
    m.includes("max fee per gas less than block base fee")
  );
}

function main() {
  requireCond(DEPLOYER_PK.length > 0, "MON_TEST_DEPLOYER_PRIVATE_KEY is required (put it in .env.local).");
  requireCond(TREASURY.length > 0, "MON_TEST_TREASURY_ADDRESS is required.");
  requireCond(Number.isFinite(ENTRY_FEE_MON) && ENTRY_FEE_MON > 0, "MON_TEST_ENTRY_FEE_MON must be a positive number.");

  const deployerAddr = mustCastWalletAddress(DEPLOYER_PK);
  const chainIdHex = rpcCallSync("eth_chainId", []);
  const chainId = parseInt(chainIdHex, 16);
  const nonceHex = rpcCallSync("eth_getTransactionCount", [deployerAddr, "pending"]);
  const nonce = parseInt(nonceHex, 16);

  // Build and grab bytecode.
  runMust("forge", ["build"]);
  const bytecode = runMust("forge", ["inspect", "Agent007EntryGate", "bytecode"]).replace(/^0x/, "");
  if (!bytecode || bytecode.length < 10) {
    throw new Error("forge inspect returned empty bytecode");
  }
  const feeWei = toWeiString(ENTRY_FEE_MON);
  const ctorArgs = runMust("cast", ["abi-encode", "constructor(address,uint256)", TREASURY, feeWei]).replace(/^0x/, "");
  const createData = `0x${bytecode}${ctorArgs}`;

  // Estimate deployment gas (best-effort; fall back to env).
  let gasLimit = Math.max(400_000, Math.floor(GAS_LIMIT_ENV));
  try {
    const est = rpcCallSync("eth_estimateGas", [{ from: deployerAddr, data: createData }, "latest"]);
    const estNum = Number(hexToBigInt(est));
    if (Number.isFinite(estNum) && estNum > 0) {
      gasLimit = Math.max(gasLimit, Math.ceil(estNum * 1.2));
    }
  } catch {
    // ignore
  }

  let gasPriceGwei = pickGasPriceGweiSync();
  const maxAttempts = 5;
  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const pk = DEPLOYER_PK.startsWith("0x") ? DEPLOYER_PK : `0x${DEPLOYER_PK}`;
      const rawTx = runMust("cast", [
        "mktx",
        "--create",
        createData,
        "--legacy",
        "--chain",
        String(chainId),
        "--nonce",
        String(nonce),
        "--gas-limit",
        String(gasLimit),
        "--gas-price",
        `${gasPriceGwei}gwei`,
        "--private-key",
        pk
      ]);

      const txHash = rpcCallSync("eth_sendRawTransaction", [rawTx]);
      const receipt = waitForConfirmations(txHash, Math.max(1, MIN_CONFIRMATIONS));
      const contractAddress = receipt.contractAddress;
      if (!contractAddress) {
        throw new Error(`missing contractAddress in receipt: ${txHash}`);
      }

      const out = {
        ok: true,
        rpcUrl: RPC_URL,
        deployer: deployerAddr,
        treasury: TREASURY,
        entryFeeMon: ENTRY_FEE_MON,
        entryFeeWei: feeWei,
        method: "payEntry(string)",
        methodSelector: "0x42cccee4",
        txHash,
        contractAddress
      };
      const outPath = "/tmp/agent007-entry-gate.deploy.json";
      fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
      console.log(JSON.stringify(out, null, 2));
      console.log(`Wrote: ${outPath}`);
      return;
    } catch (e) {
      const msg = String(e?.message || e || "");
      lastErr = e;
      if (isFeeTooLowError(msg) && attempt < maxAttempts) {
        gasPriceGwei = Math.min(5000, Math.ceil(gasPriceGwei * 1.45));
        sleepMsSync(400 * attempt);
        continue;
      }
      // Add a short id to make it easier to correlate retries.
      const errId = crypto.randomBytes(4).toString("hex");
      throw new Error(`deploy failed (${errId}): ${msg.slice(0, 240)}`);
    }
  }

  throw lastErr ?? new Error("deploy failed");
}

try {
  main();
} catch (e) {
  console.error(String(e?.message || e));
  process.exit(1);
}
