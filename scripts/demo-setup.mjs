#!/usr/bin/env node
import { copyFileSync, existsSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const ROOT = '/Users/wilsonyou/Documents/Agent007';
const STATE_PATH = path.join(ROOT, 'data/state/world.json');
const LOCK_PATH = `${STATE_PATH}.lock`;
const SEED_PATH = path.join(ROOT, 'data/seeds/world.seed.json');
const META_PATH = '/tmp/agent007-demo-meta.json';
const LOG_PATH = '/tmp/agent007-demo.log';

const DEFAULT_AI_AGENTS = [
  { agentId: 'ai_demo_1', walletAddress: 'wallet_ai_demo_1' },
  { agentId: 'ai_demo_2', walletAddress: 'wallet_ai_demo_2' },
  { agentId: 'ai_demo_3', walletAddress: 'wallet_ai_demo_3' }
];

async function main() {
  resetWorld();

  const env = {
    ...process.env,
    PORT: '3001',
    PAYMENT_BACKEND: 'wallet',
    ENTRY_FEE_MON: '0.1',
    WALLET_INITIAL_BALANCE_MON: '0.2',
    AUTO_AGENT_ENABLED: 'true',
    AUTO_AGENT_INTERVAL_MS: '1000',
    AUTO_AGENT_ACTIONS_PER_CYCLE: '1',
    AUTO_AGENT_MIN_ACTION_DELAY_MS: '2000',
    AUTO_AGENT_MAX_ACTION_DELAY_MS: '6000',
    AGENT_BRAIN_MODE: 'mixed',
    AI_AGENT_IDS: DEFAULT_AI_AGENTS.map((a) => a.agentId).join(','),
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
    AI_AGENT_MIN_CALL_INTERVAL_MS: '300000'
  };

  const logFd = openSync(LOG_PATH, 'a');
  const child = spawn('npm', ['run', 'dev'], {
    cwd: ROOT,
    env,
    detached: true,
    stdio: ['ignore', logFd, logFd]
  });
  child.unref();

  await waitForHealth(3001, 30000);

  const entries = [];
  for (const agent of DEFAULT_AI_AGENTS) {
    entries.push(await postJson('http://127.0.0.1:3001/entry', agent));
  }
  const governanceKickoff = await postActionWithRetry(
    'http://127.0.0.1:3001/action',
    {
      agentId: 'ai_demo_1',
      action: 'vote',
      votePolicy: 'neutral'
    },
    10
  );
  await sleep(1500);
  await assertHealthy(3001);

  writeFileSync(
    META_PATH,
    JSON.stringify(
      {
        pid: child.pid,
        port: 3001,
        aiAgentIds: DEFAULT_AI_AGENTS.map((a) => a.agentId),
        aiLiveMode: Boolean(process.env.OPENAI_API_KEY),
        logPath: LOG_PATH,
        startedAt: new Date().toISOString()
      },
      null,
      2
    )
  );

  console.log('Demo ready');
  console.log('Dashboard: http://localhost:3001/dashboard');
  console.log(`Server PID: ${child.pid}`);
  console.log(`AI mode: ${process.env.OPENAI_API_KEY ? 'LIVE (OpenAI enabled)' : 'FALLBACK (no API key set)'}`);
  console.log(
    `Created default AI-designated agents (${process.env.OPENAI_API_KEY ? 'live AI calls enabled' : 'fallback mode, no API calls'}):`
  );
  console.log(JSON.stringify(entries, null, 2));
  console.log('Governance kickoff action:');
  console.log(JSON.stringify(governanceKickoff, null, 2));
  console.log('Use: npm run demo:add-ai -- <agent_id> [wallet_address]');
  console.log('Use: npm run demo:add-rule -- <agent_id> [wallet_address]');
  console.log('Use: npm run demo:stop');
}

function resetWorld() {
  copyFileSync(SEED_PATH, STATE_PATH);
  if (existsSync(LOCK_PATH)) {
    rmSync(LOCK_PATH, { force: true });
  }
}

async function waitForHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await sleep(500);
  }
  throw new Error('Timed out waiting for demo server health check');
}

async function assertHealthy(port) {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  if (!response.ok) {
    throw new Error(`Demo server health check failed after setup (HTTP ${response.status})`);
  }
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  return { status: response.status, payload, response: data };
}

async function postActionWithRetry(url, payload, attempts) {
  for (let i = 0; i < attempts; i += 1) {
    const result = await postJson(url, payload);
    if (result.status < 400) {
      return result;
    }
    if (String(result.response?.message ?? '').includes('Agent is planning')) {
      await sleep(1000);
      continue;
    }
    return result;
  }
  return postJson(url, payload);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(`demo:setup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
