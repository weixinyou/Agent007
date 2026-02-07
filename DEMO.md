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
- reset world state
- run the **on-chain Monad testnet** entry flow by default (real `paymentTxHash` required/used)
  - funds 3 test wallets
  - sends 3 entry txs
  - admits agents only after on-chain confirmation
  - writes tx hashes to `/tmp/onchain_demo_payments.json`

Open dashboard:
- `http://localhost:3001/dashboard`

Local-only (no chain) demo:
```bash
OPENAI_API_KEY='' npm run demo:setup:local
```

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
