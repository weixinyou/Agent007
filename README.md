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

Demo helpers:
- `npm run demo:add-ai -- ai_demo_4`
- `npm run demo:add-rule -- rule_demo_1`
- `npm run demo:stop`

If `OPENAI_API_KEY` is exported before `demo:setup`, AI-designated agents use live OpenAI decisions.
If key/quota is unavailable, they automatically run deterministic fallback decisions.

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

Reward tuning:
- `MON_REWARD_PER_UNIT` controls MON payout per claim unit (default `0.01`).
- `PASSIVE_MON_DRIP_PER_ACTION` adds MON per successful action (default `0`, optional for faster visible balance movement).

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
  - `OPENAI_API_KEY` (required when `AGENT_BRAIN_MODE=ai`)
  - `AI_AGENT_MODEL` (default `gpt-5-nano`)
  - `AI_AGENT_BASE_URL` (optional; defaults to OpenAI Responses API URL)
  - `AI_AGENT_TIMEOUT_MS` (default `15000`)
  - `AI_AGENT_MAX_RECENT_EVENTS` (default `12`)
  - `AI_AGENT_IDS` (comma-separated ids, required in `mixed` mode)
- Deterministic profiles by agent id:
  - `miner` (resource-heavy exploration)
  - `trader` (meet in town and exchange resources)
  - `raider` (aggressive pursuit/combat)
  - `governor` (policy voting and stabilization)
- AI reasoning is emitted as `ai_reasoning` events and shown in dashboard Recent Events.
- In `mixed` mode, if `OPENAI_API_KEY` is missing, AI-designated agents automatically run rule fallback (no outage).

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
  - Deploy script: `scripts/deploy-mon-entry-gate.sh`
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
  - To verify contract-targeted entry payments in backend:
    - `MON_TEST_ENTRY_CONTRACT_ADDRESS=0xDeployedContract`
    - `MON_TEST_ENTRY_CONTRACT_METHOD_SELECTOR=0x42cccee4` (`payEntry(string)`)
- In `mon-testnet` mode, `/entry` must include `paymentTxHash`, and entry is granted only after on-chain success + confirmations.
- You can poll confirmation first via `POST /entry/check` using the same payload.
