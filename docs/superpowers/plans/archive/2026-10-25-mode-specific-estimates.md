# Mode-specific Estimates and Walk Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every pre-run and live time shown on the standard-traffic page is the standard-run time, the green-wave page shows the green-wave time, and off-road incidents show drive and walk separately.

**Architecture:** A pure dry run of DISABLED motion (`standard_run_seconds`) gives an exact standard estimate (≤ 17 ms/route). It is exposed additively on the start response and on each ranked candidate (ranking now takes the traffic density). The frontend picks the time by page mode and splits drive from walk.

**Tech Stack:** Python / FastAPI / Pydantic / pytest; TypeScript / React / Vitest / Next.js.

**Spec:** `docs/superpowers/specs/2026-10-25-post-merge-regressions-design.md` (decisions D4, D5; findings B4, B5, X2).

**Depends on:** `docs/superpowers/plans/2026-10-25-junction-motion-and-hold.md` completed (the estimate must reflect the new standard crossing).

## Global Constraints

- Simulation only; never add real signal actuation.
- Branch `fix/post-merge-regressions`; local commits only; explicit `git add` paths; subjects `<category>: <message>`.
- Pydantic schemas are canonical. After any schema change: `cd backend && uv run python scripts/export_openapi.py && cd ../frontend && npm run generate:types`; never hand-edit `contracts/openapi.json` or `frontend/src/types/api.generated.ts`. Additive only; `schema_version` stays `"1.0"`.
- `T_normal`, `estimated_normal_time_sec` and `kpi_metrics.current_time_saved_sec` keep their meaning (spec D4).
- Times displayed with the existing `formatMinutesSeconds` / `formatDuration`; distances with `formatSignalDistance`.
- Copy (exact): breakdown `"{drive} drive + {walk} on foot · {distance}"`; KPI label in DISABLED mode `"vs normal traffic"`; ETA label with on-foot `"to access point"`.
- Backend and frontend checks as in AGENTS.md; frontend needs Node 22+.

## Review Focus

- Density changes after an incident is picked must re-rank (else the standard time shown is for μ = 1.0) and must not let a stale ranking overwrite a newer one (`useIncidentDispatch` sequence guard) — Task 2 test `re-ranks on density change and ignores the stale response`.
- A route with zero intersections: standard == green-wave motion (no D_min) — Task 1 test `test_standard_estimate_without_junctions_is_open_road_time`.
- Comparison page shows both times and keeps green-wave order (both runs use one station) — Task 3 test.
- Mock transport must provide `estimated_standard_time_sec` and `standard_seconds` or validation rejects the response — Tasks 1 and 2 update mock + validator together.
- Standard page "Fastest" chip follows standard order, not green-wave order — Task 3 test `marks the standard-fastest candidate on the standard page`.

---

### Task 1: Exact standard estimate on the start response

**Files:**
- Create: `backend/src/greenwave/simulation/standard_estimate.py`
- Modify: `backend/src/greenwave/schemas/simulation.py:150-155` (`SimulationStartResponse`), `backend/src/greenwave/simulation/route_model.py:140-150` (`to_start_response`), `backend/src/greenwave/simulation/assembly.py:61-80`
- Modify (generated): `contracts/openapi.json`, `frontend/src/types/api.generated.ts`
- Modify: `frontend/src/lib/transport/validate.ts:205-208`, `frontend/src/lib/mock-session.ts:140-150`, `frontend/src/lib/driver-presentation.ts:57-63` (`etaSeconds`), fixtures in `frontend/src/lib/transport/__fixtures__/architecture-examples.ts`
- Test: `backend/tests/simulation/test_standard_estimate.py` (new), `backend/tests/simulation/test_assembly.py`, `frontend/src/lib/transport/validate.test.ts`, `frontend/src/lib/driver-presentation.test.ts`, `frontend/src/lib/mock-session.test.ts`

**Interfaces:**
- Consumes: `move_one_second(..., route_seconds_until_green=...)`, `ordinary_seconds_until_green`, `route_movement_color_at` (plan 1).
- Produces: `standard_run_seconds(route: PlannedRoute, route_model: RouteModel, density: float, settings: SimulationSettings) -> float`; `SimulationStartResponse.estimated_standard_time_sec: Annotated[int, Field(ge=0)]` (always set by the backend); `to_start_response(..., standard_seconds: float)`.

- [ ] **Step 1: Failing tests** (`test_standard_estimate.py`, reusing `tests/simulation/test_motion_modes.py` helpers by import or a shared fixture move into `tests/support/`):

```python
@pytest.mark.parametrize("phase", [None, GREEN, YELLOW, RED])
def test_standard_estimate_equals_the_disabled_engine_run(phase) -> None:
    engine = _engine(GreenWaveMode.DISABLED, phase=phase)
    states, _ = _run(engine)
    assert standard_run_seconds(engine.route, engine.route_model, _DENSITY, engine.settings) == states[-1].arrived_at_s

def test_standard_estimate_matches_a_two_line_junction_run() -> None: ...   # _two_line_engine(RED)

def test_standard_estimate_without_junctions_is_open_road_time() -> None:
    # route with no intersections: 200 m at 13 m/s
    assert standard_run_seconds(...) == pytest.approx(200 / 13)
```
`test_assembly.py`: `response.estimated_standard_time_sec == round(standard_run_seconds(...))` for an ENABLED and a DISABLED request.
Frontend: validator rejects a start response without a finite `estimated_standard_time_sec`; `etaSeconds` for a DISABLED route returns `estimated_standard_time_sec − elapsed`; mock start response carries `estimated_standard_time_sec === Math.round(disabled timeline tripSeconds)`.

- [ ] **Step 2: Run** `uv run pytest tests/simulation/test_standard_estimate.py tests/simulation/test_assembly.py -q` → FAIL (import error).

- [ ] **Step 3: Implement** `standard_run_seconds`: initial `EngineState` like `SimulationEngine.initial_state`, ordinary (all-`NORMAL`) runtimes, loop `move_one_second(DISABLED, density, color_at, route_seconds_until_green=...)` until `arrived`, return `arrived_at_s`; guard the loop with `max_iterations = ceil(total_distance_m / settings.speed_floor_meters_per_second) + 10_000` and raise `RuntimeError` on overrun (never fabricate a value). Wire it in `assembly.plan_simulation` and `to_start_response`. Export OpenAPI, regenerate types, then frontend validator, mock and `etaSeconds`.

- [ ] **Step 4: Run** focused backend and frontend tests → PASS; full checks; `git diff --stat contracts frontend/src/types` shows only the new field.

- [ ] **Step 5: Commit** — `feat: report an exact standard-run estimate at start`.

---

### Task 2: Ranking returns the standard time for the chosen density

**Files:**
- Modify: `backend/src/greenwave/schemas/dispatch.py:56-68`, `backend/src/greenwave/routing/station_ranking.py:50-147`, `backend/src/greenwave/api/dispatch.py:69-110`
- Modify (generated): contracts + types
- Modify: `frontend/src/lib/transport/validate.ts:510-520`, `frontend/src/lib/mock-dispatch.ts:29-54`, `frontend/src/lib/useIncidentDispatch.ts:60-135`, `frontend/src/components/dashboard.tsx` and `frontend/src/components/comparison/ComparisonWorkspace.tsx` (forward density)
- Test: `backend/tests/routing/test_station_ranking.py`, `backend/tests/api/test_dispatch_api.py`, `frontend/src/lib/useIncidentDispatch.test.ts`, `frontend/src/lib/mock-dispatch.test.ts`, `frontend/src/lib/transport/validate.test.ts`

**Interfaces:**
- Produces: `DispatchRankRequest.traffic_density_multiplier: Annotated[float, Field(ge=1.0, le=3.0)] = 1.0`; `RankedCandidate.standard_seconds: Annotated[float, Field(ge=0.0)]`; `RankedStation.standard_seconds: float` and `RankedStation.total_seconds_for(mode: GreenWaveMode) -> float`; `rank_stations(..., traffic_density_multiplier: float = 1.0)`; frontend `IncidentDispatch.setTrafficDensity(value: number): void` (re-ranks when an incident is set).
- Backend order is unchanged (green-wave total); per-mode order is a frontend concern (Task 3).

- [ ] **Step 1: Failing tests**

```python
def test_displayed_standard_time_matches_the_standard_run() -> None:
    # like test_displayed_time_matches_preflight, density 2.0, green_wave_mode DISABLED
    assert response.estimated_standard_time_sec == round(winner.standard_seconds)

def test_ranking_density_changes_only_the_standard_time() -> None: ...
```
API: rank request without density still works (default 1.0); density 3.5 → 422.
Frontend: `it("re-ranks on density change and ignores the stale response")`; mock candidates carry `standard_seconds`; validator rejects a candidate without finite `standard_seconds`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**: in the ranking loop compute `standard_run_seconds(route, model, density, settings)` beside `estimate_times(..., density, ...)`; pass through the API; regenerate contracts; frontend adapter request carries `traffic_density_multiplier`; mock uses `standard_seconds: 0` like its `greenwave_seconds`; dashboards call `dispatch.setTrafficDensity(settings.trafficDensity)` when it changes.

- [ ] **Step 4: Run** focused + full checks → PASS.

- [ ] **Step 5: Commit** — `feat: rank stations with the standard-run time for the chosen density`.

---

### Task 3: Show the page's own time and split drive from walk

**Files:**
- Modify: `frontend/src/lib/station-choice.ts` (`candidateTotalSeconds`), `frontend/src/components/hud/dispatch/StationRanking.tsx`, `frontend/src/components/hud/dispatch/PreflightEstimate.tsx`, `frontend/src/components/hud/DispatchForm.tsx`, `frontend/src/components/driver/DriverSetupSheet.tsx`, `frontend/src/components/hud/KpiHeader.tsx:145-165`, `frontend/src/components/driver/DriverStatus.tsx:70-110`
- Test: `frontend/src/lib/station-choice.test.ts`, `frontend/src/components/hud/dispatch/StationRanking.test.tsx`, `frontend/src/components/hud/KpiHeader.test.tsx`, `frontend/src/components/driver/driver-status.test.tsx`, snapshot tests (`DispatchForm.snapshot.test.tsx`, `dashboard-parts.snapshot.test.tsx`) updated with review

**Interfaces:**
- Produces: `type TimeMode = "GREENWAVE" | "STANDARD" | "BOTH"`; `candidateDriveSeconds(candidate: RankedCandidate, mode: "GREENWAVE" | "STANDARD"): number`; `candidateTotalSeconds(candidate, mode)` (drive + walk); `orderCandidates(candidates, mode): RankedCandidate[]` (stable; `BOTH` keeps backend order); `StationRanking` prop `timeMode: TimeMode`; `PreflightEstimate` prop `candidate: RankedCandidate | null` (backend branch). Page → mode: `/simulation/standard` → `STANDARD`, comparison → `BOTH`, others → `GREENWAVE` (from `settings.greenWaveMode` / `intent`).

- [ ] **Step 1: Failing tests**

```ts
it("shows the standard time on the standard page", ...)          // 7:02 not the green-wave 5:10
it("marks the standard-fastest candidate on the standard page", ...)
it("shows both times on the comparison page", ...)                // "GW 5:10 · Std 7:02"
it("splits drive and walk for an off-road candidate", () => {
  expect(row).toHaveTextContent("16:12");
  expect(row).toHaveTextContent("7:02 drive + 9:10 on foot · 650 m");
});
it("shows backend standard and green-wave estimates before start", ...) // PreflightEstimate, no "AFTER START"
it('labels the KPI "vs normal traffic" in a disabled run', ...)
it('labels the ETA "to access point" with an on-foot leg', ...)
```

- [ ] **Step 2: Run** `npx vitest run <files>` → FAIL.

- [ ] **Step 3: Implement**: helpers first, then components. `StationRanking` uses `orderCandidates` for display order and `fastest` = first of that order; selection (`selectedStationId` / `selectedCandidate`) is untouched. PreflightEstimate backend branch: Standard = `candidate.standard_seconds`, GreenWave = `candidate.greenwave_seconds` (drive only, labelled), saved = difference; mock branch unchanged.

- [ ] **Step 4: Run** focused tests → PASS; update snapshots (`-u`) only after reading each diff; full frontend checks.

- [ ] **Step 5: Commit** — `fix: show each mode's own time and split drive from walk`.

---

### Task 4: Docs, sampled acceptance and browser check

**Files:**
- Create: `docs/adr/0011-standard-run-estimate.md` (Proposed; amends ADR 0006 rank contract)
- Modify: `GreenWave_ARCHITECTURE.md` §3 model 3 (replace "There is no separate disabled-mode estimate" with D4), dispatch/rank contract section (~lines 220-240), JSON examples gaining `estimated_standard_time_sec` / `standard_seconds`
- Modify: `backend/scripts/sample_runs.py` (add `est_standard` column and summary `max |arrived_at − estimated_standard|` for DISABLED)
- Modify: `docs/engineering/post-merge-regressions-verification.md`

- [ ] **Step 1: Sampled acceptance**: `uv run python scripts/sample_runs.py --routes 40 --seed 11 --density 1.0` and `--density 2.5`. Expected: DISABLED `max |arrived_at − estimated_standard| < 1 s` (exact before rounding), ENABLED unchanged from plan 1.
- [ ] **Step 2: Browser check** (`playwright-cli` skill, `.tmp/playwright/` only): the same address shows different times on `/simulation/green-wave` and `/simulation/standard`; an off-road address (beyond 150 m of any road) shows the breakdown line; standard-run ETA reaches ~0 at arrival.
- [ ] **Step 3: Docs + verification record**; full checks.
- [ ] **Step 4: Commit** — `docs: record the standard-run estimate and its acceptance`.
