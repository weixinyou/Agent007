# Demo Quickstart

## 1) Install
```bash
npm install
```

## 2) One-command demo setup
```bash
npm run demo:setup
```

This will:
- run the **on-chain Monad testnet** entry flow (real `paymentTxHash` required/used)
  - funds 3 test wallets
  - sends 3 entry txs
  - admits agents only after on-chain confirmation
  - writes tx hashes to `/tmp/onchain_demo_payments.json`

Prereq: `.env.local` must include `MON_TEST_FUNDING_PRIVATE_KEY=0x...`.

If you set `MON_TEST_ENTRY_CONTRACT_ADDRESS`, the demo runner will attempt to read `entryFeeWei()` from the contract.
If the contract requires a higher fee than `MON_TEST_ENTRY_FEE_MON`, the runner will automatically bump the fee to avoid reverts.

Open dashboard:
- `http://localhost:3001/dashboard`

## 2.1 On-chain Verification Checklist (Monad Testnet)
After `npm run demo:setup` completes, verify the on-chain gating and transactions:

1. Confirm the server is running:
   - `GET http://127.0.0.1:3001/health` should return `ok:true`
2. Confirm the world is in on-chain mode:
   - `GET http://127.0.0.1:3001/health` should show `"paymentMode":"mon-testnet"`
3. Confirm entry payments were recorded:
   - Check `/tmp/onchain_demo_payments.json`
   - It contains 3 entries like:
     - `agentId`
     - `walletAddress`
     - `paymentTxHash`
4. Confirm entry is actually gated by tx recipient:
   - If you set `MON_TEST_ENTRY_CONTRACT_ADDRESS`, each `paymentTxHash` must be a tx sent to that contract.
   - Otherwise, each `paymentTxHash` must be a tx sent to the treasury address printed by the script.
5. Confirm agents were admitted after confirmation:
   - Open `/dashboard` and look for pinned `ENTRY` events (kept visible for ~60s).
   - Or `GET /state` and search for `type:"entry"`.
6. Trace txs on the explorer:
   - Use your preferred Monad testnet explorer and search each `paymentTxHash`.
   - You should see `from=walletAddress` and `to=entry target` (treasury or entry contract).

Notes:
- The demo runner defaults to "reload" behavior: re-running `npm run demo:setup` preserves `data/state/world.json` and does not re-pay entry unless you set `AGENT007_DEMO_RESET_WORLD=true`.
- Some in-world MON values on the dashboard are "world credits" for gameplay continuity; the entry gate itself is enforced using real on-chain tx verification.

Local-only (no chain) demo:
```bash
OPENAI_API_KEY='' npm run demo:setup:local
```
This runs `PAYMENT_BACKEND=wallet` simulation only (useful for UI/logic testing, not for proving on-chain gating).

Live AI demo (local wallet backend; requires key):
```bash
OPENAI_API_KEY='your_key' npm run demo:setup:ai
```

Demo defaults:
- AI model: `gpt-4.1-mini`
- AI timeout: `15000ms`

## 3) Add more agents when needed
Add AI-designated agent:
```bash
npm run demo:add-ai -- ai_demo_4
```

Add rule-based agent:
```bash
npm run demo:add-rule -- rule_demo_1
```

Optional custom wallet address:
```bash
npm run demo:add-ai -- ai_demo_5 wallet_ai_demo_5
```

## 4) Stop demo server
```bash
npm run demo:stop
```
This command also clears stale metadata and cleans any remaining listener on port `3001`.

## 5) Non-interactive panel verification
```bash
npm run verify:panel
```
