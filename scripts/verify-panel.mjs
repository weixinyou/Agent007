#!/usr/bin/env node
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const STATE_PATH = path.join(ROOT, 'data/state/world.json');
const LOCK_PATH = `${STATE_PATH}.lock`;
const SEED_PATH = path.join(ROOT, 'data/seeds/world.seed.json');
const PORT = Number(process.env.PANEL_VERIFY_PORT ?? '3010');

const AGENTS = [
  { agentId: 'panel_ai_1', walletAddress: 'panel_wallet_ai_1' },
  { agentId: 'panel_rule_1', walletAddress: 'panel_wallet_rule_1' },
  { agentId: 'panel_rule_2', walletAddress: 'panel_wallet_rule_2' }
];

async function main() {
  resetWorld();

  const env = {
    ...process.env,
    PORT: String(PORT),
    PAYMENT_BACKEND: 'wallet',
    ENTRY_FEE_MON: '0.0001',
    WALLET_INITIAL_BALANCE_MON: '0.001',
    AUTO_AGENT_ENABLED: 'true',
    AUTO_AGENT_INTERVAL_MS: '1000',
    AUTO_AGENT_ACTIONS_PER_CYCLE: '1',
    AUTO_AGENT_MIN_ACTION_DELAY_MS: '2000',
    AUTO_AGENT_MAX_ACTION_DELAY_MS: '6000',
    AGENT_BRAIN_MODE: 'mixed',
    AI_AGENT_IDS: 'panel_ai_1',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
    AI_AGENT_MIN_CALL_INTERVAL_MS: '300000'
  };

  const server = spawn('npm', ['run', 'dev'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const stopServer = async () => {
    if (!server.killed) {
      server.kill('SIGTERM');
      await sleep(400);
    }
  };

  try {
    await waitForHealth(PORT, 30000);

    const entries = [];
    for (const agent of AGENTS) {
      entries.push(await postJson(`http://127.0.0.1:${PORT}/entry`, agent));
    }

    for (const entry of entries) {
      if (entry.status !== 200 || entry.response?.ok !== true) {
        throw new Error(`Entry failed for ${entry.payload.agentId}: ${JSON.stringify(entry)}`);
      }
      if (entry.response.balance !== 0.0009) {
        throw new Error(`Unexpected entry balance for ${entry.payload.agentId}: ${entry.response.balance}`);
      }
    }

    await postActionWithRetry(`http://127.0.0.1:${PORT}/action`, {
      agentId: 'panel_ai_1',
      action: 'vote',
      votePolicy: 'neutral'
    });

    await sleep(7000);

    const state = await getJson(`http://127.0.0.1:${PORT}/state`);
    const metrics = await getJson(`http://127.0.0.1:${PORT}/metrics`);

    const agentCount = Object.keys(state.agents ?? {}).length;
    if (agentCount < 3) {
      throw new Error(`Expected >=3 agents, got ${agentCount}`);
    }

    const entryEvents = (state.events ?? []).filter((e) => e.type === 'entry');
    for (const agent of AGENTS) {
      const hasEntry = entryEvents.some((event) => event.agentId === agent.agentId);
      if (!hasEntry) {
        throw new Error(`Missing entry event for ${agent.agentId}`);
      }
    }

    if (Number(state.tick ?? 0) <= 3) {
      throw new Error(`Tick did not advance enough: ${state.tick}`);
    }

    const votes = state.governance?.votes ?? { neutral: 0, cooperative: 0, aggressive: 0 };
    if ((votes.neutral ?? 0) + (votes.cooperative ?? 0) + (votes.aggressive ?? 0) <= 0) {
      throw new Error('Governance votes remained zero');
    }

    console.log('panel verify passed');
    console.log(
      JSON.stringify(
        {
          port: PORT,
          tick: state.tick,
          agentCount,
          walletCount: Object.keys(state.wallets ?? {}).length,
          eventCount: (state.events ?? []).length,
          governance: state.governance,
          metrics
        },
        null,
        2
      )
    );
  } finally {
    await stopServer();
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
      if (response.ok) return;
    } catch {
      // retry
    }
    await sleep(500);
  }
  throw new Error('Timed out waiting for server health');
}

async function postActionWithRetry(url, payload, attempts = 10) {
  for (let i = 0; i < attempts; i += 1) {
    const result = await postJson(url, payload);
    if (result.status === 200 && result.response?.ok === true) {
      return result;
    }
    const message = String(result.response?.message ?? '');
    if (message.includes('Agent is planning')) {
      await sleep(1000);
      continue;
    }
    throw new Error(`Action failed: ${JSON.stringify(result)}`);
  }
  throw new Error('Action retry exceeded attempts');
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

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}`);
  }
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(`verify:panel failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
