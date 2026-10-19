# Agent Readiness Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore reproducible graph navigation and configure safe, shared Phase 1 agent tooling.

**Architecture:** The committed bootstrap installs or verifies host CLIs and exposes a non-mutating `--check` mode. Claude Code reads a root `.mcp.json`; Codex reads trusted-project `.codex/config.toml`. Graphify and Context7 are MCP servers. Playwright remains a CLI-only tool because `AGENTS.md` forbids `@playwright/mcp`.

**Tech Stack:** POSIX shell, `uv`, npm, JSON, TOML, GitHub Actions.

**Spec:** User message “Execution Plan: Fix Runtime Setup & Agent Readiness”, Phase 1.

## Global Constraints

- Do not hardcode credentials; use environment variables only when a server needs them.
- Do not configure `@playwright/mcp`; use `@playwright/cli` via Bash.
- Preserve generated graph artifacts in `graphify-out/`.
- CI must fail when graph artifacts are missing or do not represent `HEAD`.

## Review Focus

- Missing CLIs must make `--check` fail with an actionable message.
- `--install` must install only missing CLI packages and re-check them.
- JSON and TOML configuration must parse without secrets.
- CI freshness validation must reject a missing graph file and commit mismatch.
- MCP server commands must start from the repository root without machine-specific paths.

### Task 1: Bootstrap script

**Files:**
- Create: `tests/scripts/test_setup_agent_env.sh`
- Create: `scripts/setup-agent-env.sh`

**Interfaces:**
- Produces: `scripts/setup-agent-env.sh --check|--install`, exit 0 only when all required CLIs are available.

- [ ] **Step 1: Write failing shell test**

Assert the script exists, is executable, documents `--check` and `--install`, and rejects unknown arguments.

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/scripts/test_setup_agent_env.sh`

Expected: FAIL because `scripts/setup-agent-env.sh` does not exist.

- [ ] **Step 3: Implement bootstrap script**

Use `uv tool install --upgrade graphifyy`, `npm install --global ctx7@latest`, `npm install --global @playwright/cli@latest`, and `npm install --global @anthropic-ai/claude-code@latest` only in `--install` mode. `--check` must not mutate the host.

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/scripts/test_setup_agent_env.sh`

Expected: PASS.

### Task 2: MCP configuration and graph CI validation

**Files:**
- Create: `.mcp.json`
- Create: `.codex/config.toml`
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/setup-agent-env.sh`
- Modify: `tests/scripts/test_setup_agent_env.sh`

**Interfaces:**
- Consumes: `graphify-out/graph.json` generated at the current commit.
- Produces: machine-independent Claude and Codex MCP registrations for Graphify and Context7.

- [ ] **Step 1: Write failing shell test**

Assert both configuration files exist and parse; assert Graphify and Context7 registration; assert no Playwright MCP registration.

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/scripts/test_setup_agent_env.sh`

Expected: FAIL because configuration files do not exist.

- [ ] **Step 3: Implement configuration and CI guard**

Use repository-relative commands only. Compare graph metadata’s source commit against `git rev-parse HEAD` in CI.

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/scripts/test_setup_agent_env.sh`

Expected: PASS.

### Task 3: Graph artifact restoration

**Files:**
- Create: `graphify-out/graph.json`
- Modify: `graphify-out/GRAPH_REPORT.md`

**Interfaces:**
- Consumes: current `HEAD` and the Graphify CLI.
- Produces: queryable graph data and a report built at the current commit.

- [ ] **Step 1: Install Graphify if absent**

Run: `uv tool install --upgrade graphifyy`

- [ ] **Step 2: Regenerate graph artifact**

Run: `graphify . --no-viz`.

- [ ] **Step 3: Verify fresh graph metadata**

Run: `git rev-parse HEAD` and inspect `graphify-out/graph.json` metadata.

Expected: graph source commit equals `HEAD`.

## Self-Review

- Scope covers Phase 1 only; Phase 2 and Phase 3 remain unmodified.
- Bootstrap behavior, config syntax, CI freshness, and graph generation each have a verification step.
- Playwright MCP is intentionally excluded to preserve the explicit repository safety rule.
