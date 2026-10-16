#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

for phrase in "Worktree and branch ownership" "Handoff protocol" "Review gates" "Contract changes"; do
  grep -F "$phrase" "$root/CONTRIBUTING.md" >/dev/null
done

test -f "$root/docs/adr/README.md"
test -f "$root/docs/adr/0001-template.md"
grep -F "Status" "$root/docs/adr/0001-template.md" >/dev/null
