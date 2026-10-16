# 0002: Agent workflow setup

- Status: Accepted
- Date: 2026-10-16
- Owners: @fjarmula @Piotrek406
- Supersedes: None

## Context

Claude Code and Codex need the same project rules, skills, navigation workflow, and reproducible local tooling.

## Decision

Store shared skills in `.agent/skills/`, with `.claude/skills` and `.codex/skills` symlinked there. Use root `.mcp.json` for Claude Code and `.codex/config.toml` for Codex. Register Graphify and Context7 as MCP servers. Use `@playwright/cli` only; do not add `@playwright/mcp`. Validate setup with `scripts/check-agent-readiness.sh`.

## Consequences

All contributors must run the bootstrap and readiness scripts on a new machine. Graphify output is a tracked repository artifact. Project instructions, ADRs, and durable state stay separate from one-off handoffs.

## Alternatives considered

Per-agent duplicate skill directories and user-only MCP configuration were rejected because they drift between tools and contributors.

## Validation

Run `scripts/check-agent-readiness.sh`, inspect MCP registrations, and keep the graph artifact present in CI.
