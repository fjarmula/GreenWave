@AGENTS.md

## Claude-only
- Default `/caveman lite`. Bump to `full` for subagent handoffs.
- `.claude/settings.json` PreToolUse hook on Glob|Grep reminds to use graph first.
- `/compact` at task boundaries (after a plan is approved, after a green test run). Keep: plan, failing test, changed files.
