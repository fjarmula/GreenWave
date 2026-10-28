#!/usr/bin/env bash
# Mock-transport smoke test with @playwright/cli (AGENTS.md: never @playwright/mcp).
# Usage: scripts/smoke/run-mock-smoke.sh [base-url]   (default http://localhost:3000)
# Expects the dashboard to be running with NEXT_PUBLIC_SIMULATION_TRANSPORT=mock
# (`npm run build && npx next start`, or `npm run dev`). Outputs go to
# <repo>/.tmp/playwright/: JSON results, screenshots and the console log.
# Phase 3 re-points it at the backend transport.
set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)/.tmp/playwright"
SESSION="greenwave-mock-smoke"
mkdir -p "$OUT_DIR"
# playwright-cli writes page snapshots under its working directory; keep them in .tmp.
cd "$OUT_DIR"

cli() { playwright-cli -s="$SESSION" "$@"; }
trap 'cli close >/dev/null 2>&1 || true' EXIT

cli open --browser="${PLAYWRIGHT_BROWSER:-chromium}" "$BASE_URL" >/dev/null
cli --raw run-code --filename="$SCRIPT_DIR/home-return.js" >"$OUT_DIR/mock-smoke-home-return.json"
cli goto "$BASE_URL/simulation/green-wave" >/dev/null
cli --raw run-code --filename="$SCRIPT_DIR/mock-run.js" >"$OUT_DIR/mock-smoke-run.json"
cli screenshot --filename="$OUT_DIR/mock-smoke-live.png" >/dev/null
cli --raw run-code --filename="$SCRIPT_DIR/mock-finish-and-restart.js" \
  >"$OUT_DIR/mock-smoke-finish-and-restart.json"
cli screenshot --filename="$OUT_DIR/mock-smoke-restarted.png" >/dev/null
cli console warning >"$OUT_DIR/mock-smoke-console.txt" 2>&1 || true

echo "Mock smoke passed. Outputs in $OUT_DIR:"
ls -1 "$OUT_DIR" | grep '^mock-smoke'
