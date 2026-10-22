# M3 — Keep Settings and Previous Result Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development). Steps use checkbox (`- [ ]`) syntax. Master: `2026-10-22-repo-audit-master.md` (findings F1, F3; decision D3). Requires M2.

**Goal:** After a run, setup still holds the chosen traffic density, ER Green Wave mode, cascade and playback speed, and shows the last finished run's result, so an enabled and a disabled run can be compared one after the other (architecture §6.12).

**Architecture:** `DispatchSettings` state moves from `DispatchForm` into `Dashboard`, which outlives mode switches; `DispatchForm` becomes controlled (`settings`, `onSettingsChange`). `Dashboard` captures a `PreviousRun` record (`{greenWaveMode, totalSeconds, savedSeconds, normalEstimateSeconds, stationName, incidentLabel, trafficDensity}`) when the user leaves a **FINISHED** run via Back to dispatch setup. A `PreviousRunCard` in the form shows it (reusing `summarizeFinishedRun` formatting) until the next finished run replaces it. UI state only; nothing persists across a page reload.

**Tech stack:** React 19, TypeScript, Vitest, `playwright-cli`.

## Root cause

`DispatchForm.tsx:47-50` keeps the settings in `useState`, and `Dashboard` unmounts the form in live mode (`dashboard.tsx:67`), so every remount restores the defaults: ENABLED, density default, cascade on, 1×. Back to dispatch setup dispatches `RESET`, which drops `routeData` and `completion`, the only record of the result.

## File map

- `frontend/src/lib/start-request.ts`: export `DEFAULT_DISPATCH_SETTINGS`.
- `frontend/src/lib/previous-run.ts` (new, + `.test.ts`): `toPreviousRun(state, stationName, incidentLabel)` → `PreviousRun | null` (only for FINISHED with `routeData`, `completion`, `startRequest`).
- `frontend/src/components/hud/DispatchForm.tsx`: controlled settings props; render `PreviousRunCard` above the Start button when present.
- `frontend/src/components/hud/dispatch/PreviousRunCard.tsx` (new, + test).
- `frontend/src/components/dashboard.tsx`: own `settings` and `previousRun`; capture in `backToSetup` before stopping.
- Snapshots: `DispatchForm.{mock,backend}.html`, `Dashboard.setup.{mock,backend}.html` (setup markup is unchanged when there is no previous run).

## Tasks

### Task 1: Pure capture

- [ ] RED (`previous-run.test.ts`): FINISHED → record with mode, total and saved from `completion.kpi_metrics`, the normal estimate from `routeData`, and density from `startRequest`; CANCELLED, ERROR, RUNNING and SETUP → `null`.
- [ ] GREEN.

### Task 2: Controlled form

- [ ] RED (`DispatchForm` test): changing mode or density calls `onSettingsChange` with the full updated settings, and the rendered controls reflect the `settings` prop; the cascade toggle stays disabled under DISABLED.
- [ ] GREEN; existing snapshots must be byte-identical (word diff empty).

### Task 3: Dashboard wiring and card

- [ ] RED (dashboard-level test with the mock adapter and fake timers, or the existing dashboard test harness): set DISABLED and density 2.0 → start → let the mock run finish → Back to dispatch setup → the form still shows DISABLED and 2.0, and a "Previous run" card shows "ER Green Wave disabled" and the total time. Start an ENABLED run and finish it → the card now shows the enabled result. Stopping a run (M2) leaves the previous card unchanged.
- [ ] RED (`PreviousRunCard` test): labelled as simulated ("Previous simulated run"), mode first, then total travel time and saved vs normal; region role and heading for screen readers.
- [ ] GREEN; frontend gate.

### Task 4: Browser acceptance

- [ ] Real backend at 1440 × 1000 and 390 × 844: same incident, run ENABLED at 10× to the end → back → switch to DISABLED → card shows the enabled result → run → back → card shows the disabled result; settings unchanged at each step. The card fits within the 320 px and 390 px aside without horizontal overflow (`main.scrollWidth == innerWidth`). Run the `emil-design-eng` review. Evidence under `.tmp/playwright/repo-audit/m3/`.

## Acceptance

- Settings survive any number of runs within one page session.
- The last finished result is visible in setup and clearly labelled as previous and simulated.
- Frontend gate green; no backend or contract change.
