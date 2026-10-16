#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/setup-agent-env.sh [--check|--install]

  --check    Verify required agent CLIs are available; do not modify the host.
  --install  Install missing agent CLIs, then verify them.
EOF
}

required_tools=(graphify ctx7 playwright-cli claude)

install_tool() {
  case "$1" in
    graphify) uv tool install --upgrade graphifyy ;;
    ctx7) npm install --global ctx7@latest ;;
    playwright-cli) npm install --global @playwright/cli@latest ;;
    claude) npm install --global @anthropic-ai/claude-code@latest ;;
    *)
      printf 'unsupported tool: %s\n' "$1" >&2
      return 2
      ;;
  esac
}

check_tools() {
  local missing=0
  local tool
  for tool in "${required_tools[@]}"; do
    if command -v "$tool" >/dev/null 2>&1; then
      printf 'found: %s\n' "$tool"
    else
      printf 'missing: %s\n' "$tool" >&2
      missing=1
    fi
  done
  return "$missing"
}

install_missing_tools() {
  local tool
  for tool in "${required_tools[@]}"; do
    if command -v "$tool" >/dev/null 2>&1; then
      printf 'already installed: %s\n' "$tool"
      continue
    fi
    printf 'installing: %s\n' "$tool"
    install_tool "$tool"
  done
}

case "${1:---check}" in
  --check)
    check_tools
    ;;
  --install)
    install_missing_tools
    hash -r
    check_tools
    ;;
  --help|-h)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
