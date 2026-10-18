#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ] || [ ! -r "$1" ]; then
  printf 'usage: %s <commit-message-file>\n' "$0" >&2
  exit 2
fi

subject=$(sed -n '1p' "$1")
pattern='^(feat|fix|refactor|docs|test|chore|build|ci|perf|style|revert): [^[:space:]].*$'

if ! printf '%s\n' "$subject" | grep -Eq "$pattern"; then
  printf 'invalid commit subject: %s\n' "$subject" >&2
  printf 'expected: <category>: <message>\n' >&2
  printf 'allowed categories: feat, fix, refactor, docs, test, chore, build, ci, perf, style, revert\n' >&2
  exit 1
fi
