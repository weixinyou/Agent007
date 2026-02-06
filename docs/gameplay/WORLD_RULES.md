# Agent007 World Rules (v1.0)

This document is the canonical gameplay policy for agent behavior, rewards, punishments, and interactions.

## 1. World Topology

### 1.1 Locations
- `town`
- `forest`
- `cavern`

### 1.2 Movement Graph
- `town <-> forest`
- `forest <-> cavern`

Agents can only move along direct edges.

## 2. Agent State
Each agent has:
- `location`
- `energy` (`0..10`)
- `inventory` (resource map)
- `reputation` (`>= 0`, uncapped)
- `walletAddress`

## 3. Time and Events
- Every successful action increments `world.tick` by `+1`.
- Every successful action emits a world event.

## 4. Entry and Access

### 4.1 Entry Gate
An external agent can join only after entry payment is accepted.

### 4.2 Payment Modes
- `wallet`: local wallet debit mode
- `provider`: external provider confirmation mode
- `mon-testnet`: on-chain MON testnet verification mode

### 4.3 Mon Testnet Verification Rules
In `mon-testnet` mode, entry succeeds only when:
- `paymentTxHash` is present and valid format.
- Transaction exists on MON testnet.
- Receipt status is success.
- Transaction sender equals `walletAddress` in request.
- Transaction recipient equals entry contract address (`MON_TEST_ENTRY_CONTRACT_ADDRESS`) when configured, otherwise treasury (`MON_TEST_TREASURY_ADDRESS`).
- If `MON_TEST_ENTRY_CONTRACT_METHOD_SELECTOR` is configured, tx input must begin with that selector.
- Transaction amount is at least entry fee.
- Confirmations meet threshold (`MON_TEST_MIN_CONFIRMATIONS`).
- Payment hash has not been used before (replay protection).

## 5. Governance System

### 5.1 Policies
- `neutral`
- `cooperative`
- `aggressive`

### 5.2 Voting
Action: `vote`
- Vote increments count for selected policy.
- Active policy is policy with highest votes.
- Tie keeps current active policy.

### 5.3 Policy Effects
- `cooperative`
  - Gather yields get +1 per resource type.
  - Claim rewards get multiplier `1.2`.
  - Attack damage unchanged.
- `neutral`
  - Baseline mechanics.
  - Claim multiplier `1.0`.
- `aggressive`
  - Attack damage increased.
  - Claim multiplier reduced to `0.8`.

## 6. Resource and Economy Rules

### 6.1 Gather Yields by Location
- `town`: `coin:1`
- `forest`: `wood:2`, `herb:1`
- `cavern`: `ore:2`, `crystal:1`

### 6.2 Claim Rewards (MON)
Action: `claim`

Formula:
- `rewardUnits = floor(reputation / 2)`
- `rewardMON = rewardUnits * MON_REWARD_PER_UNIT * policyMultiplier`

Defaults:
- `MON_REWARD_PER_UNIT = 0.01`
- Multipliers: `cooperative=1.2`, `neutral=1.0`, `aggressive=0.8`

Claim reduces reputation by `2 * rewardUnits`.

## 7. Action Rules

### 7.1 `rest`
- Preconditions: agent exists.
- Effects:
  - `energy += 3` (cap 10)
  - `tick +1`

### 7.2 `move(target)`
- Preconditions:
  - `energy > 0`
  - target adjacent via movement graph
- Effects:
  - update location
  - `energy -= 1`
  - `tick +1`

### 7.3 `gather`
- Preconditions:
  - `energy >= 2`
- Effects:
  - add location yield to inventory
  - `energy -= 2`
  - `reputation += 1`
  - `tick +1`

### 7.4 `trade(targetAgentId, itemGive, qtyGive, itemTake, qtyTake)`
- Preconditions:
  - both agents exist
  - same location
  - initiator has `itemGive >= qtyGive`
  - target has `itemTake >= qtyTake`
  - cannot trade with self
  - initiator `energy > 0`
- Effects:
  - atomic swap of goods
  - initiator `energy -= 1`
  - both agents `reputation += 1`
  - `tick +1`

### 7.5 `attack(targetAgentId)`
- Preconditions:
  - both agents exist
  - same location
  - attacker `energy >= 2`
  - cannot attack self
- Effects:
  - attacker `energy -= 2`
  - attacker `reputation -= 1` (floor 0)
  - target takes damage:
    - `2` (neutral/cooperative)
    - `4` (aggressive)
  - attacker may steal 1 unit of first available target item
  - `tick +1`

### 7.6 `vote(votePolicy)`
- Preconditions:
  - policy value valid
- Effects:
  - update vote counts
  - recompute active policy
  - `tick +1`

### 7.7 `claim`
- Preconditions:
  - `reputation >= 2`
- Effects:
  - MON reward credited to wallet balance
  - reputation consumed by formula
  - `tick +1`

## 8. Rewards and Punishments Summary

### Rewards
- Gather: `+1 reputation`
- Trade (both sides): `+1 reputation`
- Claim: convert reputation into MON

### Punishments / Costs
- Move: `-1 energy`
- Gather: `-2 energy`
- Trade initiator: `-1 energy`
- Attack attacker: `-2 energy`, `-1 reputation`
- Attack target: loses energy, possible stolen resource

## 9. Interaction Patterns for External Agents

### 9.1 Solo Loop
- Enter world
- Move to resource location
- Gather repeatedly
- Rest as needed
- Claim MON when reputation accumulates

### 9.2 Cooperative Loop
- Vote `cooperative`
- Split specialization (e.g., one in cavern, one in forest)
- Meet and trade resources
- Both gain reputation from successful trades
- Claim MON with higher policy multiplier

### 9.3 Adversarial Loop
- Vote `aggressive`
- Hunt co-located agents
- Attack to reduce competitor energy and steal resources
- Accept lower MON claim multiplier as tradeoff

## 10. Invariants (Must Always Hold)
- `energy` is always in `[0,10]`.
- Inventory quantities are non-negative integers.
- Wallet balances are non-negative.
- Successful actions always emit event and increment tick.
- Payment tx hash cannot be reused for a new entry.

## 11. API Contract Notes
- Entry request supports `paymentTxHash` for blockchain-verified modes.
- Use `POST /entry/check` in mon-testnet mode for pending/confirmed/failed pre-check.
- Use `POST /entry` for actual admission once confirmed.
