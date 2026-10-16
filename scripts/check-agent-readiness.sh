#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test -f "$root/.agent/MEMORY.md"
for link in .claude/skills .codex/skills; do
  test "$(readlink "$root/$link")" = ../.agent/skills
done
# Claude Code only loads SKILL.md (graphify ships lowercase skill.md; SKILL.md is a symlink to it).
for skill in "$root"/.agent/skills/*; do
  test -f "$skill/SKILL.md"
done
"$root/scripts/setup-agent-env.sh" --check
jq empty "$root/.mcp.json"
test "$(jq -r '.mcpServers.graphify.command' "$root/.mcp.json")" = graphify-mcp
grep -F '[mcp_servers.graphify]' "$root/.codex/config.toml" >/dev/null
grep -F '[mcp_servers.context7]' "$root/.codex/config.toml" >/dev/null
test -f "$root/graphify-out/graph.json"
git -C "$root" merge-base --is-ancestor "$(jq -r '.built_at_commit' "$root/graphify-out/graph.json")" HEAD
printf 'agent readiness: pass\n'
