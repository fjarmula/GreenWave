# Pre-contest Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the audited bugs and logic flaws, remove dead and duplicated code, and synchronise all docs before the contest submission.

**Architecture:** Six milestones, each green on the full checks before the next: backend fixes, contract change, frontend fixes, dead code and duplication, setup-panel merge, docs. Behaviour changes are limited to the approved bugs and L1–L3.

**Tech Stack:** Python 3.12 / FastAPI / Pydantic / polars / networkx (backend, `uv`); Next.js / React / TypeScript / vitest / MapLibre (frontend, Node 22).

**Spec:** `docs/superpowers/specs/2026-10-28-pre-contest-cleanup-design.md`

## Global Constraints

- Branch `feat/optional-team-dispatch` (current). No push, no PR, no branch changes without the human.
- Commit subject `<category>: <message>`; categories `feat fix refactor docs test chore build ci perf style revert`. Stage explicit paths only. End messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Backend check: `cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`.
- Frontend check: `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`.
- After any schema change: `cd backend && uv run python scripts/export_openapi.py && cd ../frontend && npm run generate:types`. Never hand-edit `contracts/openapi.json` or `api.generated.ts`.
- `schema_version` stays `"1.0"`.
- Scenario/backend local zone is `Europe/Warsaw`.
- Snapshot files (`__snapshots__/*.html`) change only in a commit that says why.
- Browser checks with `@playwright/cli` via the `playwright-cli` skill; output only under `.tmp/playwright/`.
- Tell the human before editing `AGENTS.md` or `GreenWave_ARCHITECTURE.md` (done: approved in D5).

## Review Focus

1. DST: a scenario time formatted on 2026-10-25 between 02:00 and 03:00 Warsaw (the repeated hour) and on 2026-03-29 (missing hour) — formatting must not throw or shift by a day. Test in Task 9.
2. Backend starting after the page: stations retry must stop on success and on unmount, never loop forever. Test in Task 11.
3. Playback 1x: ITS ETA unchanged from today. Test in Task 1.
4. Standard mode with an on-site station: on-site vs drive decided on standard totals. Test in Task 4.
5. Map construction failure: the dispatch panel stays usable, only the map shows a fallback. Test in Task 13.

---

## Milestone 1: Backend fixes

### Task 1: ITS ETA in wall-clock seconds

**Files:**
- Modify: `backend/src/greenwave/simulation/dispatch.py` (`build_dispatch_payload`), `simulation/engine.py` (`SimulationEngine.__init__`, `_dispatch`), `simulation/assembly.py` (engine construction), `simulation/session.py` (pass `playback_speed`)
- Modify: `frontend/src/lib/mock-session.ts:447`
- Test: `backend/tests/simulation/test_dispatch_payload.py` (create if absent), `frontend/src/lib/mock-session.test.ts`

**Interfaces:**
- Produces: `build_dispatch_payload(..., vehicle_type: VehicleType, playback_speed: int = 1)`; `SimulationEngine(..., playback_speed: int = 1)`.

- [ ] **Step 1: Failing tests** — `test_expected_arrival_scales_with_playback_speed`: same state, `playback_speed=1` gives `now + min_tti`, `playback_speed=10` gives `now + min_tti / 10`. Frontend: mock ITS dispatch at speed 10 has `expected_arrival_utc` = now + min TTI × 100 ms.
- [ ] **Step 2: Run, expect FAIL** (`uv run pytest tests/simulation/test_dispatch_payload.py -q`; `npx vitest run src/lib/mock-session.test.ts`).
- [ ] **Step 3: Implement** `timedelta(seconds=min(ttis) / playback_speed)`; thread `playback_speed` from the start request through `plan_simulation` to the engine; mock divides by its playback speed.
- [ ] **Step 4: Run backend + frontend checks, expect PASS.**
- [ ] **Step 5: Commit** `fix: express the ITS arrival estimate in wall-clock time`.

### Task 2: RECOVERY only after priority

**Files:**
- Modify: `backend/src/greenwave/its/controller.py:171-177`
- Test: `backend/tests/its/test_controller.py`

- [ ] **Step 1: Failing test** `test_passed_requested_target_without_priority_goes_normal`: a target still `REQUESTED` (runtime state `NORMAL`) is passed → runtime `IntersectionRuntime(passed=True)` with state `NORMAL`, `recovery_started_at_s is None`. Keep the existing test that a `PRIORITY_GREEN` or `CLEARING` target enters `RECOVERY`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**: on first passage enter `RECOVERY` only when `runtime.state in {CLEARING, PRIORITY_GREEN}`; otherwise `IntersectionRuntime(passed=True)`.
- [ ] **Step 4: Backend check PASS** (golden/sample-run tests may change only if a passed target was never granted; inspect any diff).
- [ ] **Step 5: Commit** `fix: enter recovery only at intersections that held priority`.

### Task 3: Roster and base integrity at load

**Files:**
- Modify: `backend/src/greenwave/dataset/integrity.py` (`check_resources`, `check_places`), `dataset/models.py` (`RosterSummary.effective_from: date`), `api/dispatch.py` (`_roster`, the `NoStationReachable` handler)
- Modify: `backend/src/greenwave/routing/station_ranking.py:build_station_nodes` (or the loader) so a `prm_base` that does not snap raises `DatasetError`
- Test: `backend/tests/dataset/test_loader.py`, `tests/api/test_dispatch_api.py`

- [ ] **Step 1: Failing tests**:
  - `test_resources_reject_bad_formats` (parametrised): `team_code` not `K\d\d \d{3}`, `weekdays` not a subset of `1234567`, `season_from` not `MM-DD`, empty `area_teryt`, `team_type` outside `P1 P2 P3 S` → `DatasetError` naming the column.
  - `test_addresses_reject_district_out_of_range`: `district_number = 19` → `DatasetError`.
  - `test_prm_base_off_network_fails_startup`: a `prm_base` station that does not snap → `DatasetError`.
  - `test_unreachable_team_message_kept`: the 422 body for an ambulance with no reachable base carries the team-ranking message.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**: reuse the patterns in `schemas/dispatch.py` (import, don't copy); `effective_from` typed `date`; NoStationReachable handler returns `str(error)`.
- [ ] **Step 4: Backend check PASS.**
- [ ] **Step 5: Commit** `fix: fail startup on malformed roster data or off-network bases`.

### Task 4: Ranking follows the request's time mode (L1)

**Files:**
- Modify: `backend/src/greenwave/routing/station_ranking.py` (`rank_stations`, `RankedStation`), `routing/team_ranking.py` (`rank_teams`), `api/dispatch.py` (`rank`)
- Test: `backend/tests/routing/test_station_ranking.py`, `tests/routing/test_team_ranking.py`

**Interfaces:**
- Produces: `rank_stations(..., *, time_mode: GreenWaveMode = GreenWaveMode.ENABLED, include_fastest_of=..., max_candidates=..., shortlist_size: int | None = None)`; `RankedStation.total_seconds` removed (callers use `total_seconds_for(mode)`).

- [ ] **Step 1: Failing tests**:
  - `test_standard_mode_orders_by_standard_total`: two stations where green-wave order ≠ standard order (stub `estimate_times` / `standard_run_seconds` as the existing tests do) → `time_mode=DISABLED` returns the standard-fastest first.
  - `test_standard_mode_on_site_vs_drive_uses_standard_total` (Review Focus 4).
  - `test_team_ranking_estimates_every_eligible_base`: with `dispatch_shortlist_size=1` and 3 eligible bases, all 3 are estimated (none cut by motion time).
  - API: `test_fire_rank_honours_time_mode`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**: sort and on-site comparison use `total_seconds_for(time_mode)`; `shortlist_size` overrides `settings.dispatch_shortlist_size`; `rank_teams` passes `shortlist_size=len(eligible_nodes)` and its `time_mode`; the API passes `body.time_mode` on every path. Update the module docstring ("speed cut" caveat now applies to fire and police only).
- [ ] **Step 4: Backend check PASS.**
- [ ] **Step 5: Commit** `fix: rank dispatch candidates by the run's time mode`.

### Task 5: Deterministic ETL tie and curated-input hashes (L3)

**Files:**
- Modify: `backend/src/greenwave/etl/intersections/node_queries.py:18`, `etl/places_pipeline.py` (`PlacesSection.curated_sha256: dict[str, str]`), `etl/intersections_pipeline.py` (`override_sha256: str`, `override_file` relative to `backend/`), `etl/quality.py` (check both), `etl/neighbours_pipeline.py:89`, `etl/places_pipeline.py:197` (missing `valid_for` → `StaleArtifactError`), `dataset/models.py` (section models gain the fields)
- Test: `backend/tests/etl/test_intersections_*`, `tests/etl/test_places_pipeline.py`, `tests/etl/test_quality.py`, `tests/dataset/test_real_data_smoke.py`

- [ ] **Step 1: Failing tests**:
  - `test_best_incident_class_tie_is_alphabetical`: classes `{"track", "pedestrian"}` → `"pedestrian"` regardless of set order.
  - `test_places_records_curated_hash`, `test_intersections_records_override_hash`.
  - `test_quality_rejects_edited_curated_file`: edit `prm_bases.json` after `places` → `StaleArtifactError` naming the file and `run_etl.py places`.
  - `test_missing_valid_for_is_stale_artifact`.
  - Real-data smoke (skips without processed data): committed curated/override hashes equal the report's.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**: tie key `(rank, class)`; hash with `etl.manifest.sha256_of_file`; quality compares current files to recorded hashes. The loader does not read curated files (they are not in the production image).
- [ ] **Step 4: Backend check PASS.** Re-run the real ETL chain locally (`run_etl.py` steps through `quality`) so `data/processed` carries the new fields; confirm the backend starts.
- [ ] **Step 5: Commit** `fix: make road-class ties deterministic and hash curated ETL inputs`.

## Milestone 2: Contract change (D2)

### Task 6: Contract cleanup and backend-provided limits

**Files:**
- Modify: `backend/src/greenwave/schemas/dispatch.py` (`StationSourceKind`, `DispatchRankResponse`, `AreaRuleOutcome`), `dataset/constants.py` (`SOURCE_KINDS`), `api/dispatch.py`, `routing/team_ranking.py` (`AreaRule.margin_seconds`)
- Modify: `frontend/src/lib/team-dispatch-copy.ts` (drop `AREA_PREFERENCE_MARGIN_S`, read `area_rule.margin_seconds`), `src/lib/useIncidentDispatch.ts` (`RANK_ERROR_COPY` drops `DESTINATION_OFF_NETWORK`; the backend message is shown), `src/lib/transport/validate.ts`, fixtures under `src/lib/transport/__fixtures__/`, `src/lib/mock-dispatch.ts`
- Regenerate: `contracts/openapi.json`, `frontend/src/types/api.generated.ts`
- Test: `backend/tests/schemas/test_dispatch_schemas.py`, `tests/api/test_dispatch_api.py`, `frontend/src/lib/team-dispatch-copy.test.ts`, `src/lib/useIncidentDispatch.test.ts`, `src/lib/transport/validate.test.ts`

**Interfaces:**
- Produces: `AreaRuleOutcome.margin_seconds: float` (≥ 0); `StationSourceKind` = `prm_base` + the fire kinds + `police`; no `station_at_incident`.

- [ ] **Step 1: Failing tests**: backend `area_rule["margin_seconds"] == 60`; response has no `station_at_incident`; `StationSourceKind("hospital_ed")` raises. Frontend: area copy uses the response margin (fixture with `margin_seconds: 45` renders "45 s"); off-network error shows the backend message; validate rejects a response missing `margin_seconds`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**, export OpenAPI, regenerate types.
- [ ] **Step 4: Backend + frontend checks PASS.**
- [ ] **Step 5: Commit** `feat: send dispatch limits from the backend and drop retired contract fields`.

## Milestone 3: Frontend fixes

### Task 7: ITS request state is immutable

**Files:** Modify `frontend/src/lib/transport/backend-simulation-adapter.ts:331-360`, `src/lib/simulation-controller.ts:171`; Test `src/lib/transport/backend-simulation-adapter.test.ts`, `src/lib/simulation-controller.test.ts`

- [ ] **Step 1: Failing tests**: `does not mutate the tick's its_requests on ITS_DISPATCH` (freeze the tick array; dispatch must not throw and the tick array keeps its length); `ignores ITS feedback after cleanup` in the controller.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**: `feedbackRequests = [...feedbackRequests, entry]`; `if (!active) return` in `onItsFeedback`.
- [ ] **Step 4: Frontend check PASS.**
- [ ] **Step 5: Commit** `fix: keep ITS request state immutable in the stream adapter`.

### Task 8: Transport robustness fixes

**Files:** Modify `frontend/src/lib/transport/backend-dispatch-adapter.ts` (timeout after body read; aborted requests recorded as cancelled, not failed), `src/lib/diagnostics/wire-capture.ts` (add `cancelled()` if absent), `src/lib/transport/validate.ts` (`parseComparisonStartResponse` returns the parsed members; `its_scenario` and ITS status tables typed `Record<ItsScenario, true>` / `Record<ItsRequestStatus, true>`; `last_feedback_sequence` optional, default 0; `validateRank` normalises into a copy)
Test: the matching `*.test.ts` files

- [ ] **Step 1: Failing tests**: `reports a timeout during the body read as a timeout`; `records a superseded rank as cancelled`; `defaults its_scenario for both comparison members`; `accepts an ITS snapshot without last_feedback_sequence`; `does not mutate the rank body`.
- [ ] **Step 2–4: Run FAIL, implement, frontend check PASS.**
- [ ] **Step 5: Commit** `fix: report dispatch timeouts and cancellations accurately`.

### Task 9: Scenario time in Kraków time

**Files:** Create `frontend/src/lib/local-time.ts`; Modify `src/lib/useIncidentDispatch.ts` (`scenarioTimeAt`), `src/lib/mock-dispatch.ts` (`localMinute`, and echo the request's `scenario_time`); Test `src/lib/local-time.test.ts`

**Interfaces:**
- Produces: `warsawMinute(date: Date, roundToMinutes = 1): string` → `"YYYY-MM-DDTHH:MM"` in `Europe/Warsaw` via `Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw", ... })`.

- [ ] **Step 1: Failing tests**: `2026-10-27T20:03:30Z` → `"2026-10-27T21:00"` with rounding 5 regardless of `process.env.TZ`; DST cases from Review Focus 1 (`2026-10-25T00:30Z` → `"2026-10-25T02:30"`, `2026-10-25T01:30Z` → `"2026-10-25T02:30"`, `2026-03-29T01:30Z` → `"2026-03-29T03:30"`); mock rank echoes the request's scenario time.
- [ ] **Step 2–4: Run FAIL, implement (`scenarioTimeAt` and `localMinute` both call `warsawMinute`), frontend check PASS.**
- [ ] **Step 5: Commit** `fix: format the scenario time in Kraków time`.

### Task 10: Ranking never stale for the density (L2)

**Files:** Modify `frontend/src/lib/useIncidentDispatch.ts` (`createIncidentDispatch(adapter, now, initial?: { trafficDensity: number })`, `useIncidentDispatch(adapter, initial?)`, `setTrafficDensity`), `src/components/scenario-provider.tsx`; Test `src/lib/useIncidentDispatch.test.ts`

- [ ] **Step 1: Failing tests**: `starts at the given density` (`initial.trafficDensity = 1.5` → first rank request carries 1.5); `marks the ranking loading as soon as the density changes` (`rankStatus === "loading"` immediately after `setTrafficDensity(2)` with an incident, before the debounce fires; the pick is still kept).
- [ ] **Step 2–4: Run FAIL, implement (provider passes `DEFAULT_DISPATCH_SETTINGS.trafficDensity`), frontend check PASS.**
- [ ] **Step 5: Commit** `fix: never offer a ranking computed for an older traffic density`.

### Task 11: Station list retries

**Files:** Modify `frontend/src/lib/useStations.ts`; Test `src/lib/useStations.test.ts`

**Interfaces:** `STATIONS_RETRY_DELAYS_MS = [2000, 5000, 10000, 20000]` then every 30000 ms until success or unmount.

- [ ] **Step 1: Failing tests** (fake timers): fails twice then succeeds → stations set, error cleared, no further calls; unmount during a wait → no further calls (Review Focus 2).
- [ ] **Step 2–4: Run FAIL, implement, frontend check PASS.**
- [ ] **Step 5: Commit** `fix: retry the station list until the backend answers`.

### Task 12: Start button while a comparison runs

**Files:** Modify `frontend/src/components/dashboard.tsx:211`, `src/components/hud/dispatch/DispatchStartButton.tsx`; Test `src/components/hud/dispatch/DispatchStartButton.test.tsx` (create if absent)

**Interfaces:** `DispatchStartButton` gains `blockedReason?: string`; when set the button is disabled, not `aria-busy`, and its label is the reason. Dashboard passes `"Comparison running"` when `operationOwner === "comparison"` and no longer folds that into `pending`.

- [ ] **Step 1–4: Failing test (label "Comparison running", no `aria-busy`), FAIL, implement, frontend check PASS.**
- [ ] **Step 5: Commit** `fix: label the start button as blocked while a comparison runs`.

### Task 13: Error boundaries

**Files:** Create `frontend/src/app/error.tsx`, `src/components/map/MapBoundary.tsx`; Modify `src/components/workspace/HomeBackdrop.tsx` (move `BackdropBoundary` into a shared `src/components/ErrorBoundary.tsx`, used by both), the map host(s) wrapping `MapContainer`; Test `src/components/map/MapBoundary.test.tsx`

- [ ] **Step 1: Failing test**: a child that throws on render inside `MapBoundary` renders the fallback text "Map unavailable — WebGL may be disabled" and the sibling dispatch panel still renders (Review Focus 5).
- [ ] **Step 2–4: FAIL, implement (`app/error.tsx` shows a reset button calling `reset()`), frontend check PASS.**
- [ ] **Step 5: Commit** `fix: show a fallback instead of a blank page when the map fails`.

### Task 14: Small UI correctness fixes

**Files:** `src/components/workspace/WorkspaceShell.tsx:111` (drop `aria-expanded`), `src/components/hud/dispatch/IncidentInput.tsx:117` (key `${label}@${lat},${lng}`), `src/components/map/MapContainer.tsx:271`, `IncidentMarker.tsx:270`, `OsmGhostMarker.tsx:63` (`role="img"` / `role="region"`), `src/components/comparison/ComparisonWorkspace.tsx:136,160` (pass `osmPosition`; pass the replacement notice to the phone card), `src/components/map/useMapCamera.ts:18`, `src/lib/useVehicleWake.ts:21` (reset refs on route change), `src/components/dashboard.tsx:174-182` (stable map callbacks), layer effects in `RouteLayer.tsx`, `CascadeLinksLayer.tsx`, `EndpointMarkers.tsx`, `OsmGhostMarker.tsx` (skip `addSource`/`addLayer` while `!map.isStyleLoaded()`; the `styleRevision` effect re-adds)

- [ ] **Step 1: Failing tests** where testable: focus button has `aria-pressed` and no `aria-expanded`; two suggestions with the same label render without a key warning; comparison phone card shows the notice; a layer effect on a map whose `isStyleLoaded()` is false does not call `addSource`.
- [ ] **Step 2–4: FAIL, implement, frontend check PASS.** Update snapshots only for the `aria-expanded` removal and say so in the commit.
- [ ] **Step 5: Commit** `fix: tidy map layer guards, accessibility attributes and comparison setup`.
- [ ] **Step 6: Browser check** (playwright-cli, backend + frontend running): ambulance dispatch with team-aware on/off, a green-wave run at 10x (ITS log ETA plausible), a comparison, a theme switch mid-run. Screenshots in `.tmp/playwright/cleanup/`.

## Milestone 4: Dead code and duplication (builder's call, behaviour-preserving)

### Task 15: Backend dead code

**Files:** `simulation/state_machine.py` (remove `advance_intersection`, `Transition`; keep `IntersectionRuntime`), `simulation/corridor.py` (remove `advance_corridor`, `CorridorAdvance`, dead `holding_priority` branch), `simulation/__init__.py`, `simulation/phases.py` (`route_lights_shown_green`; `phase_decisions`, `project_signal_phases` if test-only), `simulation_settings.py` (`max_playback_speed`), `simulation/engine.py` (`estimates`, unused `its_scenario` when a controller is passed, `_confirmed_green` unused param), `simulation/route_model.py` (`approach_edge_ids`, `del settings`), `api/sse.py:14-16`, `dataset/models.py` (`provenance`, `allow_u_turns` if unread), `routing/network_index.py` (`EdgeView.source_node/target_node` if test-only), ETL re-export shims (point tests and `scripts/bench/workers.py` at `greenwave.artifacts`), `scripts/bench/constants.py` (`ETL_REPS` gains `places`, `quality`), stale docstrings in `scripts/run_etl.py:5`, `scripts/build_manifest.py:6`; delete the matching tests.

- [ ] **Step 1: Remove, grep each symbol across `backend/` to zero hits.** Keep the ITS gateway plumbing (tests assert on it).
- [ ] **Step 2: Backend check PASS** (sample-run goldens unchanged).
- [ ] **Step 3: Commit** `refactor: remove superseded state-machine and unused backend code`.

### Task 16: Backend duplication

**Files:** `routing/team_eligibility.py`, `routing/team_ranking.py` (import `ExclusionReason`, `SelectionReason`, `AvailabilityOverride` from `schemas/dispatch.py`), `api/dispatch.py` (`model_validate(obj, from_attributes=True)` for Team, IncidentArea, AreaRule; share `MAX_CANDIDATES` with the schema `max_length`), `artifacts.py` (new `verify_t4_inputs(raw_dir, processed_dir, step)` used by neighbours, places, quality), every `hashlib.sha256(read_bytes())` → `sha256_of_file`, MSIP timestamp parse shared between `etl/quality.py` and `etl/municipal_addresses.py`, `scripts/run_etl.py` + `scripts/etl_equivalence.py` share one `STEPS: dict[str, Callable]`, `simulation/` `initial_engine_state(track, route_model, settings)` used by engine, standard estimate and controller (replaces the magic `5`), one `route_vehicle_phases(...)` filter, ITS ACCEPTED→EXPIRED check merged, `schemas/its.py`/`simulation.py` share `MessageId` and `SimulationId`.

- [ ] **Step 1: Refactor in small commits per area (routing/api, etl, simulation).**
- [ ] **Step 2: Backend check PASS after each**, goldens unchanged, `scripts/etl_equivalence.py` on real data unchanged.
- [ ] **Step 3: Commits** `refactor: share dispatch literals and schema conversion`, `refactor: share ETL input verification and hashing`, `refactor: share initial engine state and route phase filter`.

### Task 17: Frontend dead code and dependencies (D4)

**Files:** `src/components/driver/DriverSetupSheet.tsx` and `src/components/hud/DispatchForm.tsx` (remove the start-button path and its props `showStartAction pending replacement errorMessage onInitialize startLabel`), `src/components/dashboard.tsx` (`setupLabel`, `startLabel`, `DashboardLayout`), `src/components/hud/KpiHeader.tsx` (outcome chip, `PHONE_RUN_SUMMARY_ID`), `src/components/hud/run-status-tone.ts` (`RUN_STATUS_DOTS`), `src/lib/useSimulationStream.ts` (delete; import `useSimulationActions`), `src/lib/utils.ts` + test (delete `cn`), `src/lib/workspace-routes.ts` (`modeForDestination` if test-only), `src/lib/mock-dispatch.ts` (`haversineMeters` re-export), `src/lib/diagnostics/observe-adapters.ts` (unreachable branch), un-export the ~20 file-local symbols knip lists, `src/app/globals.css` (dead rules: `.sheet-pill .sheet-minimize .sheet-disclosure .workspace-button--primary --quiet .workspace-exit .workspace-focus-brand .dashboard-signal-pulse`, every `[data-focus…]` rule and qualifier, unused `--sidebar-*`/`--chart-*` tokens), `src/components/map/occluders.ts` (`data-focus`), `scripts/smoke/home-return.js` (add to `run-mock-smoke.sh`), `package.json` (remove deps; add `smoke:mock` script), `knip.json` (entry `scripts/**`)

- [ ] **Step 1: Remove; `npx knip` reports no unused files, deps or exports except generated types.**
- [ ] **Step 2: Frontend check PASS**; snapshot diffs only from removed dead markup.
- [ ] **Step 3: Commits** `refactor: remove the dead setup start path and unused frontend code`, `build: drop unused frontend dependencies`.

## Milestone 5: Shared setup fields (D1)

### Task 18: One dispatch settings component

**Files:** Create `frontend/src/components/hud/dispatch/DispatchSettingsFields.tsx`; Modify `src/components/hud/DispatchForm.tsx`, `src/components/driver/DriverSetupSheet.tsx`, `src/components/dashboard.tsx` (one `setupSheet` object; one `OnSiteResult` block), comparison candidate selection on `pageCandidate`; Test `src/components/hud/dispatch/DispatchSettingsFields.test.tsx`

**Interfaces:**
- Produces: `DispatchSettingsFields({ dispatch, settings, onSettingsChange, intent, modeLocked, capabilities, stationsError, onFocusMap, previousRun, layout: "panel" | "sheet" })` rendering: team-aware switch, scenario time, ranking, team panel, stations error, focus-map button, traffic, Green Wave toggle, ITS, cascade, playback, preflight, disclaimer — one order for both layouts (ITS before cascade).
- One `canStart(dispatch)` in `src/lib/station-choice.ts`, used by the start button and the fields.

- [ ] **Step 1: Failing test**: both layouts render the same control order and labels for an ambulance with resources.
- [ ] **Step 2–4: FAIL, implement, frontend check PASS.** Snapshots change; commit says "order unified, ITS before cascade on the phone sheet".
- [ ] **Step 5: Commit** `refactor: share one dispatch settings component across desktop and phone`.
- [ ] **Step 6: Browser check** at desktop and 390 px width: dispatch, team switch, start, comparison.

## Milestone 6: Docs (D5)

### Task 19: README front door and setup fixes

**Files:** `README.md`, `backend/README.md`, `frontend/README.md`, `CONTRIBUTING.md`, `SECURITY.md`

- [ ] **Step 1:** README: pitch, feature list (Green Wave vs standard, live comparison, simulated ITS scenarios, on-foot/on-site dispatch, EMUiA geocoding, PRM team-aware dispatch with its switch, data quality, driver view), quick start, full ETL order `prepare → graph → override-map → intersections → neighbours → places → quality`, simulation-only disclaimer, data sources and attribution (OSM ODbL, Ulice.geojson, EMUiA, Małopolska PRM plan, ZDMK bus lanes — wording from `MANIFEST.json`), licence. One canonical home each for check commands (CONTRIBUTING), ITS description (backend README), workspace controls (`docs/engineering/frontend-dashboard.md`); others link.
- [ ] **Step 2:** Fix frontend README labels ("Focus Mode", "Follow vehicle"/"Show route"), CONTRIBUTING branch naming (`<category>/<topic>`), deploy README known limitation (rollback shares processed data). SECURITY.md: ask the human for a contact before writing one.
- [ ] **Step 3: Verify** every command in README runs as written on a clean checkout (`run_etl.py` steps, `docker compose up --build`).
- [ ] **Step 4: Commit** `docs: make the README the front door and fix the setup steps`.

### Task 20: Architecture, engineering docs and ADRs

**Files:** `GreenWave_ARCHITECTURE.md` (dispatch section: PRM bases, team ranking, `resource_aware`, 0–3 candidates, `outcome`; endpoints `/resources`, `/health`; EMUiA geocoding; SSE only; data sources §5; calibration note; contest name), `docs/engineering/domain-invariants.md` (SSE only), `docs/engineering/frontend-dashboard.md:439` (missing design dir), `docs/adr/README.md` (index table: number, title, status, implemented in; note on the two 0008s), ADR 0003 "superseded in part" note, `docs/adr/0014-…` (time-mode ranking and contract changes from Tasks 4 and 6)

- [ ] **Step 1: Edit; grep each changed claim against the code.**
- [ ] **Step 2:** Produce the list of ADRs ready to accept for the human; do not change their status.
- [ ] **Step 3: Commit** `docs: synchronise architecture, engineering docs and ADR index with the code`.

### Task 21: Superpowers archive and history

**Files:** `git mv` completed `docs/superpowers/plans/*.md` → `plans/archive/`, completed `specs/*.md` → `specs/archive/` (keep this plan and its spec live until done); create `docs/superpowers/HISTORY.md` (date, feature, spec → plan → ADR → PR); update `docs/superpowers/README.md` (mention `specs/`, archive rule); `git mv` `docs/engineering/{post-merge-compatibility-verification,post-merge-regressions-verification,simulated-its-feedback-validation,night-corridor-integration}.md` → `docs/engineering/history/`; fix links in ADRs and docs that point at moved files.

- [ ] **Step 1: Move; run a link check** (every relative markdown link resolves) — zero broken links outside archived files.
- [ ] **Step 2: Commit** `docs: archive completed plans and add a feature history`.
- [ ] **Step 3:** `graphify update .` and confirm the graph rebuilds.

## Done

- All checks green; browser checks recorded; the human has the ADR acceptance list and the SECURITY.md contact question; summary of commits and any deviations reported.
