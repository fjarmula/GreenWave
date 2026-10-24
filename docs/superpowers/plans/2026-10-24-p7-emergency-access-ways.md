# P7 Emergency Access Ways Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Also: test-driven-development, systematic-debugging (for ETL diffs), verification-before-completion. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Usable tracks and emergency-tagged ways join the routable road network, so incidents on forest roads, outskirts tracks and emergency-only lanes get a corridor.

**Architecture:**
- `scan_osm` collects the extra ways in a new `OsmScan.access_ways` list, so the T1 profile and its 50,107 drivable-way baseline stay untouched.
- `prepare_scan`, the single entry point of every graph-building step, merges them before welding. Downstream steps see them as ordinary routable ways with class-default speeds.
- The processed data is rebuilt and the change is reviewed with the ETL equivalence harness.

**Tech Stack:** Python 3.12+, uv, polars, networkx, shapely, pytest.

**Spec:** `docs/superpowers/specs/2026-10-24-dispatch-access-and-map-framing-design.md` (section C). Read `docs/engineering/data-pipeline.md` (provenance labels) first.

## Global Constraints

- An access way is either:
  - `highway=track`, `access` ∉ {`private`, `no`}, and `tracktype` absent or ∈ {`grade1`, `grade2`, `grade3`}; or
  - `emergency` ∈ {`yes`, `designated`, `official`} and `highway` ∈ drivable classes ∪ {`track`, `pedestrian`}, whatever `access` is.
- Ways that are already drivable and not access-excluded stay in `drivable_ways`, never duplicated into `access_ways`.
- `drivable_ways`, `drivable_excluded_by_access` and the T1 profile report are unchanged by this plan.
- New `config.py` values are labelled `PLACEHOLDER 2026-10-24 (human requested tracks and emergency ways; uncalibrated)`: track 15 km/h, pedestrian 10 km/h, the tracktype set, and the emergency value set.
- Simulation only; no new dependencies.
- Checks: `cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`.

## Review Focus

1. An `access=no` service way tagged `emergency=yes`: today it is counted in `drivable_excluded_by_access`, and it must still be counted there and also land in `access_ways`. Task 1 test `emergency override keeps the profile count`.
2. A track tagged `motor_vehicle=no` (9 in the snapshot): the spec only filters on `access`. Pin the current behaviour with a test so any later change is deliberate. Task 1 test `motor_vehicle is not consulted`.
3. A `service=driveway` way with `emergency=yes`: `is_routable_way` still drops it after the merge. Task 2 test `driveway stays excluded after merge`.
4. A track that only touches the network through a near-miss gap: it is welded like any other way, because welding runs after the merge. Task 2 test `access ways are welded`.
5. Rebuilt data changes every route ID-adjacent artefact. The equivalence diff must be read, not just allowed. Task 3 records the allowed files and the reason for each.

---

### Task 1: Collect access ways in the scan

**Files:**
- Modify: `backend/src/greenwave/etl/config.py` (new constants after `EXCLUDED_ACCESS_VALUES`; speeds in `CLASS_DEFAULT_SPEED_KMH`)
- Modify: `backend/src/greenwave/etl/profile_osm.py` (`OsmScan.access_ways`, `is_access_way`, `_handle_linestring_with_highway`)
- Test: `backend/tests/etl/test_profile.py`

**Interfaces:**
- Produces:
  - `config.ACCESS_TRACK_TRACKTYPES: frozenset[str] = frozenset({"grade1", "grade2", "grade3"})`
  - `config.EMERGENCY_ACCESS_VALUES: frozenset[str] = frozenset({"yes", "designated", "official"})`
  - `config.EMERGENCY_EXTRA_HIGHWAY_VALUES: frozenset[str] = frozenset({"track", "pedestrian"})`
  - `CLASS_DEFAULT_SPEED_KMH["track"] = 15`, `["pedestrian"] = 10`
  - `OsmScan.access_ways: list[DrivableWay]`
  - `def is_access_way(highway: str, properties: dict[str, object]) -> bool` in `profile_osm.py` (it needs `tag`, which lives there)

- [ ] **Step 0: Baseline before any change** (the harness compares against unchanged code):
  ```bash
  cd backend && S=$(mktemp -d) && echo $S
  uv run python scripts/etl_equivalence.py run $S/base1 $S/base1.json
  uv run python scripts/etl_equivalence.py run $S/base2 $S/base2.json
  uv run python scripts/etl_equivalence.py compare $S/base1.json $S/base2.json
  ```
  Expected: the compare names only volatile entries. Note `$S` for Task 3.
- [ ] **Step 1: Write the failing tests** with `write_osm` / `line` from `tests/support/osm_fixtures.py`:
  - `test_scan_collects_access_ways_separately`: features: a `track` without tags, a `track tracktype=grade5`, a `track access=private`, a `pedestrian emergency=designated`, a `footway emergency=yes`, a `residential emergency=yes`, and a `primary`. Expect `[w.highway for w in scan.access_ways] == ["track", "pedestrian"]` and `[w.highway for w in scan.drivable_ways] == ["residential", "primary"]`.
  - `test_emergency_override_keeps_the_profile_count`: `service access=no emergency=yes` → `scan.drivable_excluded_by_access == 1`, `len(scan.access_ways) == 1`, `scan.drivable_ways == []`.
  - `test_motor_vehicle_is_not_consulted`: `track motor_vehicle=no tracktype=grade2` → in `access_ways`.
  - Parametrised `is_access_way` cases for every tracktype value and every emergency value.
- [ ] **Step 2: Run, expect FAIL.** `uv run pytest tests/etl/test_profile.py -q`. Expected: `AttributeError: 'OsmScan' object has no attribute 'access_ways'`.
- [ ] **Step 3: Implement.** In `_handle_linestring_with_highway`, a drivable way follows today's path. An excluded-by-access drivable way still increments the counter, then goes to `access_ways` when `is_access_way`. A non-drivable highway goes to `access_ways` when `is_access_way`. Build the `DrivableWay` with the same constructor call as today (extract a small `_drivable_way(feature, highway)` helper).
- [ ] **Step 4: Run, expect PASS;** then `uv run pytest tests/etl -q` (the profile baseline tests stay green).
- [ ] **Step 5: Commit**
  ```bash
  git add backend/src/greenwave/etl/config.py backend/src/greenwave/etl/profile_osm.py backend/tests/etl/test_profile.py
  git commit -m "feat: collect tracks and emergency ways as access ways"
  ```

### Task 2: Route over access ways

**Files:**
- Modify: `backend/src/greenwave/etl/prepare.py` (`prepare_scan`)
- Test: `backend/tests/etl/test_prepare.py`, `backend/tests/etl/test_road_rules.py`

**Interfaces:**
- Consumes: `OsmScan.access_ways` (Task 1).
- Produces: `prepare_scan(raw_dir).scan.drivable_ways` = welded `[*scan.drivable_ways, *scan.access_ways]`, original order kept. `access_ways` is left as scanned (reporting only). Downstream steps are unchanged.

- [ ] **Step 1: Write the failing tests:**
  - `test_road_rules.py`: change the coverage assertion at line 77 to `set(CLASS_DEFAULT_SPEED_KMH) >= DRIVABLE_HIGHWAY_VALUES | EMERGENCY_EXTRA_HIGHWAY_VALUES`; add `resolve_speed({}, "track") == SpeedResolution(15, "class_default")` and `resolve_speed({}, "pedestrian") == SpeedResolution(10, "class_default")`.
  - `test_prepare.py::test_access_ways_join_the_prepared_network`: a raw dir (`tests/support/pipeline_fixtures.make_raw` with `extra=`) containing a residential way and a track continuing from its end → both line numbers are in `prepare_scan(raw).scan.drivable_ways`.
  - `test_access_ways_are_welded`: the track ends 0.5 m short of the residential way → it appears among the weld report's welds.
  - `test_driveway_stays_excluded_after_merge`: `service=driveway access=no emergency=yes` → present in `drivable_ways` but `is_routable_way` is False for it (no graph edge).
- [ ] **Step 2: Run, expect FAIL.** `uv run pytest tests/etl/test_prepare.py tests/etl/test_road_rules.py -q`.
- [ ] **Step 3: Implement** the merge in `prepare_scan`. The `routable` list and the `welded_by_line` lookup run over the merged list.
- [ ] **Step 4: Run** `uv run pytest -q`. Expected: PASS (`tests/test_tiny_dataset.py` has no access ways, so it is unchanged).
- [ ] **Step 5: Commit**
  ```bash
  git add backend/src/greenwave/etl/prepare.py backend/tests/etl/test_prepare.py backend/tests/etl/test_road_rules.py
  git commit -m "feat: route over tracks and emergency access ways"
  ```

### Task 3: Rebuild the processed data and review the diff

**Files:**
- Modify: `backend/README.md` (one paragraph under the ETL section: what access ways are and that their speeds are placeholders)
- Generated (gitignored): `backend/data/processed/*`

- [ ] **Step 1: Run the new ETL in the harness** (using `$S` from Task 1 Step 0):
  ```bash
  uv run python scripts/etl_equivalence.py run $S/new $S/new.json
  uv run python scripts/etl_equivalence.py compare $S/base1.json $S/new.json --allow etl_report.json
  ```
  Expected: exit 1, listing the network-derived artefacts. For each differing entry, explain the cause from the access ways. Then rerun `compare` with `--allow` for exactly those entries. Expected: exit 0. Paste the allowed list and the one-line reasons into the milestone report.
- [ ] **Step 2: Measure.** With a short scratch script (in the scratchpad, not the repo), count from `$S/new/data/processed/network_edges.parquet`: edges with `highway == "track"` and `highway == "pedestrian"` in the largest strongly connected component. Find three points that were more than 150 m from every node in `$S/base1` and are within 150 m of a node now (e.g. in Las Wolski). Record counts and points in the report.
- [ ] **Step 3: Rebuild the real data:** `uv run python scripts/run_etl.py graph && uv run python scripts/run_etl.py intersections && uv run python scripts/run_etl.py neighbours && uv run python scripts/run_etl.py places && uv run python scripts/run_etl.py quality`. Expected: every step exits 0 and the server starts (`uv run uvicorn greenwave.main:app`, `GET /api/v1/stations` → 200).
- [ ] **Step 4: Verify in the API:** `POST /api/v1/dispatch/rank` at each recorded point → 200 with candidates (before: `DESTINATION_OFF_NETWORK`). A Błonia centre point (50.0597, 19.9090) is still `DESTINATION_OFF_NETWORK`, as expected until P8.
- [ ] **Step 5: Full checks, then commit**
  ```bash
  uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest
  git add backend/README.md
  git commit -m "docs: describe access ways in the ETL"
  ```
  Report the milestone: changed files, harness output, counts, points, check output.
