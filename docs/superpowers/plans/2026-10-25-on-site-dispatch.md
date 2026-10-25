# On-site Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An incident at or near a station is answered from that station: it is ranked as an on-site candidate (walk only, no drive) instead of being silently skipped in favour of the next station.

**Architecture:** Ranking turns the "same snapped node" station (and, off-road, a station whose own node is an access node and walking beats driving) into a candidate flagged `on_site` with a station→incident walk. The frontend shows it as "On site", and starting it shows an on-site result card without calling the simulation API.

**Tech Stack:** Python / FastAPI / Pydantic / pytest; TypeScript / React / Vitest.

**Spec:** `docs/superpowers/specs/2026-10-25-post-merge-regressions-design.md` (decision D6; finding B2).

**Depends on:** `docs/superpowers/plans/2026-10-25-mode-specific-estimates.md` completed (`standard_seconds`, `TimeMode`, `candidateTotalSeconds(candidate, mode)`).

## Global Constraints

- Simulation only; never add real signal actuation. Never fabricate a route: an on-site candidate has no route and never starts a simulation.
- Branch `fix/post-merge-regressions`; local commits only; explicit `git add` paths; subjects `<category>: <message>`.
- Schema changes additive; regenerate contracts (`export_openapi.py`, `npm run generate:types`); `schema_version` stays `"1.0"`.
- Walk = straight line in EPSG:2178 (`greenwave.etl.geo.project_points`) × `on_foot_detour_factor` / `on_foot_speed_meters_per_second` (ADR 0009 placeholders).
- `station_at_incident` stays in the schema, always `null`, with a `# Deprecated: on-site stations are candidates (ADR 0012).` comment.
- Copy (exact): chip `"On site"`; row sub-line `"on foot · {distance}"`; start button `"Dispatch on foot"`; card title `"Incident at {station name}"`, body `"No drive needed. On foot about {m:ss} ({distance}) · simulated estimate."`, action `"Back to setup"`.

## Review Focus

- Clicking exactly on the station marker (walk 0 m) — candidate time `0:00`, card says `0 m`; no division by zero — backend test `test_incident_on_the_station_point_walks_zero_metres`.
- Off-road incident beside a station whose driven option is faster than walking: the driven candidate wins, no on-site candidate for that station — test `test_off_road_prefers_driving_when_faster`.
- Off-road incident where the station's own node is the only access node (today: `NoRoute`, station dropped) — test `test_off_road_only_access_is_the_station_node`.
- Two stations of the type on the incident node: both on-site, tie broken by `station_id` — test `test_two_on_site_stations_tie_break_by_id`.
- Comparison page with an on-site selection must not start a pair — frontend test `does not start a comparison for an on-site candidate`.

---

### Task 1: Ranking produces on-site candidates

**Files:**
- Modify: `backend/src/greenwave/schemas/dispatch.py:61-76`, `backend/src/greenwave/routing/station_ranking.py`, `backend/src/greenwave/routing/access.py` (walk helper), `backend/src/greenwave/api/dispatch.py:94-110`
- Modify (generated): contracts + types
- Modify: `frontend/src/lib/transport/validate.ts`, `frontend/src/lib/mock-dispatch.ts`
- Test: `backend/tests/routing/test_station_ranking.py` (replace `test_station_at_incident_reported_and_skipped`), `backend/tests/routing/test_access.py`, `backend/tests/api/test_dispatch_api.py`, `frontend/src/lib/mock-dispatch.test.ts`, `frontend/src/lib/transport/validate.test.ts`

**Interfaces:**
- Produces:
  - `walk_between(origin: Position, destination: Position, settings: SimulationSettings) -> tuple[float, float]` in `access.py` returning `(on_foot_m, on_foot_seconds)`.
  - `RankedStation.on_site: bool = False` and `RankedStation.walk_m: float | None`, `walk_seconds: float | None` used only when `on_site` (driven candidates keep `on_foot: AccessNode | None`); `total_seconds` includes `walk_seconds` for on-site.
  - `RankedCandidate.on_site: bool = False`; for on-site the API sets `greenwave_seconds = standard_seconds = distance_m = 0` and `on_foot = OnFootLeg(access_point=station.position, distance_m=walk_m, seconds=walk_seconds)`.
- `StationRanking.station_at_incident` is removed from the dataclass; the API sends `null`.

- [ ] **Step 1: Failing tests** (use the module's `_corridor()` / `position_at` fixtures):

```python
def test_station_on_the_incident_node_is_an_on_site_candidate() -> None:
    ranking = rank_stations(index, nodes, incident_near_station_a, VehicleType.AMBULANCE, SETTINGS)
    first = ranking.candidates[0]
    assert first.on_site and first.station.station_id == station_a_id
    assert first.greenwave_seconds == first.standard_seconds == 0.0
    assert first.total_seconds == pytest.approx(straight_m * 1.3 / 1.4)

def test_incident_on_the_station_point_walks_zero_metres() -> None: ...
def test_two_on_site_stations_tie_break_by_id() -> None: ...
def test_off_road_prefers_driving_when_faster() -> None: ...
def test_off_road_only_access_is_the_station_node() -> None: ...
def test_walk_between_uses_projected_metres_and_detour() -> None: ...   # test_access.py
```
API test: response candidate has `on_site: true`, `on_foot.access_point == station.position`, `station_at_incident is None`.
Frontend: mock rank with incident exactly at a station returns that station first with `on_site: true`, `on_foot.distance_m === 0`; validator accepts `on_site` and defaults a missing one to `false`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** On-network: stations with `node_key == incident_node` become on-site candidates (walk from `station.position` to the incident). Off-road (`incident_snap is None`): for a station whose node is in `seeds`, build the on-site option and compare its walk with the driven option from `plan_route` (if any); keep the faster (driven wins ties). Merge on-site and driven candidates, sort by `(total_seconds, station_id)`, cap at `MAX_CANDIDATES`. When every candidate is on-site, `incident_snap` is the incident node (on-network) or the station node's snap (off-road) — never `ranked[0][1]` of a non-existent route. Regenerate contracts; update validator and mock (`distance === 0` → on-site candidate first, then the nearest other station as today).

- [ ] **Step 4: Run** focused + full checks → PASS.

- [ ] **Step 5: Commit** — `feat: rank a station at the incident as an on-site candidate`.

---

### Task 2: On-site candidate in the UI and the on-site result card

**Files:**
- Create: `frontend/src/components/hud/OnSiteResult.tsx`
- Modify: `frontend/src/components/hud/dispatch/StationRanking.tsx` (remove the `station_at_incident` notice; on-site chip + sub-line), `frontend/src/lib/station-choice.ts`, `frontend/src/components/hud/DispatchForm.tsx` and `frontend/src/components/driver/DriverSetupSheet.tsx` (start label), `frontend/src/components/dashboard.tsx` (`initialize`), `frontend/src/components/comparison/ComparisonWorkspace.tsx` (`start`)
- Test: `frontend/src/components/hud/dispatch/StationRanking.test.tsx`, `frontend/src/components/hud/OnSiteResult.test.tsx` (new), `frontend/src/components/driver/driver-workspace.test.tsx`, `frontend/src/components/comparison/comparison-workspace.test.tsx`, snapshots

**Interfaces:**
- Consumes: `RankedCandidate.on_site`, `candidateTotalSeconds(candidate, mode)` (plan 2).
- Produces: `isOnSite(candidate: RankedCandidate | null): boolean` in `station-choice.ts`; `<OnSiteResult station={Station} walk={OnFootLeg} onBackToSetup={() => void} />`; dashboard/comparison state `onSite: { station: Station; walk: OnFootLeg } | null`, set by start when `isOnSite(selectedCandidate(dispatch))`, cleared by "Back to setup", by changing incident/vehicle, and by starting a non-on-site run.

- [ ] **Step 1: Failing tests**

```ts
it('shows "On site" and the walk for an on-site candidate', ...)   // "on foot · 120 m", time 1:51
it("no longer shows the station-at-incident notice", ...)
it('labels the start "Dispatch on foot" for an on-site selection', ...)
it("shows the on-site result without calling the simulation API", ...)  // adapter.start not called
it("does not start a comparison for an on-site candidate", ...)
it("returns to setup from the on-site result", ...)
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** with the exact copy from Global Constraints; reuse `formatMinutesSeconds` and `formatSignalDistance`; `OnSiteResult` uses the existing summary-card styling (`RunSummary.tsx` `SummaryCard` pattern) and is labelled simulated.

- [ ] **Step 4: Run** focused tests → PASS; review and update snapshots; full frontend checks.

- [ ] **Step 5: Commit** — `feat: dispatch on foot when the incident is at the station`.

---

### Task 3: Docs, acceptance and final review

**Files:**
- Create: `docs/adr/0012-on-site-dispatch.md` (Proposed; amends ADR 0006 ranking step 6 and ADR 0009)
- Modify: `GreenWave_ARCHITECTURE.md` snapping rule (item 10, ~line 703) and the dispatch/ranking section (~lines 220-240); `docs/superpowers/specs/2026-10-19-incident-dispatch-design.md` step 6 gets a one-line "Superseded by ADR 0012" note
- Modify: `docs/engineering/post-merge-regressions-verification.md`

- [ ] **Step 1: Browser check** (`playwright-cli`, `.tmp/playwright/` only): click a station marker and a point ~50 m from it on `/simulation/green-wave`, `/simulation/standard` and `/compare`; the clicked station is first, marked "On site", starting shows the on-site card; a point clearly between two stations still drives.
- [ ] **Step 2: Docs + verification record.**
- [ ] **Step 3: Full backend + frontend checks; contract drift check** (`git diff --exit-code contracts frontend/src/types` after regenerating).
- [ ] **Step 4: Commit** — `docs: record on-site dispatch`.
- [ ] **Step 5: Whole-branch review** with `superpowers:requesting-code-review` across all three plans (base `main`); fix confirmed findings test-first; re-run `scripts/sample_runs.py --routes 40 --seed 11` (with and without `--cascade`) and record the final numbers.
