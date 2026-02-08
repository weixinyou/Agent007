# Agent007 - World Model Agent

This repository now includes a runnable TypeScript scaffold for a persistent, token-gated multi-agent world simulation.

## Goal
Build a world where external agents pay MON to enter, take actions through an API, and change persistent world state over time.

## Repository Structure
- `src/` core application code
- `docs/` world rules, protocols, and operational docs
- `data/` persistent state, snapshots, and seed data
- `tests/` unit, integration, and multi-agent simulation tests
- `dashboards/` visualization/logging artifacts
- `scripts/` developer and ops utilities
- `config/` environment and runtime configuration
- `examples/` sample client/agent interactions
- `logs/` runtime world activity logs

See `docs/architecture/PROJECT_STRUCTURE.md` for detailed folder-level design.
Gameplay policy is defined in `docs/gameplay/WORLD_RULES.md`.

## Quick Start
```bash
npm install
npm run build
npm run test
npm run sim
npm run dev
```

## Panel Quick Verify
Use this shortest reviewer path:
```bash
npm install
npm run build
npm run test
npm run verify:panel
npm run demo:setup
```

Open:
- `http://localhost:3001/dashboard`

## Two Demo Methods (Reviewer Guide)

### Method A (Recommended): On-chain Monad testnet demo (proves MON-gated entry)
1. Clone + install:
```bash
git clone https://github.com/weixinyou/Agent007.git
cd Agent007
npm install
npm run build
npm run test
```

2. Create `.env.local` (gitignored) with:
```bash
MON_TEST_FUNDING_PRIVATE_KEY=0xYOUR_TESTNET_FUNDING_PRIVATE_KEY
MON_TEST_RPC_URL=https://testnet-rpc.monad.xyz
```

Optional strict contract-gated entry:
```bash
MON_TEST_ENTRY_CONTRACT_ADDRESS=0xYOUR_ENTRY_GATE_CONTRACT
MON_TEST_ENTRY_CONTRACT_METHOD_SELECTOR=0x42cccee4
```

Optional live AI:
```bash
OPENAI_API_KEY=YOUR_OPENAI_KEY
```

3. Run one command:
```bash
npm run demo:setup
```

4. Open:
- `http://localhost:3001/dashboard`

5. Verify on-chain entry payments:
- Check `/tmp/onchain_demo_payments.json` for the 3 `paymentTxHash` values.
- Search each hash on a Monad testnet explorer.

Reset the world (fresh run, not reload):
```bash
AGENT007_DEMO_RESET_WORLD=true npm run demo:setup
```

### Method B: Local simulation demo (fast UI/logic check, not on-chain)
```bash
OPENAI_API_KEY='' npm run demo:setup:local
```
Open:
- `http://localhost:3001/dashboard`

Stop either demo:
```bash
npm run demo:stop
```

Demo helpers:
- `npm run demo:add-ai -- ai_demo_4`
- `npm run demo:add-rule -- rule_demo_1`
- `npm run demo:stop`

By default, `npm run demo:setup` runs **on-chain Monad testnet** entry (real `paymentTxHash` verification).
This is the path that satisfies the “MON token-gated entry” requirement.

### On-Chain Demo Prereqs
Create a `.env.local` (gitignored) with at least:
```bash
MON_TEST_FUNDING_PRIVATE_KEY=0x...   # funds new agent wallets and treasury float (Monad testnet)
MON_TEST_RPC_URL=https://testnet-rpc.monad.xyz
```

Optional (recommended) for strict contract-gated entry:
```bash
MON_TEST_ENTRY_CONTRACT_ADDRESS=0x...    # Agent007EntryGate (payable)
MON_TEST_ENTRY_CONTRACT_METHOD_SELECTOR=0x42cccee4  # payEntry(string)
```

For local-only demos:
- fallback: `OPENAI_API_KEY='' npm run demo:setup:local`
- live AI: `OPENAI_API_KEY='...' npm run demo:setup:ai`

Important: `demo:setup:local` and `demo:setup:ai` are **wallet-mode simulations**. They are useful for fast UI/logic testing,
but they do not prove on-chain payment gating.

## Deploy (Render)
This repo includes `render.yaml` for one-click deployment.

Steps:
1. Push this repo to GitHub.
2. In Render: `New +` -> `Blueprint` -> select this repo.
3. Deploy using defaults from `render.yaml`.
4. (Optional) add `OPENAI_API_KEY` in Render env vars for live AI decisions.
5. By default, Render bootstraps 3 agents on startup (`ai_demo_1..3`) via `BOOTSTRAP_DEFAULT_AGENTS=true`.

After deploy, use:
- `/dashboard` for live UI
- `/health` for service check
- `/protocol` for API contract

API defaults to `http://localhost:3000` with:
- `GET /health`
- `GET /protocol`
- `GET /dashboard`
- `GET /events` (SSE realtime stream)
- `GET /state`
- `GET /metrics`
- `GET /agents/:id`
- `POST /entry`
- `POST /entry/check` (mon-testnet mode)
- `POST /action`
- `POST /snapshot`

Advanced world actions:
- `trade` (resource exchange between co-located agents)
- `attack` (energy damage + possible loot steal)
- `vote` (politics/policy system: neutral/cooperative/aggressive)
- `claim` (convert reputation to MON rewards)
- `sell` (sell inventory to world market, treasury pays out)
- `aid` (help another co-located agent, improves social dynamics)

Reward tuning:
- `MON_REWARD_PER_UNIT` controls MON payout per claim unit (default `0.00001`).
- `PASSIVE_MON_DRIP_PER_ACTION` adds MON per successful action (default `0`, optional for faster visible balance movement).
- `FAUCET_FLOOR_MON` ensures wallets below a minimum are auto-refilled after successful actions (default `0`, disabled).
- `FAUCET_TOPUP_TO_MON` target refill balance when faucet triggers (default `0`; uses floor if unset).

Auto-agent simulation:
- Agents can act automatically after entering.
- Controls:
  - `AUTO_AGENT_ENABLED` (`true` by default)
  - `AUTO_AGENT_INTERVAL_MS` (default `2500`)
  - `AUTO_AGENT_ACTIONS_PER_CYCLE` (default `1`)
- Brain mode:
  - `AGENT_BRAIN_MODE=rule` (default, pre-written behavior)
  - `AGENT_BRAIN_MODE=ai` (LLM decides each action)
  - `AGENT_BRAIN_MODE=mixed` (AI for selected agents, rules for others)
- AI mode configuration:
  - `OPENAI_API_KEY` (optional; when missing, AI mode runs deterministic AI-style fallback reasoning)
  - `AI_AGENT_MODEL` (default `gpt-4.1-mini`)
  - `AI_AGENT_BASE_URL` (optional; defaults to OpenAI Responses API URL)
  - `AI_AGENT_TIMEOUT_MS` (server default `30000`; demo setup overrides to `15000`)
  - `AI_AGENT_MAX_RECENT_EVENTS` (default `12`)
  - `AI_AGENT_IDS` (comma-separated ids, required in `mixed` mode)
- Deterministic profiles by agent id:
  - `miner` (resource-heavy exploration)
  - `trader` (meet in town and exchange resources)
  - `raider` (aggressive pursuit/combat)
  - `governor` (policy voting and stabilization)
- AI reasoning is emitted as `ai_reasoning` events and shown in dashboard Recent Events.
- In `mixed` mode, if `OPENAI_API_KEY` is missing, AI-designated agents automatically run deterministic AI-style fallback reasoning (no outage).
- Demo script defaults (`npm run demo:setup` / `npm run demo:setup:ai`):
  - `AI_AGENT_MODEL=gpt-4.1-mini` (faster demo loop)
  - `AI_AGENT_TIMEOUT_MS=15000`
  - `npm run demo:stop` clears metadata and force-cleans listeners on port `3001`.

Optional auth:
- Set `AGENT007_API_KEY=your_key` to require `x-api-key` for all `POST` endpoints.
- Set `AGENT007_HMAC_SECRET=your_secret` to also require signed POST requests via `x-timestamp` and `x-signature`.

Optional SQLite persistence:
- Default store is JSON.
- Use SQLite mode:
```bash
npm install better-sqlite3
WORLD_STORE=sqlite npm run dev
```

Payment architecture:
- Entry fee charging is routed through a pluggable payment gateway (`src/economy/paymentGateway.ts`).
- Current default uses wallet-backed charging (`src/economy/walletPaymentGateway.ts`) and returns a `txId` in entry responses.
- Optional provider-backed mode:
```bash
PAYMENT_BACKEND=provider PAYMENT_PROVIDER_URL=http://localhost:8080 npm run dev
```
- Provider mode retries/timeouts are configurable via:
  `PAYMENT_PROVIDER_RETRIES`, `PAYMENT_PROVIDER_TIMEOUT_MS`, `PAYMENT_PROVIDER_API_KEY`.
- MON testnet mode (real on-chain confirmation):
```bash
PAYMENT_BACKEND=mon-testnet \
MON_TEST_RPC_URL=https://your-mon-test-rpc \
MON_TEST_TREASURY_ADDRESS=0xYourTreasuryAddress \
MON_TEST_MIN_CONFIRMATIONS=2 \
npm run dev
```
- Optional smart-contract entry gate:
  - Contract source: `contracts/Agent007EntryGate.sol`
  - Deploy scripts:
    - `scripts/deploy-mon-entry-gate.sh` (uses `forge create`)
    - `scripts/deploy-mon-entry-gate-rpc.mjs` (RPC deployer; avoids `forge create` / `cast send` provider issues)
  - Required deploy env:
    - `MON_TEST_RPC_URL`
    - `MON_TEST_DEPLOYER_PRIVATE_KEY`
    - `MON_TEST_TREASURY_ADDRESS`
    - `MON_TEST_ENTRY_FEE_WEI` or `MON_TEST_ENTRY_FEE_MON`
  - Example:
```bash
MON_TEST_RPC_URL=https://testnet-rpc.monad.xyz \
MON_TEST_DEPLOYER_PRIVATE_KEY=0x... \
MON_TEST_TREASURY_ADDRESS=0xYourTreasuryAddress \
MON_TEST_ENTRY_FEE_MON=0.1 \
./scripts/deploy-mon-entry-gate.sh
```
  - RPC deploy (recommended on macOS if `forge create` is flaky):
```bash
MON_TEST_RPC_URL=https://testnet-rpc.monad.xyz \
MON_TEST_DEPLOYER_PRIVATE_KEY=0x... \
MON_TEST_TREASURY_ADDRESS=0xYourTreasuryAddress \
MON_TEST_ENTRY_FEE_MON=0.0001 \
npm run deploy:mon-entry-gate:rpc
```
  - To verify contract-targeted entry payments in backend:
    - `MON_TEST_ENTRY_CONTRACT_ADDRESS=0xDeployedContract`
    - `MON_TEST_ENTRY_CONTRACT_METHOD_SELECTOR=0x42cccee4` (`payEntry(string)`)
- In `mon-testnet` mode, `/entry` must include `paymentTxHash`, and entry is granted only after on-chain success + confirmations.
- You can poll confirmation first via `POST /entry/check` using the same payload.

## Treasury vs Funding Wallet
- **Funding wallet** (`MON_TEST_FUNDING_PRIVATE_KEY`): bootstrap faucet used by the demo script to fund new agent wallets and top up the treasury.
- **World treasury** (`MON_TEST_TREASURY_ADDRESS`): the economic sink/source for the world (entry fees go here; market payouts come from here).
The dashboard “Treasury MON” should refer to the world treasury, not the funding wallet.
