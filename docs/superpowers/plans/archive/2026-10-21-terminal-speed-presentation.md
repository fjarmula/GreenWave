# Terminal Speed Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Never present the final moving interval's speed as the vehicle's current speed after a run finishes, is cancelled, or loses telemetry.

**Architecture:** Keep the backend's interval-speed contract and stream unchanged. Add a pure frontend presentation function shared by the KPI strip and vehicle card. On completion, display current speed as `0.0 km/h`; on cancellation/error, display no current speed; while running, show the latest measured interval speed with an accurate label.

**Tech Stack:** TypeScript, React, Vitest, `playwright-cli`.

**Spec:** `docs/superpowers/specs/2026-10-21-terminal-speed-presentation-design.md`.

## Root cause

The backend intentionally reports the distance moved during the arrival tick as `speed_kmh` (`test_arrival_tick_reports_the_distance_actually_driven`). A route that completes on that tick has no later zero-speed tick to replace it. `KpiHeader` and `VehicleTelemetry` render the retained value regardless of `simulationState`, so the finished screen showed 37.5 km/h, and a cancelled screen kept its last moving sample. Changing backend speed would break an established contract; the display must distinguish interval history from current state.

## Global Constraints

- Do not edit backend motion, telemetry, Pydantic schemas, OpenAPI, or generated TypeScript.
- Keep the retained last tick for map position and final KPI display; do not erase it to hide speed.
- Use the same speed rule in desktop KPI and vehicle card, including mock/backend transports.
- Do not claim current speed on cancelled/error screens. Keep English copy and current responsive layout.
- Apply TDD and update the master only after focused and full checks pass.
- After each task, report changed files, checks and results, decisions or blockers, and a proposed Conventional Commit subject; continue to the next task unless blocked.

## File map

- `frontend/src/lib/simulation-copy.ts`: pure `vehicleSpeedPresentation()` function.
- `frontend/src/lib/simulation-copy.test.ts`: state/sample matrix.
- `frontend/src/components/hud/KpiHeader.tsx` and `frontend/src/components/dashboard/VehicleTelemetry.tsx`: use one presentation result instead of raw `speed_kmh`.
- Relevant component snapshots only if markup changes.

## Review Focus

- A completed run whose final arrival tick has positive interval speed shows `0.0 km/h`; Task 1 test and Task 2 browser check.
- Cancelled and errored runs retain map position but no current-speed claim; Task 1 test and Task 2 browser check.
- A running zero-speed dwell still shows `0.0 km/h`, not missing data; Task 1 test.
- A running tick with positive speed remains visible with a last-interval label; Task 1 test.
- A run with no tick yet shows an unavailable value rather than `0.0`; Task 1 test.

---

### Task 1: Define and test one phase-aware speed view

**Files:**
- Modify: `frontend/src/lib/simulation-copy.ts`, `frontend/src/lib/simulation-copy.test.ts`, `frontend/src/components/hud/KpiHeader.tsx`, `frontend/src/components/dashboard/VehicleTelemetry.tsx`

**Interfaces:**
- Produce: `vehicleSpeedPresentation(phase: SimulationPhase, telemetry: SimulationTickEvent | null): { value: string; label: string }` in `simulation-copy.ts`.
- `RUNNING` plus a tick returns the formatted tick speed and `Speed during last simulated second`; `FINISHED` returns `0.0` and `At destination`; `CANCELLED`/`ERROR` return `—` and `No current speed`; no tick before RUNNING returns `—` and `Awaiting telemetry`.

- [ ] **Step 1: Add failing table tests** for `RUNNING` positive/zero speed, `FINISHED` with positive arrival-tick speed, `CANCELLED`, `ERROR`, and initial/no tick. Include both `ARRIVED` and non-arrived final samples to make the phase rule explicit.
- [ ] **Step 2: Verify red.** Run `cd frontend && npm test -- lib/simulation-copy.test.ts`; expect failure because the helper is absent.
- [ ] **Step 3: Implement the pure helper and use it in both components.** Keep the old event object intact. Render the label as visible or screen-reader text where layout is tight; do not duplicate conditional speed logic in JSX.
- [ ] **Step 4: Verify green.** Run the same focused command; expect pass. Run affected component snapshot tests and inspect/update snapshots only if rendering changes: `cd frontend && npm test -- components/dashboard-parts.snapshot.test.tsx components/hud/RunSummary.snapshot.test.tsx`.

### Task 2: Verify terminal behavior in browser and close out

**Files:**
- Modify: `docs/superpowers/plans/2026-10-21-simulation-audit-master.md` status and evidence only after verification.

**Interfaces:** Consumes `vehicleSpeedPresentation()` from Task 1; produces browser evidence and the item-3 completion record.

- [ ] **Step 1: Reproduce an enabled backend run at 10× using `playwright-cli`.** At completion, expect the summary to retain final time/KPIs and both speed displays to read `0.0 km/h`. Preserve browser output under `.tmp/playwright/`.
- [ ] **Step 2: Start a 1× run and supersede or stop it.** Expect no current-speed number on the terminal cancelled view and the last position to remain visibly historical.
- [ ] **Step 3: Run the frontend gate.** `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`; expect exit 0.
- [ ] **Step 4: Inspect `git diff --check`, `git diff`, and `git status --short`.** Confirm no backend/API change. Mark item 3 `[Completed]` in the master with browser and test evidence. Propose `fix: distinguish terminal state from last interval speed`; stage explicit paths only if committing locally.
