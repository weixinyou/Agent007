# Agent007 World Model Agent - Panel Submission

## Requirement Mapping

### Core Requirements
- Stateful world with rules, locations, mechanics:
  - `docs/gameplay/WORLD_RULES.md`
  - `src/engine/actionEngine.ts`
  - `src/world/locations/map.ts`
- MON token-gated entry:
  - `src/services/entryService.ts`
  - `src/economy/walletPaymentGateway.ts`
  - `src/economy/monTestnetPaymentGateway.ts`
- API/interface for external agents:
  - `src/api/app.ts` (`/health`, `/protocol`, `/state`, `/entry`, `/action`, `/dashboard`, `/events`)
- Persistent evolving state:
  - `src/persistence/stateStore.ts`
  - `data/state/world.json`
- Meaningful action responses:
  - `src/engine/actionEngine.ts`

### Success Criteria
- 3+ external agents enter/interact:
  - `npm run demo:setup` auto-creates 3 agents
- Persistent logical world changes:
  - verify via `tick`, `events`, `wallets`, `governance` in `/state`
- Clear docs:
  - `README.md`, `DEMO.md`, `docs/protocols/API.md`, `docs/gameplay/WORLD_RULES.md`
- Emergent behavior:
  - multi-agent interactions from auto agents (trade/combat/voting/exploration paths)

### Bonus Coverage
- Economy / earn-back MON:
  - `claim` rewards in `actionEngine`
- Complex mechanics:
  - politics (`vote`), trade (`trade`), combat (`attack`), exploration (`move` + location yields)
- Visualization:
  - `GET /dashboard`, `GET /events`, `GET /metrics`

## Smart Contract (Entry Gate)
- Contract: `contracts/Agent007EntryGate.sol`
- Deployed Monad testnet address: `0xDffF789171cFA1a5B09dD417009082dA0451E2bA`
- Deployment tx: `0x4ecc4b78c8934acead7bef0c471ac48b124489ebe46b3c3c1261151abee6e0f6`
- Backend verification support env:
  - `MON_TEST_ENTRY_CONTRACT_ADDRESS`
  - `MON_TEST_ENTRY_CONTRACT_METHOD_SELECTOR=0x42cccee4` (`payEntry(string)`)

## Fast Reviewer Commands

### 1) Install and validate
```bash
npm install
npm run build
npm run test
npm run verify:panel
```

### 2) Interactive demo
```bash
npm run demo:setup
```
Open: `http://localhost:3001/dashboard`

Add agents:
```bash
npm run demo:add-ai -- ai_demo_4
npm run demo:add-rule -- rule_demo_1
```

Stop demo:
```bash
npm run demo:stop
```

### 3) Live AI mode (optional)
```bash
export OPENAI_API_KEY='your_key'
npm run demo:setup:ai
```

## Operational Note
- If OpenAI quota/rate-limit is hit, AI-designated agents automatically use deterministic fallback and continue operating.
- Dashboard clearly labels reasoning source as `[AI]` or `[FALLBACK]`.
