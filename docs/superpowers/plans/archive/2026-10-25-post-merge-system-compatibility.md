# Post-merge System Compatibility Implementation Plan

> **For agentic workers:** Use executing-plans or subagent-driven-development for these independently verifiable milestones; use TDD and verification-before-completion.

**Goal:** Fix the approved nine audit findings without altering ITS simulation policy.

**Architecture:** Serialize backend lifecycle mutations under SessionManager's existing lock and replay authoritative snapshots. Keep frontend arrival, lifecycle, geometry and presentation responsibilities separate using existing helpers and controls.

**Tech Stack:** Python/FastAPI/pytest; TypeScript/React/Vitest/Next.js/MapLibre.

**Spec:** `docs/superpowers/specs/2026-10-25-post-merge-system-compatibility-design.md`.

## Global Constraints

- Simulation only; no real signal actuation.
- Preserve engine/motion/controller and fixed hold-expiry policy.
- No new dependencies or hand-edited generated contracts.
- Branch `fix/post-merge-system-compatibility`; no push/PR/merge without renewed authorization.

## Review Focus

- Stop races with delayed planning and pair membership; old results cannot affect newer operations.
- Ended-stream snapshot/terminal ordering, including runs completing before subscription.
- Arrival during recovery and crossing endpoints; UI cannot infer arrival from completion alone.
- Hidden retained REJECTED scenario on driver/phone and normalized disabled settings.
- Off-road drive versus walk durations, completed versus failed/stopped comparison members.

## M1 — Backend lifecycle and ended snapshots

Files: `backend/src/greenwave/simulation/session.py`, `backend/tests/simulation/test_session.py`, related API/SSE tests.

- [x] Add deterministic blocked-planner tests for single and pair: schedule Stop during planning,
      release planning, assert Stop succeeds and all members end STOPPED with no active operation.
- [x] Add retained-stream test: final snapshot then exactly one terminal; no snapshot if none exists.
- [x] Run focused pytest to observe expected failures.
- [x] Serialize Stop under the existing lifecycle lock; replay latest before terminal.
- [x] Run session/API tests and backend quality suite; review diff; propose `fix: serialize stop with pending plans and replay final snapshots`.

## M2 — Comparison lifecycle, arrival and route progress

Files: `frontend/src/lib/comparison/{live-comparison,race}.ts`, `frontend/src/lib/route-position.ts`, `frontend/src/components/comparison/{ComparisonStage,ComparisonLivePane}.tsx` and tests.

- [x] Add regressions for successful Stop without SSE, preserving an already completed member,
      old Stop responses, arrival during recovery, crossing-endpoint route total and ended dock copy.
- [x] Run focused Vitest to observe each failure.
- [x] Confirm Stop for unfinished local members after HTTP success; distinguish ARRIVED ticks
      from terminal completion; sum route segment length; show waiting copy only while running.
- [x] Run comparison, geometry and presentation tests; review diff; propose `fix: reconcile comparison arrival stop and route progress`.

## M3 — ITS scenario visibility, walking summaries and stale rankings

Files: driver setup/settings, `driver-presentation.ts`, `simulation-copy.ts`, HUD `RunSummary.tsx`, comparison result, `useIncidentDispatch.ts` and tests.

- [x] Add regressions: retained REJECTED visible/selectable in driver/phone settings; disabled
      mode NOMINAL; off-road summary includes access point and separate walk; clear-to-null
      ignores a late ranking response. Preserve existing on-road and completed-result tests.
- [x] Observe focused failures, then implement through existing controls/helpers.
- [x] Run focused suites; review diff; propose `fix: expose retained scenarios and qualify off-road results`.

## M4 — Integration verification and independent review

- [x] Run full backend/frontend quality suites, production build and contract drift check.
- [x] Browser acceptance using playwright-cli only; artifacts under `.tmp/playwright/`:
      driver/phone feedback controls, backend comparison Stop, off-road result copy, no overflow.
- [x] Independent code review; fix important findings using regression tests.
- [x] Update verification record and plan checkboxes. Confirm clean scoped diff and report results.
