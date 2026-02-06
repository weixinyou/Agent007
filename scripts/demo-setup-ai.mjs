#!/usr/bin/env node
import process from 'node:process';
import { spawn } from 'node:child_process';

if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.trim().length === 0) {
  console.error('demo:setup:ai requires OPENAI_API_KEY in the environment.');
  console.error("Example: OPENAI_API_KEY='your_key' npm run demo:setup:ai");
  process.exit(1);
}

const child = spawn('npm', ['run', 'demo:setup'], {
  stdio: 'inherit',
  shell: true,
  env: process.env
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
