#!/usr/bin/env node
import { existsSync, readFileSync, rmSync } from 'node:fs';
import process from 'node:process';

const META_PATH = '/tmp/agent007-demo-meta.json';

if (!existsSync(META_PATH)) {
  console.log('No demo metadata found. Nothing to stop.');
  process.exit(0);
}

const meta = JSON.parse(readFileSync(META_PATH, 'utf8'));
if (meta.pid) {
  try {
    process.kill(meta.pid, 'SIGTERM');
    console.log(`Stopped demo server pid ${meta.pid}`);
  } catch {
    console.log(`Demo server pid ${meta.pid} is not running`);
  }
}

rmSync(META_PATH, { force: true });
console.log('Removed demo metadata');
