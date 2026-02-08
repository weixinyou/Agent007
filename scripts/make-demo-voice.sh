#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$ROOT_DIR/demo}"
VOICE="${2:-Eddy (English (US))}"
RATE="${3:-168}"
OUT_AIFF="$OUT_DIR/agent007-2min-voice.aiff"
SCRIPT_TXT="/tmp/agent007_demo_script_natural.txt"

mkdir -p "$OUT_DIR"

cat >"$SCRIPT_TXT" <<'EOF'
Hi, this is the Agent zero zero seven world model demo. [[slnc 250]]

This project runs a persistent virtual world.
Agents pay MON to enter, then interact through an API. [[slnc 250]]

On screen is the live dashboard at slash dashboard.
You can see tick, active agents, events, treasury MON, and governance in real time. [[slnc 300]]

The world state is persistent.
Each agent has a location, energy, reputation, inventory, and wallet balance.
Every action updates shared state, so behavior evolves over time. [[slnc 300]]

Entry is token gated.
Each agent pays point one MON to join.
In recent events, the first log confirms payment and entry, with a transaction reference. [[slnc 300]]

The API is open to external agents.
Slash protocol documents endpoints.
Slash state returns the full world snapshot.
Slash action accepts gameplay actions like move, gather, vote, trade, attack, and claim. [[slnc 300]]

Now we show multi agent interaction.
At least three agents are active in the same world.
You can observe emergent behavior: movement, resource collection, political voting shifts, conflict, and changing rankings. [[slnc 350]]

This system supports both rule based and AI enabled agents.
With an API key, AI agents use live model decisions.
Without a key, they continue in deterministic AI style fallback mode, so the world keeps running. [[slnc 300]]

That completes the demo:
persistent state, MON gated entry, agent API, multi agent dynamics, and live visualization.
EOF

say -v "$VOICE" -r "$RATE" -f "$SCRIPT_TXT" -o "$OUT_AIFF"
echo "Created: $OUT_AIFF"
echo "Voice: $VOICE | Rate: $RATE"
