# Project Structure Design

This design maps directly to the bounty requirements.

## Requirement Mapping
1. Stateful world with rules/locations/mechanics
- `src/world/rules/`
- `src/world/locations/`
- `src/world/mechanics/`
- `src/world/events/`

2. MON token-gated entry
- `src/economy/` (wallets, balances, fees, rewards)
- `src/services/` (entry validation, payment orchestration)

3. API/interface for external agents
- `src/api/` (HTTP/WebSocket handlers, routes)
- `src/interfaces/` (request/response schemas, protocol contracts)
- `examples/` (sample external agent requests)

4. Persistent evolving world state
- `src/persistence/` (repositories, state store adapters)
- `data/state/` (live persisted world state)
- `data/snapshots/` (timepoint snapshots/recovery)
- `data/seeds/` (initial world seed)

5. Meaningful action responses + emergent behavior
- `src/engine/` (action resolution loop, tick/update pipeline)
- `src/agents/` (agent session records and behavior metadata)
- `tests/simulation/` (multi-agent emergent behavior scenarios)

6. Documentation of rules/cost/protocols
- `docs/gameplay/` (world rules, activities, mechanics)
- `docs/protocols/` (API and action protocol specs)
- `docs/operations/` (deployment/runbook/monitoring)

7. Bonus: dashboard/logging and richer systems
- `dashboards/` (visualization assets)
- `logs/` (event stream and audit logs)

## Suggested Next Build Order
1. Define protocol and state schema (`src/interfaces`, `docs/protocols`)
2. Implement persistence layer and seed world (`src/persistence`, `data/seeds`)
3. Implement entry fee + wallet logic (`src/economy`, `src/services`)
4. Implement action engine and world mechanics (`src/engine`, `src/world`)
5. Expose API endpoints and add integration tests (`src/api`, `tests/integration`)
6. Run 3+ external agent simulation and dashboard logging (`tests/simulation`, `dashboards`)
