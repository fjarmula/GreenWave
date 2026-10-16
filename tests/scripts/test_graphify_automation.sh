#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
script="$root/scripts/graphify-refresh.sh"

test -x "$script"

# A PATH with the basic tools but no graphify.
bin=$(mktemp -d)
trap 'rm -rf "$bin"' EXIT
for tool in bash git dirname mkdir find rm rmdir cat; do
  ln -s "$(command -v "$tool")" "$bin/$tool"
done
! PATH="$bin" command -v graphify >/dev/null 2>&1

out=$(PATH="$bin" "$script")
test -z "$out"
test "$(PATH="$bin" "$script" --json)" = "{}"
test "$("$script" --json)" = "{}"

# Works from a subdirectory and prints nothing on stdout without --json.
out=$(cd "$root/scripts" && PATH="$bin" "$script")
test -z "$out"
(cd "$root/backend" && "$script" >/dev/null)

# Claude Code hooks.
jq -e '.hooks.SessionStart[].hooks[].command | contains("scripts/graphify-refresh.sh")' \
  "$root/.claude/settings.json" >/dev/null
jq -e '.hooks.Stop[].hooks[].command | contains("scripts/graphify-refresh.sh")' \
  "$root/.claude/settings.json" >/dev/null
jq -e '.hooks.PreToolUse | length > 0' "$root/.claude/settings.json" >/dev/null
jq -e '.permissions.allow | length > 0' "$root/.claude/settings.json" >/dev/null

# Codex hooks.
jq -e '.hooks.SessionStart[0].matcher == "startup|resume"' "$root/.codex/hooks.json" >/dev/null
jq -e '.hooks.SessionStart[].hooks[].command | contains("graphify-refresh.sh")' \
  "$root/.codex/hooks.json" >/dev/null
jq -e '.hooks.Stop[].hooks[].command | (contains("graphify-refresh.sh") and endswith(" --json"))' \
  "$root/.codex/hooks.json" >/dev/null

# Git hooks via pre-commit.
python3 - "$root/.pre-commit-config.yaml" <<'PY'
import sys
import yaml

config = yaml.safe_load(open(sys.argv[1]))
types = config["default_install_hook_types"]
for stage in ("pre-commit", "pre-push", "post-checkout", "post-merge", "post-rewrite"):
    assert stage in types, stage
hooks = {h["id"]: h for repo in config["repos"] for h in repo["hooks"]}
refresh = hooks["graphify-refresh"]
assert refresh["stages"] == ["post-checkout", "post-merge", "post-rewrite"], refresh
assert refresh["entry"] == "scripts/graphify-refresh.sh"
assert refresh["language"] == "system"
assert refresh["pass_filenames"] is False and refresh["always_run"] is True
new_stages = {"post-checkout", "post-merge", "post-rewrite"}
for hook_id, hook in hooks.items():
    if hook_id != "graphify-refresh":
        stages = set(hook.get("stages", config["default_stages"]))
        assert not stages & new_stages, hook_id
PY
