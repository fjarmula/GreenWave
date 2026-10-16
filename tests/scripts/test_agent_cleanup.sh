#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

test -f "$root/.agent/MEMORY.md"
test ! -e "$root/.agents/FRONTEND_HANDOFF.md"
grep -F 'Agent workflow setup' "$root/docs/adr/0002-agent-workflow-setup.md" >/dev/null
