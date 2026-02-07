#!/usr/bin/env node
import { copyFileSync, existsSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
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
const AI_CALL_INTERVAL_MS = process.env.AI_AGENT_MIN_CALL_INTERVAL_MS ?? '12000';
const AI_ACTION_DELAY_MS = process.env.AI_AGENT_MIN_ACTION_DELAY_MS ?? '2500';
const PASSIVE_DRIP = process.env.PASSIVE_MON_DRIP_PER_ACTION && process.env.PASSIVE_MON_DRIP_PER_ACTION.trim().length > 0
  ? process.env.PASSIVE_MON_DRIP_PER_ACTION
  : '0.000001';
const CLAIM_REWARD = process.env.MON_REWARD_PER_UNIT && process.env.MON_REWARD_PER_UNIT.trim().length > 0
  ? process.env.MON_REWARD_PER_UNIT
  : '0.00001';

async function main() {
  await clearExistingPortListeners(3001);
  resetWorld();

  const env = {
    ...process.env,
    PORT: '3001',
    PAYMENT_BACKEND: 'wallet',
    ENTRY_FEE_MON: '0.0001',
    WALLET_INITIAL_BALANCE_MON: '0.001',
    AUTO_AGENT_ENABLED: 'true',
    AUTO_AGENT_INTERVAL_MS: process.env.AUTO_AGENT_INTERVAL_MS ?? '250',
    AUTO_AGENT_ACTIONS_PER_CYCLE: process.env.AUTO_AGENT_ACTIONS_PER_CYCLE ?? '9',
    AUTO_AGENT_MAX_IDLE_MS: process.env.AUTO_AGENT_MAX_IDLE_MS ?? '2500',
    AUTO_AGENT_MIN_ACTION_DELAY_MS: process.env.AUTO_AGENT_MIN_ACTION_DELAY_MS ?? AI_ACTION_DELAY_MS,
    AUTO_AGENT_MAX_ACTION_DELAY_MS: process.env.AUTO_AGENT_MAX_ACTION_DELAY_MS ?? AI_ACTION_DELAY_MS,
    AGENT_BRAIN_MODE: 'mixed',
    AI_AGENT_IDS: DEFAULT_AI_AGENTS.map((a) => a.agentId).join(','),
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
    AI_AGENT_MIN_CALL_INTERVAL_MS: AI_CALL_INTERVAL_MS,
    AI_AGENT_MODEL: process.env.AI_AGENT_MODEL ?? 'gpt-4.1-mini',
    AI_AGENT_MIN_ACTION_DELAY_MS: AI_ACTION_DELAY_MS,
    AI_AGENT_MAX_ACTION_DELAY_MS: process.env.AI_AGENT_MAX_ACTION_DELAY_MS ?? AI_ACTION_DELAY_MS,
    AI_AGENT_TIMEOUT_MS: process.env.AI_AGENT_TIMEOUT_MS ?? '15000',
    AI_AGENT_MAX_ATTEMPTS: process.env.AI_AGENT_MAX_ATTEMPTS ?? '1',
    ACTION_MIN_COOLDOWN_MS: process.env.ACTION_MIN_COOLDOWN_MS ?? '250',
    ACTION_MAX_COOLDOWN_MS: process.env.ACTION_MAX_COOLDOWN_MS ?? '700',
    PASSIVE_MON_DRIP_PER_ACTION: PASSIVE_DRIP,
    MON_REWARD_PER_UNIT: CLAIM_REWARD,
    // Ensure child process is not forced into no-network mode when demoing live AI.
    CODEX_SANDBOX_NETWORK_DISABLED: process.env.CODEX_SANDBOX_NETWORK_DISABLED === '1' ? '0' : (process.env.CODEX_SANDBOX_NETWORK_DISABLED ?? '')
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
  const kickoffActions = [
    { agentId: 'ai_demo_1', action: 'vote', votePolicy: 'neutral' },
    { agentId: 'ai_demo_2', action: 'gather' },
    { agentId: 'ai_demo_3', action: 'gather' }
  ];
  const governanceKickoff = [];
  for (const actionPayload of kickoffActions) {
    governanceKickoff.push(await postActionWithRetry('http://127.0.0.1:3001/action', actionPayload, 10));
  }
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
  console.log('Kickoff actions:');
  console.log(JSON.stringify(governanceKickoff, null, 2));
  console.log('Use: npm run demo:add-ai -- <agent_id> [wallet_address]');
  console.log('Use: npm run demo:add-rule -- <agent_id> [wallet_address]');
  console.log('Use: npm run demo:stop');
}

async function clearExistingPortListeners(port) {
  const probe = spawnSync('lsof', ['-n', '-P', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  if (probe.error || !probe.stdout) {
    return;
  }
  const pids = probe.stdout
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[1])
    .filter((pid) => pid && /^[0-9]+$/.test(pid));

  for (const pidText of pids) {
    try {
      process.kill(Number(pidText), 'SIGTERM');
    } catch {
      // best-effort cleanup only
    }
  }

  // Ensure the old process has fully released the port before continuing setup.
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const check = spawnSync('lsof', ['-n', '-P', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    const hasListener = Boolean(check.stdout && check.stdout.trim().split('\n').length > 1);
    if (!hasListener) {
      return;
    }
    await sleep(200);
  }

  // Final hard kill pass if the listener is still hanging.
  const finalCheck = spawnSync('lsof', ['-n', '-P', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  const stubbornPids = (finalCheck.stdout || '')
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[1])
    .filter((pid) => pid && /^[0-9]+$/.test(pid));
  for (const pidText of stubbornPids) {
    try {
      process.kill(Number(pidText), 'SIGKILL');
    } catch {
      // best-effort cleanup only
    }
  }
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
