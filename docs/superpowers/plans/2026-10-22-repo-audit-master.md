# Repository Audit 2026-10-22: Master Execution Plan

Single status record for the 2026-10-22 audit (frontend UX/UI and backend). It follows `2026-10-21-simulation-audit-master.md`, whose five items are complete and out of scope. Execute the milestones below **one at a time, in order**. Each one links a sub-plan with its own tasks, tests and acceptance checks. This file is also the design record: the findings and decisions below are the spec for every sub-plan.

## Status legend and update rule

- `[Pending]`: no product change has started.
- `[In Progress]`: the sub-plan is being implemented or verified.
- `[Completed]`: its acceptance criteria and required checks passed; evidence recorded below.

Move one checkbox at a time from `- [ ] [Pending]` → `- [ ] [In Progress]` → `- [x] [Completed]`, the last only after fresh verification. Under "Completion records", add the date, commands, results, files and any deviation. Keep earlier records. If blocked, leave the box open and record the blocker; never mark a partial fix complete. Local commits follow the `AGENTS.md` Git rule: stage explicit paths, `<category>: <message>` subject, no branch, push or PR operations.

## Baseline (2026-10-22, commit `5c9d376`)

- Backend gate: ruff, format and mypy clean; `pytest` **911 passed**. Frontend: lint and typecheck clean; `npm test` **38 files, 360 tests passed**.
- `backend/data/processed/` is complete (incl. `stations.parquet`), so the real backend starts: `cd backend && uv run uvicorn greenwave.main:app --port 8000`. Live check: rank + start (STN-A-0007 → 50.0614, 19.9366, 10×) streamed 249 ticks, 3 `ITS_DISPATCH`, 1 `SIMULATION_COMPLETED`.

## Decisions (human, 2026-10-22)

- **D1 Live-run flow.** Once the green corridor is initialized, the dashboard shows only the Live operations view: the Dispatch setup tab disappears (the header mode tabs are removed entirely, so Live operations cannot be opened without a run either). While the run is live, a **Stop** button is shown. Stopping ends the run and shows a stopped summary with a **Back to dispatch setup** action. Finished, failed and superseded runs end the same way: summary plus Back to dispatch setup.
- **D2 Server-side run failure.** If the simulation loop crashes, the backend sends a terminal event telling the client so, and the dashboard says: *"Simulation server error. Retry the green corridor initialization."* Implemented as an additive contract change: a new `CancelReason` value `SERVER_ERROR` on the existing `SIMULATION_CANCELLED` terminal (`schema_version` stays `"1.0"`, as in ADR 0006 and the Green Wave mode addition).
- **D3 Defaults chosen by the plan** (not raised by the human; change here if wrong): simulated vehicle ids are `AMB-KRA-01` / `FIRE-KRA-01` / `POL-KRA-01` in both transports. The backend retains at most 4 sessions (the active one plus the most recent terminal ones). The previous finished run is shown in setup until the next run finishes. The map re-fits after an endpoint change only when an endpoint is outside the current view.

## Findings → milestones

| ID | Sev | Finding | Milestone |
|---|---|---|---|
| B1 | High | Tick `intersections[].name` is always `null` (`simulation/telemetry.py:57`); start response has names; mock sends them. | M1 |
| B2 | Medium | `ambulance.id` is the simulation id (a UUID) (`telemetry.py:27`); mock sends `AMB-KRA-01` for every vehicle type. | M1 |
| F2 | High | No Stop control while running; the Dispatch setup tab silently stops the run (`dashboard.tsx:62`). | M2 |
| F13 | Low | Live operations can be opened with no run. | M2 |
| F1 | High | Run settings reset after every run (`DispatchForm.tsx:47-50` local state, unmounted in live mode). | M3 |
| F3 | High | Previous run result is lost on return to setup (`RESET`), so runs cannot be compared. | M3 |
| B5 | Low→D2 | A loop crash leaves no terminal event; clients see a 15 s timeout (`session.py:176`). | M4 |
| B3 | Medium | `SessionManager._sessions` is never pruned (`session.py:103`). | M5 |
| B4 | Low | Concurrent stop and superseding start can publish two `SIMULATION_CANCELLED` events. | M5 |
| F4 | Medium | Map instance destroyed and recreated on every setup ↔ live switch (tree position changes). | M6 |
| F6 | Medium | Every setup map click re-fits to `maxZoom 13.2` instantly, discarding the user's zoom. | M6 |
| F15 | Low | `fitBounds` unguarded against a zero-size container (`Invalid LngLat (NaN, NaN)`). | M6 |
| F5 | Medium | `crypto.randomUUID()` throws outside secure contexts (LAN HTTP on a phone). | M7 |
| F7 | Medium | ITS log highlights the 3rd row (`ItsConsole.tsx:45`), not the newest. | M8 |
| F8 | Medium | "Time saved" is emerald even when negative. | M8 |
| F9 | Medium | Address search: no feedback on error or zero matches; Enter without a highlighted suggestion does nothing. | M8 |
| F10 | Low | Header status dot always green. | M8 |
| F11 | Low | Ambulance icon / "Priority vehicle" copy for every vehicle type. | M8 |
| F12 | Low | Intersection list keeps passed intersections first; the next one scrolls away. | M8 |
| F14 | Low | Station-list load failure is console-only. | M8 |

Out of scope (known, unchanged): decorative 72 % speed bar; 320 px header truncation; CORS origin pairing (documented in `frontend/.env.example`).

## Ordered work

- [x] **[Completed] M1 — Backend telemetry identity (B1, B2).** [Sub-plan](2026-10-22-m1-telemetry-identity.md). Dependency: none. Suggested commit: `fix: stream intersection names and vehicle ids in ticks`.
- [x] **[Completed] M2 — Live-run flow and Stop (D1; F2, F13).** [Sub-plan](2026-10-22-m2-live-run-flow.md). Dependency: none. Suggested commit: `feat: stop a live run from the live operations view`.
- [x] **[Completed] M3 — Keep settings and previous result (F1, F3).** [Sub-plan](2026-10-22-m3-run-comparison-state.md). Dependency: M2 (back-to-setup path). Suggested commit: `fix: keep run settings and previous result across runs`.
- [x] **[Completed] M4 — Server-error terminal (D2; B5).** [Sub-plan](2026-10-22-m4-server-error-terminal.md). Dependency: M2 (summary card). **Contract change; tell the human before editing `GreenWave_ARCHITECTURE.md`.** Suggested commit: `feat: report simulation server errors to the dashboard`.
- [x] **[Completed] M5 — Session lifecycle hardening (B3, B4).** [Sub-plan](2026-10-22-m5-session-lifecycle.md). Dependency: M4 (same file, terminal semantics). Suggested commit: `fix: bound retained sessions and publish one terminal per run`.
- [x] **[Completed] M6 — Map stability (F4, F6, F15).** [Sub-plan](2026-10-22-m6-map-stability.md). Dependency: M2, M3 (dashboard layout settled). Suggested commit: `fix: keep the map instance and user zoom across interactions`.
- [ ] **[Pending] M7 — Simulation ids outside secure contexts (F5).** [Sub-plan](2026-10-22-m7-simulation-id.md). Dependency: none. Suggested commit: `fix: generate simulation ids outside secure contexts`.
- [ ] **[Pending] M8 — HUD accuracy and feedback (F7–F12, F14).** [Sub-plan](2026-10-22-m8-hud-feedback.md). Dependency: M1 (vehicle ids), M2 (header). Suggested commit: `fix: make live HUD state and search feedback accurate`.

Order rationale: M1–M3 are what a jury sees first in backend mode; M4–M5 close the backend run lifecycle; M6–M7 remove demo-day failure modes; M8 is polish.

## Shared constraints (every sub-plan)

- Simulation only: no controller protocol, no live signal command. Keep simulated values visibly labelled; UI copy stays English.
- Pydantic schemas are canonical. Only M4 changes the contract; after it run `cd backend && uv run python scripts/export_openapi.py && cd ../frontend && npm run generate:types`, and never hand-edit `contracts/openapi.json` or `frontend/src/types/api.generated.ts`.
- No new dependency or lockfile change. HUD stays separate from `src/components/map/`. Light and dark themes and the 320 / 390 px layouts must keep working.
- TDD: write the failing test, observe RED, implement, observe GREEN. Snapshot updates are inspected by word diff, never accepted blind.
- Gates: backend `cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`; frontend (Node 22+) `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`. Then `git diff --check` and a focused diff review.
- Browser checks: `playwright-cli` through bash, output only under `.tmp/playwright/repo-audit/<milestone>/`. Use the real backend (it starts now) plus mock mode; stub with `page.route` only for failure cases that cannot be produced for real.
- Skills: `test-driven-development`, `systematic-debugging` when a test surprises you, `verification-before-completion` before marking complete, `playwright-cli` for browser steps; UI milestones (M2, M3, M8) add an `emil-design-eng` review and `mobile-native` for phone widths.
- Run `graphify update .` after M2 and M6 (structural changes).

## Completion records

(Add one section per milestone: `## M<n> verification — <date>`.)

## M1 verification — 2026-10-22

- Branch `fix/m1-telemetry-identity` (from `main` at `5c9d376`), uncommitted for human review.
- Root cause as planned: `telemetry.py` hard-coded `name=None` and used the simulation id as `ambulance.id`. Fix: `RouteIntersection.name` (filled from `IntersectionInfo` in `build_route_model`) is emitted per tick; `ambulance_telemetry` takes the vehicle type and maps it through `VEHICLE_IDS` (`AMB-KRA-01` / `FIRE-KRA-01` / `POL-KRA-01`). Frontend: `IntersectionCard` falls back to the start-response name; the mock uses `simulatedVehicleId` (`src/lib/vehicle-ids.ts`, new).
- TDD: 6 backend cases (3 vehicle-id params, telemetry names, route-model names, police-run engine ticks) and 3 frontend cases (start-response name fallback, FIRE_TRUCK / POLICE_CAR mock ids) observed failing, then passing. The existing "Unnamed intersection" snapshot case still passes unchanged.
- Golden: `GREENWAVE_REGEN_GOLDEN=1 uv run pytest tests/simulation/test_engine_golden.py`; word diff shows only 1,820 `null` → `INT-*` names and 455 `SIM-*` → `AMB-KRA-01` ambulance ids (5 scenarios × 91 ticks); `simulation_id` fields unchanged. Frontend `mock-stream.json` unchanged (golden scenarios are ambulances).
- Gates: backend `ruff check`, `ruff format --check`, `mypy`, `pytest` — **917 passed**. Frontend `lint`, `typecheck`, `format:check`, `test` (**38 files, 364 tests**), `build` — all exit 0. `git diff --check` clean; no change under `contracts/` or `frontend/src/types/`.
- Real backend (`uvicorn` on :8765): `FIRE_TRUCK` start from STN-A-0007 position to 50.0614, 19.9366 at 10× → 249 ticks, 5 route intersections, all 5 named; 0 tick/start name mismatches; vehicle ids `{FIRE-KRA-01}`. A first attempt from the ranked fire station had a signal-free route (0 intersections), so names were verified on the second route.
- Deviations: none in scope. The plan's optional `test_route_model` `None`-name case is covered at the telemetry level instead (the corridor fixture names every intersection).

## M2 verification — 2026-10-22

- Branch `feat/m2-live-run-flow` (from `main` at `21d02da`), uncommitted for human review.
- Root cause as planned: the header's Dispatch setup tab stopped and reset a live run, `RunSummary` rendered nothing while RUNNING, Live operations could be opened without a run, and the backend adapter closed the stream before `POST /stop`, so the server's STOPPED terminal was never received.
- Fix:
  - **State:** `stopRequested` / `stopError` fields and `STOP_REQUESTED` / `STOP_CONFIRMED` / `STOP_FAILED` actions; the second of `STOP_CONFIRMED` and the server terminal is a no-op.
  - **Controller and hook:** `requestRunStop` and `stopRun` on the hook.
  - **Transport:** the backend adapter's `stop` keeps the stream open.
  - **UI:** `RunSummary` shows a "Simulation running" card with Stop, then "Simulation stopped" plus Back to dispatch setup. The header tabs are replaced by a static view label. Each view change scrolls to the top (`scrollViewToTop`).
- TDD: 6 reducer, 2 controller, 1 adapter (rewritten from "closes the stream"), 7 RunSummary, 2 header, 6 KpiHeader and 1 scroll-helper cases observed failing, then passing. One RunSummary RED failure was a test bug (`disabled:` class matched `disabled`) and was corrected to assert the `disabled=""` attribute.
- Snapshots: `Dashboard.setup.{mock,backend}.html` word diff only replaces the two-button `<nav aria-label="Dashboard mode">` with the static `<p>` label.
- Gates: frontend `lint`, `typecheck`, `format:check`, `test` (**42 files, 388 tests**), `build` — all exit 0; `git diff --check` clean. No backend, schema, contract, dependency or lockfile change; `graphify update .` run.
- Browser (`playwright-cli`, evidence and scripts in `.tmp/playwright/repo-audit/m2/`): real backend (`uvicorn` :8000, backend-transport dev server :3101) and mock production build (:3100), each at 1440 × 1000, 390 × 844 and 360 × 740. In all 6 runs:
  - setup header has no Live operations tab; live header has no Dispatch setup;
  - Stop is visible without scrolling (desktop card at y 310; phone KPI strip at y 258);
  - Stop → "Simulation stopped" with Back to dispatch setup and no Stop button;
  - `main.scrollWidth == innerWidth`;
  - Back returns to setup with the incident kept;
  - console 0 errors.

  Stop stubbed to 503: the "Could not stop the simulation: … (HTTP 503)" alert appears, ticks keep advancing (2 → 5), Stop is re-enabled, and an unstubbed retry stops the run; the single console error is the stubbed 503. SSE check with curl: after `POST /stop` (200) the stream ends with `SIMULATION_CANCELLED` `reason: STOPPED`.
- Deviations:
  1. Planned fallback applied: at 390 px the card's Stop was only at y 787–827 (below the fold at 360 × 740) and the page kept setup's scroll offset (214 px). Below `lg`, Stop therefore sits in the KPI strip (the card keeps status and stop errors), and each view opens at its top.
  2. The first browser run caught a real defect, now fixed with a regression test: the scroll effect's expression body returned a value, which React called as a cleanup ("destroy is not a function").
  3. Click behaviour is verified in the browser rather than in unit tests, because the Vitest environment is `node` with no DOM library, and adding one needs dependency approval.
  4. Found and deferred to M8 Task 4: after a user stop, the header phase label and KPI badge still read "Simulation cancelled" (they key on phase, not reason).

## M3 verification — 2026-10-22

- Branch `fix/m3-run-comparison-state` (from `main` at `bf83a8c`), uncommitted for human review.
- Root cause as planned: `DispatchForm` held the four settings in `useState` and is unmounted in live mode, so each return to setup restored the defaults. Back to dispatch setup dispatched `RESET`, which dropped `routeData` and `completion`, the only record of the result.
- Fix:
  - **Settings:** `DEFAULT_DISPATCH_SETTINGS` (`start-request.ts`); `Dashboard` owns `settings`, and `DispatchForm` is controlled (`settings`, `onSettingsChange`).
  - **Capture:** `src/lib/previous-run.ts` (new). `toPreviousRun` returns a record only for FINISHED with request, route and completion. `nextPreviousRun` keeps the current record otherwise. `Dashboard.backToSetup` calls it before `stopSimulation()` resets the run.
  - **Card:** `PreviousRunCard` (new) sits between Playback speed and the Start button. It is a `section` labelled by the "Previous simulated run" heading and shows, in order: the mode, station → incident and density, total travel time, and saved vs normal-traffic estimate. It uses `formatDuration` / `greenWaveModeLabel`, as the finished summary does.
- TDD:
  - `previous-run.test.ts`: 8 cases failed (module missing), then passed.
  - DispatchForm settings: 4 cases failed against the old form, then passed. These cover controls rendered from the prop, full-settings `onSettingsChange` for mode, density, speed and cascade, the cascade disabled only under DISABLED, and Start sending the given settings. Re-checked by restoring the old `DispatchForm.tsx`: 4 failed.
  - Card placement: 1 case failed (card absent), then passed.
  - `PreviousRunCard.test.tsx`: 4 cases failed (module missing), then passed.
- Snapshots: none changed. `DispatchForm.{mock,backend}.html` and `Dashboard.setup.{mock,backend}.html` are byte-identical (no `git diff`), since setup without a previous run renders the same markup.
- Gates: frontend `lint`, `typecheck`, `format:check`, `test` (**44 files, 405 tests**), `build` — all exit 0 (run twice, the second after the design-review tweak). `git diff --check` clean. No backend, schema, contract, dependency or lockfile change. `graphify update .` run.
- Browser (`playwright-cli`, scripts, JSON and screenshots in `.tmp/playwright/repo-audit/m3/`): real backend (`uvicorn` :8000, backend-transport dev server :3101) and mock production build (:3100), each at 1440 × 1000, 390 × 844 and 360 × 740. Flow: incident → 10× → ENABLED run to completion → back → DISABLED + density 2.0 → run to completion → back → start + Stop → back. In all 6 runs:
  - settings persist at every step (10×, mode, density, cascade);
  - the card appears after the first finished run, shows the enabled result before the disabled run, and is replaced by the disabled result afterwards;
  - a stopped run leaves the card unchanged, and the incident is kept;
  - the card stays inside the aside (no internal overflow) and `main.scrollWidth == innerWidth`;
  - console 0 errors.

  Real backend, ambulance → "Rynek Główny 1" (the plan's baseline route, 5 route intersections): ENABLED 04m 08s with 3 ITS dispatches; DISABLED at 2.0x 09m 46s. Card checked in light and dark mode at 390 px.
- Deviations / rulings:
  1. Task 3's dashboard-level RED test is not possible without a DOM library (Vitest runs in `node`). The capture rule is unit-tested through `nextPreviousRun` (finish replaces, stop keeps), the form slot through markup, and the click path in the browser.
  2. The card does not call `summarizeFinishedRun`, which needs the route and KPI objects that the flat `PreviousRun` record drops. It reuses the same formatters and labels instead.
  3. `emil-design-eng` review: the two values now share a baseline when the "Saved vs normal-traffic estimate" label wraps (`flex-col justify-between`). The DISABLED mode pill is neutral, not amber, because amber means warning/cancelled elsewhere. `mobile-native`: the card has no controls, so no touch fixes apply.
  4. Browser setup: the first backend attempt used a pinned map point and then "Floriańska 1". Both routes had no signals, so ENABLED and DISABLED times were identical. A route probe through `/dispatch/rank` + `/simulation/start` picked "Rynek Główny 1" instead; the probe runs were stopped.

## M4 verification — 2026-10-22

- Branch `feat/m4-server-error-terminal` (from `main` at `fcf563b`), uncommitted for human review.
- Root cause as planned: `SessionManager._run` caught the loop exception and only logged it. No terminal was published, so subscribers waited out their 15 s silence timeout, and the dead run stayed `_active`.
- Fix:
  - **Contract:** `CancelReason.SERVER_ERROR` (additive, `schema_version` `"1.0"`).
  - **Backend:** the `except` branch publishes `SIMULATION_CANCELLED`/`SERVER_ERROR` (last completed tick) through `_publish`. The event is built by `_cancelled_event`, which `_cancel` now shares. The stream closes, a reconnect replays only the terminal, `stop` is a no-op, and `_active` is cleared.
  - **Frontend:** the validator accepts the reason, labelled "Server error". `SERVER_ERROR_COPY` is "Simulation server error. Retry the green corridor initialization.", and `describeSimulationError` returns it for HTTP ≥ 500 without a contract code. `RunSummary` shows an error-tone (`role="alert"`) card with Back to dispatch setup.
  - **Docs:** ADR 0007 (Proposed, per `docs/adr/README.md`), an ADR 0003 additive-change note, and `GreenWave_ARCHITECTURE.md` §4 reasons plus §6 item 13. The architecture wording was approved by the human before the edit.
- TDD:
  - Session: 3 cases (terminal after ticks 1–2 with tick 2; replay plus stop no-op without a second terminal; a new start supersedes nothing) failed by timeout, then passed.
  - SSE route: `test_stream_of_a_crashed_run_ends_with_a_server_error_terminal` passes with the fix. With `session.py` stashed it fails with "the crashed run published no terminal". It waits at most 2 s for the terminal, so a regression fails instead of hanging the suite.
  - Frontend: 6 cases (validator, label, 5xx copy ×3, RunSummary) failed, then passed. The existing 4xx and network copy tests are unchanged and pass.
- Contract regeneration: `export_openapi.py` + `npm run generate:types`. The word diff only adds `"SERVER_ERROR"` to `CancelReason` in `contracts/openapi.json` and `api.generated.ts`. `pytest -k openapi` passed (6). Before Task 3, typecheck failed exactly at `CANCEL_REASONS` and `CANCEL_REASON_LABELS`.
- Snapshots: none changed.
- Gates:
  - Backend: `ruff check`, `ruff format --check`, `mypy`, `pytest` — **921 passed**.
  - Frontend: `lint`, `typecheck`, `format:check`, `test` (**44 files, 410 tests**), `build` — all exit 0.
  - `git diff --check` clean.
- Browser (`playwright-cli`, scripts, JSON and screenshots in `.tmp/playwright/repo-audit/m4/`): real backend (:8000) with a backend-transport dev server (:3101), at 1440 × 1000, 390 × 844 and 360 × 740.
  - The start is real (ambulance → "Rynek Główny 1", DISABLED, 5×). The stream is stubbed with `page.route`: two ticks, then `SIMULATION_CANCELLED`/`SERVER_ERROR`.
  - The error card (`role="alert"`) appeared 470 / 201 / 292 ms after Start, not after 15 s. Stop is gone, and there is no horizontal overflow.
  - Back to dispatch setup keeps the settings (DISABLED, 5×, 1.5x) and the incident, with no previous-run card, because the run did not finish.
  - Start stubbed to HTTP 500 (plain text): the same copy appears as the setup alert.
  - Console errors: only the stubbed 500.
  - Mock production build (:3100) regression at 1440 × 1000 and 390 × 844 (M2 flow): Stop → stopped → back works, with 0 console errors.
- Deviations / rulings:
  1. ADR 0007 is `Proposed`, not `Accepted` as the sub-plan says: `docs/adr/README.md` requires Proposed until maintainer approval. Flip it on approval.
  2. The SSE route test was written after the session fix. Its RED was shown by stashing the fix, and it was hardened to fail fast instead of hanging (no pytest-timeout dependency).
  3. Follow-ups added to M8 Task 4:
     - The header label and KPI badge read "Simulation cancelled" for SERVER_ERROR; they key on phase.
     - At 360 × 740 every terminal summary card starts below the fold (y ≈ 697). This is pre-existing M2 placement, not introduced here.
  4. Follow-up added to M5 Task 2: the `except` branch does not check `session.terminal`, so an exception after a terminal in the same step would publish a second one. This belongs with M5's one-terminal guard.

## M5 verification — 2026-10-22

- Branch `fix/m5-session-lifecycle` (from `main` at `0410f92`), uncommitted for human review.
- Root cause as planned: `start` added every session to `_sessions` and nothing removed them (B3). `stop` and a superseding `start` could both pass `terminal is None`, await the same task, and each publish a `SIMULATION_CANCELLED` (B4). The M4 follow-up was the same defect: a loop failure after the engine's own terminal published a second one.
- Fix:
  - **Retention:** `SimulationSettings.retained_session_limit` (default 4, `ge=1`). After each start, `_evict_retained()` drops the oldest ended sessions beyond the limit; the active run is never evicted. A reused id is re-inserted, so it counts as the newest session.
  - **One terminal:** `_publish` returns once `session.terminal` is set. That single guard covers the stop/supersede race, the `except` branch and an engine that emits after its terminal.
- TDD:
  - **Retention:** the cases (evict beyond the limit, with stream and stop raising `SimulationNotFoundError`; keep the active run at limit 1; re-used id is newest) first failed on the missing setting, then on behaviour (`[True, True, True] == [False, True, True]`), then passed. The "retained finished run replays its terminal" case passed before the fix; it guards against over-eviction.
  - **One terminal:** the race in both `gather` orders, the late-listener count (`2 == 1`) and failure-after-terminal (`[Cancelled]` after `Completed`) failed, then passed. A tick sleep that takes 10 ms to unwind after cancellation makes the race deterministic. "Stop after natural completion publishes nothing" passed before the fix (guard).
  - The session file passed 6 repeated runs: 18 passed each time.
- Gates: backend `ruff check`, `ruff format --check`, `mypy`, `pytest` — **930 passed**. `git diff --check` clean. No contract, frontend, dependency or lockfile change.
- Memory check (throwaway script in the session scratchpad, not committed): 10 real starts in-process against the processed dataset (ambulance → 50.0614, 19.9366, every third stopped).
  - Session count after each start: `[1, 2, 3, 4, 4, 4, 4, 4, 4, 4]`.
  - Retained: `M5-CHECK-6…9`; active: `M5-CHECK-9`.
  - The evicted `M5-CHECK-0` answers 404 for both stream and stop.
- Real backend (:8000):
  - Wire check with `curl`: a stopped run's stream has exactly 1 `SIMULATION_CANCELLED` (`STOPPED`), and the superseded run replays `SUPERSEDED`.
  - `playwright-cli` smoke with the backend-transport dev server (:3101), M2 flow at 1440 × 1000 and 390 × 844: Stop → stopped → back works, there is no horizontal overflow, and console errors are 0. Evidence is in `.tmp/playwright/repo-audit/m5/`.
- Docs: in `GreenWave_ARCHITECTURE.md` §4, "A finished session stays readable until superseded." was replaced with the human-approved retention and one-terminal wording.
- Deviations / rulings:
  1. The one-terminal guard sits in `_publish` rather than only making `_cancel` idempotent, so it covers every producer, including the M4 follow-up. `stop` needs no separate re-check, because a second publish is a no-op.
  2. The plan's "planner that yields" cannot force the race (planning runs in a thread). The test makes A's cancellation slow to unwind instead.

## M6 verification — 2026-10-22

- Branch `fix/m6-map-stability` (from `main` at `03e1a59`), uncommitted for human review.
- Root cause as planned:
  - Setup rendered `<section>…<RoutePreview/></section>` and live rendered a bare `<RoutePreview/>`, so React remounted the map on every mode switch.
  - `EndpointMarkers` re-fitted on every endpoint change (`maxZoom 13.2`, `duration 0`).
  - Nothing guarded `fitBounds` against a zero-size container.
- Fix:
  - **Layout:** `DashboardLayout` (exported, hook-free) always renders one `<section>`: grid classes in setup, `contents` in live (so the preview stays a flex child of `main`). The form is a conditional first child and the preview a keyed `Fragment` second child.
  - **Fit decision:** `src/components/map/endpoint-fit.ts` (new) holds `endpointFitDecision` and `applyEndpointFit`. It fits only on a new "View station and incident" request (tracked in a ref) or when an endpoint is outside `map.getBounds()`, over 600 ms (0 under reduced motion).
  - **Size guard:** `canFit(map)` skips `fitBounds` for a 0-width or 0-height container. `useRouteFit` now calls the extracted `applyRouteFit`, which uses the same guard.
- TDD:
  - **One instance:** `dashboard-map-lifecycle.test.tsx` first failed (export missing). With `DashboardLayout` extracted unchanged, the path check failed on the real bug; with the fix it passed. Setup snapshots passed in both steps.
  - **Fit decision:** `endpoint-fit.test.ts`, 5 cases, failed (module missing), then passed.
  - **Fit helpers:** `map-fit.test.ts` (fake map, 9 cases) failed (functions missing). With the helpers extracted without the guard, the 4 zero-size cases failed on behaviour; with `canFit` they passed.
- Snapshots: none changed. `Dashboard.setup.{mock,backend}.html` are byte-identical: the `Fragment` renders nothing and the setup classes are unchanged.
- Gates: frontend `lint`, `typecheck`, `format:check`, `test` (**47 files, 425 tests**), `build` — all exit 0. `git diff --check` clean. No backend, contract, dependency or lockfile change. `graphify update .` run.
- Browser (`playwright-cli`, scripts, JSON and screenshots in `.tmp/playwright/repo-audit/m6/`): real backend (:8000, dev :3101) and mock production build (:3100), at 1440 × 1000, 390 × 844 and 320 × 720. The script reads and sets the camera through the MapLibre instance found via React's fiber (test-only; no product hook).
  - **Click at zoom 16:** after zooming to 16 on the chosen station, clicking a nearby street keeps the camera (16 → 16, centre unchanged). The incident pin lands on the click within 1 px, and the station stays visible.
  - **Far endpoint:** backend "Kocmyrzowska 1" and mock "pan away + click" fit to include it. The mock samples show the animation (15.34 → 13.2 over about 450 ms). The backend fit settled before sampling; its station was then also in view, so no second fit ran.
  - **Start and back:** start → live → Stop → back keeps the same instance (`===`). There is 1 canvas, no "Loading map tiles…" overlay, and the style JSON was fetched once. In live the route layers exist; back in setup no `greenwave-*` layers and no vehicle marker remain. No horizontal overflow.
  - **Theme:** dark → light keeps the same instance and 1 canvas.
  - Console errors: 0 in all 6 runs.
- Deviations / rulings:
  1. **No DOM test for mounts:** the planned mount-count test needs a DOM (Vitest runs in `node`). It is replaced by a reconciliation-path test, since React keeps the subtree exactly when types, keys and positions match. Instance identity across modes is confirmed in the browser.
  2. **Reduced motion:** the focus-request fit is also instant under reduced motion (the plan said "animated 600 ms" for it), to match the off-screen fit and `useRouteFit`.
  3. **Theme switch:** a theme switch re-requests the style JSON (light → dark → light fetched positron twice). That is the existing `setStyle` swap on the same instance, not a new construction; left unchanged.

## Final closeout

After M8: confirm eight `[Completed]` entries with evidence; run both full gates; run one real-backend browser pass covering rank → start → stop → back → change mode → start → finish → previous-run card at 1440 × 1000 and 390 × 844; check `git status --short`; report remaining limitations. New findings outside this scope go in a separate record.
