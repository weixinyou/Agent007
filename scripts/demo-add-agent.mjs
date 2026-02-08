#!/usr/bin/env node
import { existsSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import process from 'node:process';

const META_PATH = '/tmp/agent007-demo-meta.json';
const ROOT = process.cwd();

async function main() {
  const type = process.argv[2];
  const agentId = process.argv[3];
  const walletAddress = process.argv[4] ?? `wallet_${agentId}`;

  if (!type || !agentId || !['ai', 'rule'].includes(type)) {
    throw new Error('Usage: node scripts/demo-add-agent.mjs <ai|rule> <agent_id> [wallet_address]');
  }

  if (!existsSync(META_PATH)) {
    throw new Error('Demo metadata not found. Run `npm run demo:setup:local` (or `npm run demo:setup:ai`) first.');
  }

  const meta = JSON.parse(readFileSync(META_PATH, 'utf8'));

  if (type === 'ai' && !meta.aiAgentIds.includes(agentId)) {
    const nextAiIds = [...meta.aiAgentIds, agentId];
    await restartMixedServer(nextAiIds, meta);
    meta.aiAgentIds = nextAiIds;
    writeFileSync(META_PATH, JSON.stringify(meta, null, 2));
  }

  await waitForHealth(meta.port ?? 3001, 15000);
  const entry = await postJson(`http://127.0.0.1:${meta.port ?? 3001}/entry`, { agentId, walletAddress });

  console.log(`Added ${type} agent`);
  console.log(JSON.stringify({ agentId, walletAddress, entry }, null, 2));
}

async function restartMixedServer(aiAgentIds, meta) {
  if (meta.pid && isProcessAlive(meta.pid)) {
    process.kill(meta.pid, 'SIGTERM');
    await sleep(1200);
  }

  const env = {
    ...process.env,
    PORT: String(meta.port ?? 3001),
    PAYMENT_BACKEND: 'wallet',
    ENTRY_FEE_MON: '0.0001',
    WALLET_INITIAL_BALANCE_MON: '0.001',
    AUTO_AGENT_ENABLED: 'true',
    AUTO_AGENT_INTERVAL_MS: '1000',
    AUTO_AGENT_ACTIONS_PER_CYCLE: '1',
    AUTO_AGENT_MIN_ACTION_DELAY_MS: '2000',
    AUTO_AGENT_MAX_ACTION_DELAY_MS: '6000',
    AGENT_BRAIN_MODE: 'mixed',
    AI_AGENT_IDS: aiAgentIds.join(','),
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
    AI_AGENT_MIN_CALL_INTERVAL_MS: '300000'
  };
  const logFd = openSync(meta.logPath ?? '/tmp/agent007-demo.log', 'a');

  const child = spawn('npm', ['run', 'dev'], {
    cwd: ROOT,
    env,
    detached: true,
    stdio: ['ignore', logFd, logFd]
  });
  child.unref();

  meta.pid = child.pid;
  meta.restartedAt = new Date().toISOString();
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await sleep(500);
  }
  throw new Error('Timed out waiting for demo server');
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  return { status: response.status, response: data };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(`demo:add failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
