# M4 — Server-Error Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development). Steps use checkbox (`- [ ]`) syntax. Master: `2026-10-22-repo-audit-master.md` (decision D2; finding B5). Requires M2. **Contract change:** tell the human before editing `GreenWave_ARCHITECTURE.md` (AGENTS.md Git rule).

**Goal:** When the backend simulation loop fails, every subscriber immediately receives a terminal event, and the dashboard says *"Simulation server error. Retry the green corridor initialization."* with a way back to setup. A start request that fails with HTTP 5xx shows the same guidance.

**Architecture:** Add `SERVER_ERROR` to `CancelReason` (`schemas/simulation.py:83`). In `SessionManager._run`, after logging the exception, publish `SimulationCancelledEvent(reason=SERVER_ERROR)` through `_publish`. That sets `terminal`, so `finally` clears `_active`; later `stop` calls are no-ops and reconnects get the retained terminal. The change is additive to contract v1 (`schema_version` stays `"1.0"`), like ADR 0006. Regenerate OpenAPI and frontend types. The frontend validator accepts the reason, and `RunSummary` renders an error-tone card for it. Retry means going back to setup, where M3 keeps the settings, and initializing again; there is no automatic retry (domain invariants: no improvised retry).

**Tech stack:** Python, FastAPI, pytest, TypeScript, Vitest.

## Root cause

`session.py:176` catches the loop exception and only logs it. No terminal is published, so subscribers wait for their 15 s silence timeout and see a generic "No simulated telemetry" error; `_active` stays set to the dead session.

## File map

- `backend/src/greenwave/schemas/simulation.py`: `CancelReason.SERVER_ERROR = "SERVER_ERROR"`.
- `backend/src/greenwave/simulation/session.py`: publish the terminal in the `except` branch; update the module docstring.
- `backend/tests/simulation/test_session.py`: extend `test_engine_failure_is_logged_with_the_simulation_id`; new reconnect and stop cases.
- `backend/tests/api/test_simulation_stream_api.py` (or the existing SSE route test): the stream ends with `event: SIMULATION_CANCELLED` / `SERVER_ERROR`.
- Generated: `contracts/openapi.json`, `frontend/src/types/api.generated.ts` (via the commands only).
- `frontend/src/lib/transport/validate.ts`: `CANCEL_REASONS` adds `SERVER_ERROR` (the `Record<CancelReason, true>` type forces this after regeneration).
- `frontend/src/lib/simulation-copy.ts` (+ test): label "Server error"; `SERVER_ERROR_COPY` constant; `describeSimulationError` returns the same copy for `kind: "http"` with `status >= 500` and no code.
- `frontend/src/components/hud/RunSummary.tsx` (+ snapshot test): error tone for `SERVER_ERROR`.
- Docs: `docs/adr/0003-simulation-contract-v1.md` amendment note (or a new `docs/adr/0007-server-error-cancel-reason.md`, preferred: one accepted decision, linked from 0003); `GreenWave_ARCHITECTURE.md` §4 `SIMULATION_CANCELLED` reasons and §6.12-style additive note, **after telling the human**.

## Tasks

### Task 1: Backend terminal on failure

- [x] RED (`test_session.py`) with an engine whose `step` raises on tick 3:
  - a subscriber receives ticks 1–2 and then `SIMULATION_CANCELLED` with reason `SERVER_ERROR` and `tick == 2`, and the iterator ends;
  - a new `subscribe` gets only that terminal;
  - `stop` returns 200 without a second terminal;
  - a new `start` with another id is not reported as superseding (`_active` is `None`);
  - the exception is still logged with the simulation id.
- [x] GREEN: add the enum value and publish the terminal in the `except` branch. Rerun `uv run pytest tests/simulation/test_session.py -q`.
- [x] RED/GREEN at the HTTP level: the SSE route's frames end with `event: SIMULATION_CANCELLED` whose data has `"reason":"SERVER_ERROR"`.

### Task 2: Contract regeneration

- [x] `cd backend && uv run python scripts/export_openapi.py && cd ../frontend && npm run generate:types`; review that the diff only adds the enum value in both files. Run the contract drift test (`uv run pytest tests -k openapi`) and `npm run typecheck`. The typecheck should fail on `CANCEL_REASONS` and the reason label maps until Task 3, which confirms the types are wired.

### Task 3: Frontend

- [x] RED: `validate` test accepts a `SERVER_ERROR` cancel frame; `simulation-copy.test.ts` covers the label and 5xx start copy; the RunSummary test shows "Simulation server error. Retry the green corridor initialization." with `role="alert"` and the Back to dispatch setup button; the 4xx and network error copy is unchanged.
- [x] GREEN; frontend gate (update and word-diff any snapshot that changes).

### Task 4: Docs

- [x] Tell the human the exact §4 sentence(s) to be changed in `GreenWave_ARCHITECTURE.md`, then edit; write ADR 0007 (status Accepted, context D2, additive, mock never emits it).

### Task 5: Browser acceptance

- [x] Backend-transport dev server with a `page.route` SSE stub: two ticks, then a `SIMULATION_CANCELLED`/`SERVER_ERROR` frame. A real crash cannot be triggered without code changes, and the backend half is covered by Task 1. Check that the server-error card appears at once (not after 15 s), Back to dispatch setup works, and settings are kept. Stub start → HTTP 500 and check the same copy in setup. Evidence under `.tmp/playwright/repo-audit/m4/`.

## Acceptance

- A loop failure reaches clients as a terminal event within the same tick interval.
- The dashboard shows the D2 copy for loop failures and 5xx starts.
- Contract artifacts are regenerated and the drift check passes; ADR and architecture text match; both gates are green.
