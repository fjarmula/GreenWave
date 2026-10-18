#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
checker="$root/scripts/check-commit-message.sh"

test -x "$checker"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

for subject in \
  'feat: add local commit-message validation' \
  'fix: engine ambulance position, density-scaled KPI and D13 timing' \
  'refactor: consolidate agent documentation (#12)' \
  'test: cover malformed commit subjects' \
  'chore: refresh local tooling'; do
  printf '%s\n' "$subject" >"$tmp/message"
  "$checker" "$tmp/message"
done

for subject in \
  'feature: use an unsupported category' \
  'feat:add a missing separator' \
  'feat: ' \
  'Merge pull request #7'; do
  printf '%s\n' "$subject" >"$tmp/message"
  if "$checker" "$tmp/message" >/dev/null 2>&1; then
    printf 'accepted invalid subject: %s\n' "$subject" >&2
    exit 1
  fi
done

python3 - "$root/.pre-commit-config.yaml" <<'PY'
import sys
import yaml

config = yaml.safe_load(open(sys.argv[1]))
assert "commit-msg" in config["default_install_hook_types"]
hooks = {h["id"]: h for repo in config["repos"] for h in repo["hooks"]}
hook = hooks["commit-message-format"]
assert hook["entry"] == "scripts/check-commit-message.sh"
assert hook["stages"] == ["commit-msg"]
PY

grep -F 'github.event.pull_request.base.sha }}..${{ github.event.pull_request.head.sha' \
  "$root/.github/workflows/ci.yml" >/dev/null
