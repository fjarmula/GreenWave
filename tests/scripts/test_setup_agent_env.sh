#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
script="$project_root/scripts/setup-agent-env.sh"

# Agent configuration is intentionally omitted from the evaluation snapshot.
if [ ! -e "$project_root/.mcp.json" ] && [ ! -d "$project_root/.agent" ]; then
  printf 'SKIP: agent configuration is intentionally omitted from the submission snapshot\n'
  exit 0
fi

test -x "$script"
"$script" --help | grep -F -- '--check'
"$script" --help | grep -F -- '--install'
grep -F "graphify) uv tool install --upgrade 'graphifyy[mcp]' ;;" "$script" >/dev/null

if "$script" --unknown >/dev/null 2>&1; then
  echo "unknown arguments must fail" >&2
  exit 1
fi

jq -e '.mcpServers.graphify.command == "graphify-mcp"' "$project_root/.mcp.json" >/dev/null
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

# Graphify output is generated locally and never committed (ADR 0004).
test -z "$(git -C "$project_root" ls-files graphify-out)"
git -C "$project_root" check-ignore -q graphify-out/graph.json || {
  echo "graphify-out/ must be gitignored" >&2
  exit 1
}

# --check reports a missing graph with an actionable message and never builds it.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/scripts"
cp "$script" "$tmp/scripts/"
if (cd "$tmp" && ./scripts/setup-agent-env.sh --check) >"$tmp/out" 2>"$tmp/err"; then
  echo "--check must fail when graphify-out/graph.json is missing" >&2
  exit 1
fi
grep -F 'missing: graphify-out/graph.json (run: graphify update .)' "$tmp/err" >/dev/null
test ! -e "$tmp/graphify-out"
