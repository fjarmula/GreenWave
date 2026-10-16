#!/usr/bin/env bash
# Refresh the local code graph (graphify-out/, gitignored, ADR 0004). Never fails.
#
# Called by Claude Code hooks, Codex hooks and git hooks (via pre-commit). Safe to call from any
# directory or worktree; skips when graphify is missing or a refresh is already running.
#   --json   print `{}` on stdout (Codex Stop hooks must print JSON). Otherwise stdout is empty.
set -uo pipefail

json=0
[ "${1:-}" = "--json" ] && json=1

refresh() {
  command -v graphify >/dev/null 2>&1 || return 0

  local script_dir root log_dir log lock
  script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || return 0
  root=$(git -C "$script_dir" rev-parse --show-toplevel 2>/dev/null) || return 0
  cd "$root" || return 0

  mkdir -p .tmp || return 0
  if ! git check-ignore -q .tmp/graphify-refresh.log; then
    printf 'graphify-refresh: .tmp/ is not gitignored; skipping refresh\n' >&2
    return 0
  fi
  log=.tmp/graphify-refresh.log
  lock=.tmp/graphify-refresh.lock

  # mkdir is atomic and portable (no flock on macOS). A lock older than 5 minutes is stale.
  if ! mkdir "$lock" 2>/dev/null; then
    if [ -n "$(find "$lock" -maxdepth 0 -mmin +5 2>/dev/null)" ]; then
      rm -rf "$lock"
      mkdir "$lock" 2>/dev/null || return 0
    else
      return 0
    fi
  fi
  trap 'rmdir "$lock" 2>/dev/null' RETURN

  graphify update . >"$log" 2>&1
  return 0
}

refresh || true
[ "$json" = 1 ] && printf '{}\n'
exit 0
