#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test -f "$root/.agent/MEMORY.md"
for link in .agents/skills .claude/skills .codex/skills; do
  test "$(readlink "$root/$link")" = ../.agent/skills
done
# Every shared skill has a canonical SKILL.md entry point.
for skill in "$root"/.agent/skills/*; do
  test -f "$skill/SKILL.md"
done
"$root/scripts/setup-agent-env.sh" --check
jq empty "$root/.mcp.json"
test "$(jq -r '.mcpServers.graphify.command' "$root/.mcp.json")" = graphify-mcp
grep -F '[mcp_servers.graphify]' "$root/.codex/config.toml" >/dev/null
grep -F '[mcp_servers.context7]' "$root/.codex/config.toml" >/dev/null
if [ ! -f "$root/graphify-out/graph.json" ]; then
  printf 'missing: graphify-out/graph.json (run: graphify update .)\n' >&2
  exit 1
fi
printf 'agent readiness: pass\n'
