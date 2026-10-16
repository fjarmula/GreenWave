#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
script="$project_root/scripts/setup-agent-env.sh"

test -x "$script"
"$script" --help | grep -F -- '--check'
"$script" --help | grep -F -- '--install'
grep -F 'graphify) uv tool install --upgrade graphifyy ;;' "$script" >/dev/null

if "$script" --unknown >/dev/null 2>&1; then
  echo "unknown arguments must fail" >&2
  exit 1
fi

jq -e '.mcpServers.graphify.command == "graphify"' "$project_root/.mcp.json" >/dev/null
jq -e '.mcpServers.context7.command == "npx"' "$project_root/.mcp.json" >/dev/null
if jq -e '.mcpServers.playwright' "$project_root/.mcp.json" >/dev/null; then
  echo "Playwright must remain CLI-only" >&2
  exit 1
fi

grep -F '[mcp_servers.graphify]' "$project_root/.codex/config.toml" >/dev/null
grep -F '[mcp_servers.context7]' "$project_root/.codex/config.toml" >/dev/null
if grep -F '[mcp_servers.playwright]' "$project_root/.codex/config.toml" >/dev/null; then
  echo "Playwright must remain CLI-only" >&2
  exit 1
fi

test -f "$project_root/graphify-out/graph.json"
test "$(jq -r '.built_at_commit' "$project_root/graphify-out/graph.json")" = "$(git -C "$project_root" rev-parse HEAD)"
if git -C "$project_root" check-ignore -q graphify-out/graph.json; then
  echo "graphify-out/graph.json must be tracked for CI" >&2
  exit 1
fi
