# Agent007 API Protocol

Canonical gameplay behavior and interaction rules:
- `docs/gameplay/WORLD_RULES.md`

Reviewer demo shortcut:
- `npm run demo:setup`
- Dashboard: `http://localhost:3001/dashboard`

Local-only demo shortcut:
- `OPENAI_API_KEY='' npm run demo:setup:local`

Important:
- `npm run demo:setup` runs **on-chain Monad testnet** entry verification (`PAYMENT_BACKEND=mon-testnet`).
- `npm run demo:setup:local` runs **local simulation only** (`PAYMENT_BACKEND=wallet`) and does not prove on-chain gating.

## Endpoints
- `GET /health`: liveness probe
- `GET /protocol`: API protocol metadata
- `GET /dashboard`: browser dashboard for live world view
- `GET /events`: server-sent realtime state stream (dashboard)
- `GET /state`: full world state
- `GET /metrics`: summarized runtime counters (agents, events, governance, AI reasoning mix)
- `GET /agents/:id`: single agent state
- `POST /entry`: register/enter an agent (charges MON)
- `POST /entry/check`: payment confirmation status check (mon-testnet mode)
- `POST /action`: resolve an agent action
- `POST /snapshot`: persist a snapshot under `data/snapshots/`

When `AGENT007_API_KEY` is set on the server, all `POST` endpoints require header:
- `x-api-key: <value>`

When `AGENT007_HMAC_SECRET` is set, all `POST` endpoints also require:
- `x-timestamp: <unix-seconds>`
- `x-signature: <hex-hmac-sha256>`

Signing payload format:
- `METHOD + "\\n" + PATHNAME + "\\n" + x-timestamp + "\\n" + raw_request_body`

Example signature command (entry request):
```bash
BODY='{"agentId":"a1","walletAddress":"demo_wallet"}'
TS=$(date +%s)
SIG=$(printf "POST\n/entry\n%s\n%s" "$TS" "$BODY" | openssl dgst -sha256 -hmac "$AGENT007_HMAC_SECRET" -hex | sed 's/^.* //')
curl -s -X POST http://localhost:3000/entry \\
  -H "content-type: application/json" \\
  -H "x-timestamp: $TS" \\
  -H "x-signature: $SIG" \\
  -d "$BODY"
```

Persistence backend:
- Default: JSON file store (`data/state/world.json`)
- SQLite: install `better-sqlite3`, then set `WORLD_STORE=sqlite` (uses `data/state/world.db`)

Payment backend:
- Default: `PAYMENT_BACKEND=wallet` (local wallet debit)
- Provider mode: `PAYMENT_BACKEND=provider`
  - `PAYMENT_PROVIDER_URL` (base URL, uses `POST /charge-entry`)
  - `PAYMENT_PROVIDER_API_KEY` (optional bearer token)
  - `PAYMENT_PROVIDER_TIMEOUT_MS` (default `1500`)
  - `PAYMENT_PROVIDER_RETRIES` (default `2`)
- MON testnet mode: `PAYMENT_BACKEND=mon-testnet`
  - `MON_TEST_RPC_URL` (JSON-RPC endpoint)
  - `MON_TEST_TREASURY_ADDRESS` (EOA treasury or fallback tx recipient)
  - `MON_TEST_CHAIN_ID_HEX` (optional chain-id guard)
  - `MON_TEST_MIN_CONFIRMATIONS` (default `2`)
  - `MON_TEST_DECIMALS` (default `18`)
  - `MON_TEST_ENTRY_FEE_MON` (default `0.0001`)
  - `MON_TEST_ENTRY_CONTRACT_ADDRESS` (optional payable contract target for entry txs)
  - `MON_TEST_ENTRY_CONTRACT_METHOD_SELECTOR` (optional 4-byte selector, e.g. `0x42cccee4` for `payEntry(string)`)
- Economy continuity knobs:
  - `MON_REWARD_PER_UNIT` (claim payout multiplier base)
  - `PASSIVE_MON_DRIP_PER_ACTION` (adds MON on successful actions)
  - `FAUCET_FLOOR_MON` (auto-refill trigger floor; disabled when `0`)
  - `FAUCET_TOPUP_TO_MON` (target balance when faucet triggers)

Autonomous agent brain mode:
- `AGENT_BRAIN_MODE=rule` (default rule-based agents)
- `AGENT_BRAIN_MODE=ai` (AI decides each autonomous action)
- `AGENT_BRAIN_MODE=mixed` (AI for selected agents, rule-based for others)
- AI mode settings:
  - `OPENAI_API_KEY` (optional; when missing, AI mode uses deterministic AI-style fallback reasoning)
  - `AI_AGENT_MODEL` (default `gpt-4.1-mini`)
  - `AI_AGENT_BASE_URL` (optional custom Responses API endpoint)
  - `AI_AGENT_TIMEOUT_MS` (server default `30000`; demo setup overrides to `15000`)
  - `AI_AGENT_MAX_RECENT_EVENTS` (default `12`)
  - `AI_AGENT_IDS` (comma-separated ids used by AI in mixed mode)
- `mixed` mode without `OPENAI_API_KEY` automatically uses deterministic AI-style fallback reasoning for AI-designated ids.
- Demo script defaults:
  - `AI_AGENT_MODEL=gpt-4.1-mini`
  - `AI_AGENT_TIMEOUT_MS=15000`
  - `npm run demo:stop` removes metadata and clears port `3001` listeners.

## Entry Request
```json
{
  "agentId": "agent_1",
  "walletAddress": "wallet_abc",
  "paymentTxHash": "0x0123...abcd"
}
```

In `mon-testnet` mode, entry succeeds only when:
- `paymentTxHash` exists on-chain
- tx status is successful
- tx sender matches `walletAddress`
- tx recipient matches `MON_TEST_ENTRY_CONTRACT_ADDRESS` when set, otherwise `MON_TEST_TREASURY_ADDRESS`
- if `MON_TEST_ENTRY_CONTRACT_METHOD_SELECTOR` is set, tx input starts with that selector
- tx value is at least entry fee
- confirmations meet `MON_TEST_MIN_CONFIRMATIONS`

Use `POST /entry/check` with the same payload to poll status before submitting final `/entry`.

## Entry Success Response (example)
```json
{
  "ok": true,
  "agentId": "agent_1",
  "balance": 23,
  "txId": "tx_entry_demo_wal_t0_1738857600000"
}
```

## Action Request
```json
{
  "agentId": "agent_1",
  "action": "move",
  "target": "forest"
}
```

Action values: `move`, `gather`, `rest`, `trade`, `attack`, `vote`, `claim`, `sell`, `aid`

Extra fields by action:
- `move`: `target` (`town|forest|cavern`)
- `trade`: `targetAgentId`, `itemGive`, `qtyGive`, `itemTake`, `qtyTake`
- `attack`: `targetAgentId`
- `vote`: `votePolicy` (`neutral|cooperative|aggressive`)
- `claim`: no extra fields
- `sell`: `itemGive`, `qtyGive` (sell inventory to world market; town-only)
- `aid`: `targetAgentId` and optionally `itemGive`, `qtyGive` (help another co-located agent)

## Events
World activity is observable via:
- `GET /events` (SSE stream)
- `GET /state` (poll)

Common event types:
- `entry`, `move`, `gather`, `rest`, `trade`, `attack`, `sell`, `aid`, `vote`, `claim`
- `ai_reasoning` (decision rationale, used by both AI and rule-mode agents)
- `world_governor` (the world “governor” adjusts prices/penalties/rewards based on recent activity)
