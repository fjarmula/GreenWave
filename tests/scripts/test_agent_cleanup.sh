#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

for path in .agent .agents .claude .codex .cursor .cursorrules .cline .mcp.json .graphifyignore AGENTS.md CLAUDE.md GEMINI.md frontend/AGENTS.md; do
  if [ -e "$root/$path" ] || [ -L "$root/$path" ]; then
    printf 'Unexpected development metadata: %s\n' "$path" >&2
    exit 1
  fi
done
grep -F 'Note for Evaluators:' "$root/README.md" >/dev/null
test -f "$root/.github/workflows/ci.yml"
test -f "$root/compose.yaml"
test -f "$root/backend/data/raw/MANIFEST.json"
printf 'submission cleanup: pass\n'
