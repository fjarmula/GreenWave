# M2 — Live-Run Flow and Stop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development). Steps use checkbox (`- [ ]`) syntax. Master: `2026-10-22-repo-audit-master.md` (decision D1; findings F2, F13).

**Goal:** After initialization the dashboard is only the Live operations view. A Stop button is visible while the run is live. Stopping shows a stopped summary whose action returns to Dispatch setup.

**Architecture:**
- **State:** `SimulationState` gains `stopRequested: boolean` and `stopError: string | null` (no new phase, so existing `Record<SimulationPhase, …>` maps stay intact). New actions:
  - `STOP_REQUESTED {simulationId}`: RUNNING only, sets `stopRequested`.
  - `STOP_CONFIRMED {simulationId}`: if still RUNNING → `CANCELLED` / `STOPPED`, exactly as the terminal event would.
  - `STOP_FAILED {simulationId, error}`: clears `stopRequested` and sets `stopError`; the run keeps going.
- **Controller:** a new `requestRunStop(adapter, simulationId, dispatch)` dispatches `STOP_REQUESTED`, awaits `adapter.stop`, then `STOP_CONFIRMED` or `STOP_FAILED`. The existing `requestSimulationStop` (RESET + best-effort stop) stays for "Back to dispatch setup" and abandoned starts.
- **Transport:** the backend adapter's `stop` no longer closes the stream first, so the server's `SIMULATION_CANCELLED/STOPPED` arrives through the normal terminal path. `STOP_CONFIRMED` covers a stream that is down; the reducer ignores whichever comes second. The mock already emits the terminal on stop.
- **UI:** `RunSummary` renders a "Simulation running" card with a Stop button for RUNNING, and `DashboardHeader` drops the mode tabs in favour of a static view label. `Dashboard` stops passing `onModeChange`.

**Tech stack:** React 19, TypeScript, Vitest, `playwright-cli`.

## Root cause

`dashboard.tsx:62` stops the run whenever the Dispatch setup tab is clicked, and `RunSummary` returns `null` while RUNNING, so a run has no visible stop control. The Live operations tab can be opened before any run (F13). `backend-simulation-adapter.ts` `stop()` calls `streams.get(id)?.()` before the POST, so the STOPPED terminal is never received.

## File map

- `frontend/src/lib/simulation-state.ts` (+ `.test.ts`): fields and actions above.
- `frontend/src/lib/simulation-controller.ts` (+ `.test.ts`): `requestRunStop`.
- `frontend/src/lib/useSimulationStream.ts`: expose `stopRun()` beside `startSimulation` / `stopSimulation`.
- `frontend/src/lib/transport/backend-simulation-adapter.ts` (+ `backend-simulation-adapter.test.ts`): stop keeps the stream open.
- `frontend/src/components/hud/RunSummary.tsx` (+ snapshot test): RUNNING card, Stop button (pending state "Stopping…", `aria-busy`), `stopError` alert, STOPPED copy "Simulation stopped".
- `frontend/src/components/dashboard/RoutePreview.tsx`: pass `onStop` with `onBackToSetup` to both desktop and mobile `RunSummary` slots.
- `frontend/src/components/dashboard/DashboardHeader.tsx`: remove `ModeButton`/nav; render a non-interactive label ("Dispatch setup" / "Live operations").
- `frontend/src/components/dashboard.tsx`: drop `onModeChange`; mode becomes live only after a successful start, setup only via Back to dispatch setup.
- Snapshots: `components/__snapshots__/Dashboard.setup.{mock,backend}.html`, `hud/__snapshots__/RunSummary.*.html`.

## Tasks

### Task 1: Reducer

- [ ] RED (`simulation-state.test.ts`):
  - `STOP_REQUESTED` sets `stopRequested` only while RUNNING and only for the current id.
  - `STOP_CONFIRMED` → CANCELLED/STOPPED with `connection: null`; a later `TERMINAL` is ignored, and `STOP_CONFIRMED` after `TERMINAL` is ignored.
  - `STOP_FAILED` keeps RUNNING, clears `stopRequested` and sets `stopError`.
  - `START_REQUESTED` and `RESET` clear both fields.
- [ ] GREEN.

### Task 2: Controller and hook

- [ ] RED (`simulation-controller.test.ts`) with a fake adapter: resolve → `STOP_REQUESTED`, `STOP_CONFIRMED`; reject → `STOP_REQUESTED`, `STOP_FAILED` with `describeSimulationError` text; no `RESET` dispatched.
- [ ] GREEN; add `stopRun` to `useSimulationStream`, using the current `simulationId` and only while RUNNING.

### Task 3: Backend adapter stop keeps the stream

- [ ] RED (`backend-simulation-adapter.test.ts`, fake `EventSource`/`fetch`): after `stop()` resolves, a `SIMULATION_CANCELLED` frame (reason STOPPED) still reaches `onTerminal` and then closes the source; a 404 stop still resolves.
- [ ] GREEN: remove the pre-POST close in `stop`. Check that nothing else relied on it: `requestSimulationStart`'s abandoned-run stop has no subscription yet; the stream effect cleanup closes it on phase change.

### Task 4: UI

- [ ] RED:
  - `RunSummary` tests: RUNNING shows the Stop button; clicking it calls `onStop`; `stopRequested` → disabled with "Stopping…"; `stopError` → alert; CANCELLED/STOPPED shows "Simulation stopped" with Back to dispatch setup.
  - `DashboardHeader`: no buttons inside the header nav region; label text matches the mode.
  - Dashboard test: no "Live operations" button in setup.
- [ ] GREEN; update the Dashboard and RunSummary snapshots and word-diff them.
- [ ] Frontend gate; `graphify update .`.

### Task 5: Browser acceptance (real backend and mock)

- [ ] At 1440 × 1000 and 390 × 844, in backend mode, then repeat in a mock production build:
  1. Start at 1× and check that the setup tab is gone and Stop is visible without scrolling at both widths. At 390 px, if the mobile `RunSummary` slot sits below the fold, move the Stop control into the KPI strip and record the deviation.
  2. Click Stop and see "Simulation stopped". The backend log shows `POST /stop` 200 and the stream receives `SIMULATION_CANCELLED` with reason STOPPED.
  3. Click Back to dispatch setup: setup shows, with the incident and station kept.
- [ ] Failure case: stub the stop POST as 503 with `page.route`; an error alert appears and the run keeps ticking.
- [ ] Console: 0 errors. Evidence under `.tmp/playwright/repo-audit/m2/`.

## Acceptance

- No way to leave a live run except Stop (or a terminal state) followed by Back to dispatch setup.
- Stop is reachable on desktop and phone; stopping never jumps straight to setup.
- Frontend gate green; no backend or contract change.
