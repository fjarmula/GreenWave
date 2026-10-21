# ER Green Wave Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct disabled-mode motion and high-zoom simulated phase rendering without regressing enabled Green Wave behaviour.

**Architecture:** This work is split at domain boundaries. First establish one deterministic phase decision and movement support; then make disabled motion consume that decision; finally make mock and MapLibre presentation consume the same contract.

**Tech Stack:** Python 3.12, Pydantic, pytest; TypeScript, React, MapLibre, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-er-green-wave-corrections-design.md`

## Global Constraints

- Read the correction design and the original 2026-10-20 design before implementation; this design supersedes only the identified behaviour.
- Simulation only; no live signal integration or operational claims.
- Preserve enabled motion, route choice, open-road speed, and the stream envelope.
- Pydantic schemas are canonical; generated contract files are never hand-edited.
- Preserve unrelated working-tree changes; stage explicit paths and do not push or open a PR.

## Execution order

1. `2026-10-21-er-green-wave-phase-domain.md`
2. `2026-10-21-er-green-wave-rolling-motion.md`
3. `2026-10-21-er-green-wave-phase-ui.md`

Plans 2 and 3 require Plan 1. Plan 3 uses the completed motion semantics when it updates mock transport.

## Review Focus

- A legacy omitted mode remains enabled throughout all three increments.
- Yellow takes the cautious disabled path and cannot be interpreted as permissive green.
- A phase-less intersection stays visible at high zoom without fabricated geometry.
- A pedestrian-only source node never produces a vehicle light.
- A disabled mock run exposes neither cascade links nor a stationary fake clearance.

## Completion checklist

- [ ] Execute the three linked plans in order and run each plan's focused checks.
- [ ] Add the legacy omitted-mode API/schema regression in the phase-domain increment.
- [ ] Export OpenAPI and regenerate TypeScript only if the completed domain contract changed.
- [ ] Run `cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`.
- [ ] Run `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`.
- [ ] Review `git diff --check`, scoped diff, and `git status --short` before proposing final commits.
