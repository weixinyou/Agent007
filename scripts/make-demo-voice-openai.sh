#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_FILE="${1:-$ROOT_DIR/demo/demo-voice-script.txt}"
OUT_FILE="${2:-$ROOT_DIR/demo/agent007-2min-voice.mp3}"
MODEL="${3:-gpt-4o-mini-tts}"
VOICE="${4:-alloy}"

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "OPENAI_API_KEY is not set."
  echo "Example: export OPENAI_API_KEY='sk-...'"
  exit 1
fi

if [[ ! -f "$SCRIPT_FILE" ]]; then
  echo "Script file not found: $SCRIPT_FILE"
  exit 1
fi

mkdir -p "$(dirname "$OUT_FILE")"

TMP_PAYLOAD="$(mktemp)"
trap 'rm -f "$TMP_PAYLOAD"' EXIT

node -e '
const fs = require("fs");
const [scriptPath, model, voice, outPath] = process.argv.slice(1);
const input = fs.readFileSync(scriptPath, "utf8");
const payload = {
  model,
  voice,
  format: "mp3",
  input,
  instructions: "Narrate in a warm, natural, human tone with clear pacing and slight emphasis on key technical terms."
};
fs.writeFileSync(outPath, JSON.stringify(payload));
' "$SCRIPT_FILE" "$MODEL" "$VOICE" "$TMP_PAYLOAD"

curl -sS https://api.openai.com/v1/audio/speech \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary "@$TMP_PAYLOAD" \
  -o "$OUT_FILE"

if [[ ! -s "$OUT_FILE" ]]; then
  echo "TTS generation failed: empty output."
  exit 1
fi

echo "Created: $OUT_FILE"
