#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
workflow="$project_root/.github/workflows/ci.yml"

grep -F 'name: Graphify artifact freshness' "$workflow" >/dev/null
grep -F 'graphify-out/graph.json' "$workflow" >/dev/null
grep -F 'built_at_commit' "$workflow" >/dev/null
