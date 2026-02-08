#!/usr/bin/env node
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const META_PATH = '/tmp/agent007-demo-meta.json';
const DEFAULT_PORT = 3001;
const MAX_WAIT_MS = 5000;

function killPid(pid, signal) {
  // On some macOS setups, `process.kill()` can be unreliable for detached Node listeners.
  // Use the system `kill` command first, then fall back.
  try {
    const sig = signal === 'SIGKILL' ? '-9' : signal === 'SIGTERM' ? '-15' : '';
    if (sig) {
      const res = spawnSync('kill', [sig, String(pid)], { encoding: 'utf8' });
      if (res.status === 0) {
        return true;
      }
    }
  } catch {
    // fall through
  }
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function listenerPidsForPort(port) {
  const probe = spawnSync('lsof', ['-n', '-P', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  if (probe.error || !probe.stdout) {
    return [];
  }
  return probe.stdout
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[1])
    .filter((pid) => pid && /^[0-9]+$/.test(pid))
    .map((pid) => Number(pid));
}

function killPortListeners(port) {
  const pids = listenerPidsForPort(port);
  if (pids.length === 0) {
    return [];
  }

  for (const pid of pids) {
    killPid(pid, 'SIGTERM');
  }

  sleepMs(350);

  return pids;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

let meta = null;
if (existsSync(META_PATH)) {
  try {
    meta = JSON.parse(readFileSync(META_PATH, 'utf8'));
  } catch {
    meta = null;
  }
}

const port = Number(meta?.port ?? DEFAULT_PORT);
const seenPids = new Set();

if (meta?.pid && Number.isFinite(Number(meta.pid))) {
  const pid = Number(meta.pid);
  if (killPid(pid, 'SIGTERM') || killPid(pid, 'SIGKILL')) {
    seenPids.add(pid);
  }
}

for (const pid of killPortListeners(port)) {
  seenPids.add(pid);
}

// Defensive loop: some node processes take a moment to fully exit (or may spawn a new listener).
const startedWaitAt = Date.now();
while (Date.now() - startedWaitAt < MAX_WAIT_MS) {
  const listeners = listenerPidsForPort(port);
  if (listeners.length === 0) break;
  for (const pid of listeners) {
    seenPids.add(pid);
    killPid(pid, 'SIGKILL');
  }
  sleepMs(350);
}

rmSync(META_PATH, { force: true });
const stillListening = listenerPidsForPort(port);
if (seenPids.size > 0) {
  console.log(`Stopped server process(es): ${Array.from(seenPids).join(', ')}`);
} else {
  console.log(`No active server process found on port ${port}`);
}
if (stillListening.length > 0) {
  console.log(`Warning: port ${port} still has listener pid(s): ${stillListening.join(', ')}`);
} else {
  console.log(`Port ${port} is clear`);
}
console.log('Removed demo metadata');
