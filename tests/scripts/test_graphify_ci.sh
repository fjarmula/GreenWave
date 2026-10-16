#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
workflow="$project_root/.github/workflows/ci.yml"

grep -F 'graphify-build:' "$workflow" >/dev/null
grep -E "uv tool install 'graphifyy==[0-9]+\.[0-9]+\.[0-9]+'" "$workflow" >/dev/null
grep -F 'graphify update .' "$workflow" >/dev/null
grep -F 'test -s graphify-out/graph.json' "$workflow" >/dev/null
if grep -F 'built_at_commit' "$workflow" >/dev/null; then
  echo "ci.yml must not check built_at_commit (graphify output is not tracked, ADR 0004)" >&2
  exit 1
fi
if grep -F 'graphify-artifact' "$workflow" >/dev/null; then
  echo "the graphify-artifact job must be gone" >&2
  exit 1
fi
