# M8 — HUD Accuracy and Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development). Steps use checkbox (`- [ ]`) syntax. Master: `2026-10-22-repo-audit-master.md` (findings F7–F12, F14). Requires M1 and M2.

**Goal:** Every HUD element tells the truth about the current run, and the setup inputs explain failures instead of staying silent.

**Architecture:** Presentation-only changes inside `src/components/hud/` and `src/components/dashboard/`, with pure helpers in `src/lib/simulation-copy.ts` or small new modules. No simulation, transport or contract change.

**Tech stack:** React 19, TypeScript, Tailwind, Vitest, `playwright-cli`.

## Tasks

Each task is RED → GREEN with its own test, then snapshot word diffs. Run the full frontend gate after the last task.

### Task 1: ITS log highlights the newest entry (F7)

- Root cause: `ItsConsole.tsx:45` styles `index === 2`, a leftover from the static v0 design.
- [ ] RED: with 1, 3 and 7 entries, only the last visible entry has the highlight class (or `aria-current="true"`); each row number shows the message's sequence (from `MSG-ITS-<n>`), not its position in the visible window.
- [ ] GREEN.

### Task 2: Sign-aware time saved (F8)

- [ ] RED: a helper `timeSavedTone(seconds)` returns `positive` (> 0), `neutral` (0) or `negative` (< 0); `KpiHeader` applies emerald, muted or amber/red classes respectively, and the summary card's "Saved vs normal-traffic estimate" uses the same tone.
- [ ] GREEN. Copy is unchanged; colour must not be the only signal, so the existing sign is kept.

### Task 3: Address search feedback (F9)

- [ ] RED (`IncidentInput.test.tsx`):
  - status `error` → inline `role="alert"` "Address search unavailable — click the map instead";
  - `ready` with 0 results for a query of 2+ characters → "No matching address";
  - Enter with suggestions open and none highlighted → chooses the first suggestion;
  - Enter with no suggestions → nothing happens.
- [ ] GREEN (`address-search.ts` may need to expose the query its results belong to, to avoid flashing "No matching address" during the debounce).

### Task 4: Phase-aware header status (F10)

- [ ] RED: `DashboardHeader` dot colour by phase: SETUP and RUNNING emerald, STARTING amber, FINISHED muted, CANCELLED amber, ERROR red. Put the mapping beside `PHASE_LABELS`. Also (found in M2): a CANCELLED run with reason STOPPED reads "Simulation stopped" / "SIMULATION STOPPED" in the header label and KPI badge, not "cancelled". Also (found in M4): reason SERVER_ERROR reads "Simulation server error" / "SERVER ERROR" with the red (ERROR) dot, not "Simulation cancelled". And on phones (360 × 740) every terminal summary card (finished, stopped, server error) starts below the fold (y ≈ 697), so only its title edge shows. Bring the outcome on screen, e.g. a terminal status in the KPI strip or scrolling the card into view once.
- [ ] GREEN.

### Task 5: Vehicle-type icon and copy (F11)

- [ ] RED: with `startRequest.vehicle_type` FIRE_TRUCK, both `KpiHeader` and `VehicleTelemetry` render the fire-truck `VehicleIcon` and the label "Fire truck" (not "Priority vehicle" with an ambulance); before a run, they fall back to the ambulance.
- [ ] GREEN, reusing `VehicleIcon` and `VEHICLE_ICON_COLORS` from `src/components/map/`. Import only those presentational pieces, no map logic.

### Task 6: Intersection list ordering (F12)

- [ ] RED: with intersections [passed, passed, upcoming, upcoming], the list renders the upcoming ones first in route order, then a collapsed "Passed (2)" disclosure (`<details>`) that holds the passed cards. While the run is RUNNING, the heading reads "Route signals (TTI)" instead of "Active corridor signals", because the list holds all of them. Disabled-mode runs read the same.
- [ ] GREEN.

### Task 7: Visible station-load failure (F14)

- [ ] RED: `useStations` returns `{stations, error}`; on rejection, `DispatchForm` shows "Station list unavailable — check the backend" in the ranking area. Mock mode never errors.
- [ ] GREEN.

### Task 8: Review and browser acceptance

- [ ] Run the `emil-design-eng` review of the changed HUD pieces; apply only findings within this scope.
- [ ] Real backend, 1440 × 1000 and 390 × 844:
  - run a POLICE_CAR route at 10× with ≥ 3 intersections: police icon shown, the ITS highlight follows the newest entry, passed intersections collapse;
  - a DISABLED run whose saved value goes negative shows the non-success tone;
  - stub geocode → 503 for the error copy;
  - type a nonsense street for "No matching address";
  - stub stations → 503 for the station error.
- [ ] Light and dark themes; console 0 errors. Evidence under `.tmp/playwright/repo-audit/m8/`.

## Acceptance

- F7–F12 and F14 each have a passing test and are visible in the browser evidence.
- No transport, simulation or contract change; frontend gate green.
