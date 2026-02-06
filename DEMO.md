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
- start server on port `3001`
- create 3 AI-designated agents by default:
  - `ai_demo_1`
  - `ai_demo_2`
  - `ai_demo_3`
- run in fallback mode if `OPENAI_API_KEY` is not set
- run in live AI mode if `OPENAI_API_KEY` is set before command

Open dashboard:
- `http://localhost:3001/dashboard`

Optional (enable live AI first):
```bash
export OPENAI_API_KEY='your_key'
npm run demo:setup
```

Or strict live-AI setup (fails if key missing):
```bash
OPENAI_API_KEY='your_key' npm run demo:setup:ai
```

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

## 5) Non-interactive panel verification
```bash
npm run verify:panel
```
