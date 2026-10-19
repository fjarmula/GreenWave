# Road Attributes in Travel Times Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive bus-lane, tram-track, lane, surface and traffic-calming attributes per directed edge, cross-check the Kraków bus-lane CSV, and feed the attributes into one edge-time function used by routing, estimates and simulated motion.

**Architecture:** Way-level attributes are resolved in `etl/graph.py` from OSM tags; geometry-level attributes (`calming_count`, `tram_track`) are computed on the final network graph in the `intersections` step. The loader carries them into `EdgeView`; a new `routing/edge_times.py` is the single place that turns an edge plus settings into seconds. All factors are `SimulationSettings` fields with neutral defaults, so behaviour is unchanged until the human approval checkpoint (Task 9).

**Tech Stack:** Python 3.12, polars, shapely 2, networkx, pydantic-settings, pytest.

**Spec:** `docs/superpowers/specs/2026-10-19-road-attributes-design.md`

## Global Constraints

- All distance work in `EPSG:2178` metres (`METRIC_CRS`).
- Every new factor defaults to neutral: `1.0` multipliers, `0.0` seconds. Non-neutral values only after Task 9 approval.
- Tram thresholds are placeholders: `TRAM_TRACK_MATCH_METERS = 6.0`, `TRAM_TRACK_MIN_OVERLAP_SHARE = 0.5`.
- `b(e)` is the **max** of applicable boosts, applied before the 30/90 km/h clamp.
- Unknown tag → null / false → no effect.
- No contract change. No `GreenWave_ARCHITECTURE.md` edit before Task 9 (and tell the human first).
- Tests use synthetic fixtures only; real-data runs are manual.
- Backend checks: `cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`.
- Commit subjects: `<category>: <message>`; stage explicit paths only.

## Review Focus

1. A two-way way tagged only `bus:lanes:forward` must give `bus_lane=True` on the `+` edge and `False` on the `-` edge. Test in Task 2.
2. With all settings at default, the engine golden test (`tests/simulation/test_engine_golden.py`) and estimates tests pass unchanged. Asserted in Tasks 6 and 7.
3. An edge split at a signal must not double-count a calming point at the split vertex: the point counts on exactly one piece (the piece whose geometry starts at it is excluded; it counts on the piece that ends there). Test in Task 3.
4. A processed dataset written before this plan (no new columns) must make server startup fail with the existing "re-run intersections" message, not a `KeyError`. Test in Task 5.
5. With non-neutral calming seconds, the simulated run's elapsed time on a fixture route equals the GreenWave estimate to within one tick. Test in Task 7.

---

### Task 1: Scan tram lines and traffic-calming points

**Files:**
- Modify: `backend/src/greenwave/etl/profile_osm.py` (`OsmScan`, `_scan_point`, `scan_osm`)
- Test: `backend/tests/etl/test_profile.py`

**Interfaces:**
- Produces: `OsmScan.calming_points: list[PointFeature]` (points with `traffic_calming` tag, value not `no`); `OsmScan.tram_lines: list[list[LonLat]]` (valid LineStrings tagged `railway=tram`, any `highway`).

- [ ] **Step 1: Write failing tests** `test_scan_collects_traffic_calming_points` (fixture with `bump`, `table`, `no` → 2 collected) and `test_scan_collects_tram_lines` (one `railway=tram` LineString, one `railway=rail` → 1 collected). Use the fixture helpers in `tests/support/osm_fixtures.py`.
- [ ] **Step 2: Run** `uv run pytest tests/etl/test_profile.py -k "calming or tram" -v` → FAIL (attribute missing).
- [ ] **Step 3: Implement.** In `_scan_point` append to `calming_points`; in `scan_osm`, before the `highway is None` early exit, append coordinates of valid LineStrings with `railway=tram`.
- [ ] **Step 4: Run** the same command → PASS; run `uv run pytest tests/etl` → PASS.
- [ ] **Step 5: Commit** `feat: scan tram lines and traffic-calming points from OSM`.

### Task 2: Way-level attributes on graph edges

**Files:**
- Create: `backend/src/greenwave/etl/road_attributes.py`
- Modify: `backend/src/greenwave/etl/config.py` (add `UNPAVED_SURFACE_VALUES`, `PAVED_SURFACE_VALUES`), `backend/src/greenwave/etl/graph.py` (`_WayRules`, `_add_segment`: attributes differ per direction), `backend/src/greenwave/etl/graph_io.py` (columns + dtypes)
- Test: `backend/tests/etl/test_road_attributes.py`, `backend/tests/etl/test_graph.py`

**Interfaces:**
- Produces in `road_attributes.py`:
  - `bus_lane_directions(properties: dict[str, object]) -> tuple[bool, bool]` — (along digitised direction, against it).
  - `lanes_per_direction(properties: dict[str, object], oneway: bool) -> tuple[int | None, int | None]` — (forward, backward).
  - `surface_class(properties: dict[str, object]) -> str | None` — `"paved" | "unpaved" | None`.
- Produces edge attributes / parquet columns: `bus_lane: Boolean`, `lanes_per_direction: Int64 (nullable)`, `surface_class: String (nullable)`. `lanes` stays.
- Config values (analysis, approved list wording in comment "OSM wiki Key:surface"): `PAVED_SURFACE_VALUES = {"asphalt","concrete","paving_stones","sett","concrete:plates","concrete:lanes","paved","cobblestone","metal","wood","unhewn_cobblestone"}`, `UNPAVED_SURFACE_VALUES = {"unpaved","gravel","fine_gravel","compacted","dirt","earth","ground","grass","sand","mud","pebblestone","grass_paver"}`.

- [ ] **Step 1: Write failing tests** in `test_road_attributes.py`:
  - `bus_lane_directions({"bus:lanes:forward": "|designated"}) == (True, False)`
  - `bus_lane_directions({"bus:lanes": "designated|"}) == (True, True)`
  - `bus_lane_directions({"busway:left": "lane"}) == (False, True)`; `{"busway": "no"}` → `(False, False)`
  - `bus_lane_directions({"lanes:psv": "1"}) == (True, True)`; `{"lanes:psv": "0"}` → `(False, False)`
  - `lanes_per_direction({"lanes": "4"}, oneway=False) == (2, 2)`; `{"lanes": "3"}` two-way → `(1, 1)`; `{"lanes": "2"}` oneway → `(2, None)`; `{"lanes:forward": "2", "lanes:backward": "1", "lanes": "3"}` → `(2, 1)`; `{}` → `(None, None)`
  - `surface_class({"surface": "gravel"}) == "unpaved"`, `"asphalt"` → `"paved"`, `"weird"` → `None`, missing → `None`
  And in `test_graph.py`: `test_two_way_way_with_forward_bus_lane_marks_only_plus_edge` (Review Focus 1).
- [ ] **Step 2: Run** `uv run pytest tests/etl/test_road_attributes.py tests/etl/test_graph.py -v` → FAIL.
- [ ] **Step 3: Implement** the three functions, then set per-direction attributes in `_add_segment` (forward/reverse values chosen by the edge's sign; a `backward`-only oneway edge uses the "against" values). Add the three columns to `graph_io` write/read with the dtypes above. Count unknown surface values in `_GraphBuilder` for the report (`unknown_surface_values: Counter[str]`).
- [ ] **Step 4: Run** `uv run pytest tests/etl -v` → PASS.
- [ ] **Step 5: Commit** `feat: derive bus lane, lanes per direction and surface per edge`.

### Task 3: Calming count and tram track on the network graph

**Files:**
- Create: `backend/src/greenwave/etl/edge_enrichment.py`
- Modify: `backend/src/greenwave/etl/config.py` (tram placeholders), `backend/src/greenwave/etl/intersections_pipeline.py` (`compute_intersections`, `IntersectionsBuild`, `intersections_section`), `backend/src/greenwave/etl/graph_io.py`, `backend/scripts/run_etl.py` (write `road_attributes` report section in the `intersections` branch)
- Test: `backend/tests/etl/test_edge_enrichment.py`, `backend/tests/etl/test_intersections_pipeline.py`

**Interfaces:**
- Consumes: `OsmScan.calming_points`, `OsmScan.tram_lines` (Task 1); `project_points` from `etl/geo.py`.
- Produces:
  - `annotate_calming(graph: nx.MultiDiGraph, points_xy: np.ndarray, on_vertex_m: float = 0.5) -> CalmingStats` — sets `calming_count: int` on every edge; `CalmingStats(points_total: int, points_on_edges: int, points_off_network: int)`.
  - `annotate_tram_tracks(graph: nx.MultiDiGraph, tram_lines_xy: list[np.ndarray], match_m: float, min_share: float) -> TramStats` — sets `tram_track: bool`; `TramStats(edges_marked: int, km_marked: float, match_m: float, min_share: float)`.
  - `RoadAttributesSection` (pydantic) with calming stats, tram stats, km per `bus_lane`, km per `surface_class` (incl. `"unknown"`), `unknown_surface_values` sample (≤ 20), edge count per `lanes_per_direction`.
  - Parquet columns in `network_edges.parquet`: `calming_count: Int64`, `tram_track: Boolean`.
- Algorithm (calming): a point counts on an edge if it is within `on_vertex_m` of an interior vertex or of the edge's **end** vertex, never of its start vertex; on a two-way road both directed edges count it (each direction drives over it).
- Algorithm (tram): STRtree over tram lines buffered by `match_m`; share = `edge.intersection(union_of_hits).length / edge.length`; mark when `share >= min_share`.

- [ ] **Step 1: Write failing tests**: `test_calming_point_counted_once_across_split_pieces` (Review Focus 3), `test_calming_point_counts_on_both_directions_of_two_way_road`, `test_calming_point_far_from_roads_reported_off_network`, `test_tram_line_parallel_within_threshold_marks_edge`, `test_tram_line_crossing_perpendicular_does_not_mark_edge` (overlap share < 0.5), `test_tram_threshold_boundary_inclusive` (line exactly 6.0 m away marks). In `test_intersections_pipeline.py`: `test_network_edges_carry_road_attribute_columns`.
- [ ] **Step 2: Run** `uv run pytest tests/etl/test_edge_enrichment.py tests/etl/test_intersections_pipeline.py -v` → FAIL.
- [ ] **Step 3: Implement** both functions; call them in `compute_intersections` right after `attach_signals`; store stats on `IntersectionsBuild`; write the section to the ETL report under key `road_attributes` from `run_etl.py`.
- [ ] **Step 4: Run** `uv run pytest tests/etl -v` → PASS.
- [ ] **Step 5: Commit** `feat: count traffic calming and mark tram tracks on network edges`.

### Task 4: Bus-lane CSV cross-check

**Files:**
- Create: `backend/src/greenwave/etl/bus_lanes.py`
- Modify: `backend/src/greenwave/artifacts.py` (`BUS_LANE_CROSSCHECK_FILENAME = "bus_lane_crosscheck.csv"`), `backend/src/greenwave/etl/intersections_pipeline.py` (write the CSV in `write_intersection_artifacts`, counts in `RoadAttributesSection.bus_lane_crosscheck: dict[str, int]`), `backend/data/raw/MANIFEST.json` (Buspasy `notes` → "Cross-check only: matched by street name against OSM bus-lane edges (bus_lane_crosscheck.csv); never changes the network."), `backend/README.md` (ETL outputs list)
- Test: `backend/tests/etl/test_bus_lanes.py`

**Interfaces:**
- Consumes: `normalise_street_name` (`etl/street_names.py`); the network graph with `bus_lane` and `name`.
- Produces: `BusLaneRow(objectid: int, kategoria: str, organizacja: str, opis: str, csv_length_m: float)`; `read_bus_lane_csv(path: Path) -> list[BusLaneRow]` (UTF-8 with BOM); `parse_opis(opis: str) -> ParsedOpis | None` with `ParsedOpis(street: str, from_: str | None, to: str | None)`; `crosscheck_bus_lanes(rows: list[BusLaneRow], graph: nx.MultiDiGraph, ulice_names: set[str]) -> pl.DataFrame` with exactly the columns and `status` values in the spec.
- The CSV is found by glob `krakow/Buspasy_*.csv` in `raw_dir`; exactly one match required, else `FileNotFoundError` naming the pattern.

- [ ] **Step 1: Write failing tests**: `parse_opis("ul. Warszawska od Al. Słowackiego do ul. Szlak")` → street normalises equal to `normalise_street_name("Warszawska")`, from/to set; `parse_opis("Aleje Trzech Wieszczów od przystanku Jubilat 03 do ul. Warszawskiej")` → street parsed; `parse_opis("rondo bez opisu")` → `None`; `test_crosscheck_statuses` covering all four statuses on a 3-edge graph; `test_read_bus_lane_csv_handles_bom`.
- [ ] **Step 2: Run** `uv run pytest tests/etl/test_bus_lanes.py -v` → FAIL.
- [ ] **Step 3: Implement**; write the CSV sorted by `objectid`.
- [ ] **Step 4: Run** `uv run pytest tests/etl -v` → PASS; `uv run python scripts/build_manifest.py --check` → PASS (notes are metadata; if the check hashes notes, regenerate via the script's documented update path, not by hand).
- [ ] **Step 5: Commit** `feat: cross-check Kraków bus-lane register against OSM`.

### Task 5: Load attributes into the routing index

**Files:**
- Modify: `backend/src/greenwave/dataset/constants.py` (`REQUIRED_COLUMNS[NETWORK_EDGES_FILENAME]` += `bus_lane: Boolean`, `tram_track: Boolean`, `lanes_per_direction: Int64`, `surface_class: String`, `calming_count: Int64`), `backend/src/greenwave/routing/network_index.py` (`EdgeView`), `backend/tests/support/processed.py` and `backend/tests/support/route_fixtures.py` (fixtures write/accept the new fields with neutral values by default)
- Test: `backend/tests/dataset/test_loader.py`, `backend/tests/routing/test_network_index.py`

**Interfaces:**
- Produces: `EdgeView` gains `bus_lane: bool`, `tram_track: bool`, `lanes_per_direction: int | None`, `surface_class: str | None`, `calming_count: int`. `route_fixtures.corridor_index()`'s `edge(...)` helper gains keyword args with those names, defaulting to `False, False, None, None, 0`.

- [ ] **Step 1: Write failing tests**: `test_loader_rejects_edges_without_road_attribute_columns` (Review Focus 4: expect the existing missing-column error type and a message containing `run_etl.py intersections`); `test_edge_view_exposes_road_attributes`.
- [ ] **Step 2: Run** `uv run pytest tests/dataset tests/routing -v` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full backend checks → PASS.
- [ ] **Step 5: Commit** `feat: load road attributes into the routing index`.

### Task 6: Edge-time function and settings

**Files:**
- Create: `backend/src/greenwave/routing/edge_times.py`
- Modify: `backend/src/greenwave/simulation_settings.py`, `backend/src/greenwave/routing/planner.py` (move `ambulance_speed_kmh` into `edge_times.py`; re-export not needed — update imports)
- Test: `backend/tests/routing/test_edge_times.py`

**Interfaces:**
- Consumes: `EdgeView` (Task 5).
- Produces settings (names, defaults and bounds exactly as the spec table): `normal_single_lane_factor: float = Field(default=1.0, ge=1.0)`, `normal_unpaved_factor: float = Field(default=1.0, ge=1.0)`, `normal_calming_seconds: float = Field(default=0.0, ge=0)`, `ambulance_calming_seconds: float = Field(default=0.0, ge=0)`, `ambulance_bus_lane_factor: float = Field(default=1.0, ge=1.0)`, `ambulance_tram_track_factor: float = Field(default=1.0, ge=1.0)`.
- Produces functions:
  - `ambulance_speed_kmh(speed_kmh: float, settings: SimulationSettings, boost: float = 1.0) -> float` — `min(max(factor * speed * boost, min), max)`.
  - `ambulance_boost(edge: EdgeView, settings: SimulationSettings) -> float` — max of applicable factors, 1.0 if none.
  - `ambulance_edge_seconds(edge: EdgeView, settings: SimulationSettings) -> float`
  - `normal_edge_seconds(edge: EdgeView, multiplier: float, settings: SimulationSettings) -> float`
  - `ambulance_effective_speed_mps(edge: EdgeView, settings: SimulationSettings) -> float` — `edge.length_m / ambulance_edge_seconds(...)`.

- [ ] **Step 1: Write failing tests**: neutral defaults reproduce `L·μ/V` and `L/V_amb` exactly; single-lane factor applies only when `lanes_per_direction == 1` (not `None`, not `2`); unpaved factor only on `"unpaved"`; calming adds `n·s` to both functions independently; bus lane + tram → `max` not product (e.g. 1.2 and 1.1 → 1.2); boost applies before clamp (`V_e=80`, factor 1.3, boost 1.2 → 90 cap); settings reject `ambulance_bus_lane_factor=0.9`.
- [ ] **Step 2: Run** `uv run pytest tests/routing/test_edge_times.py -v` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full backend checks → PASS (Review Focus 2: golden and estimate tests unchanged).
- [ ] **Step 5: Commit** `feat: add road-attribute edge-time model with neutral defaults`.

### Task 7: Use the edge-time function everywhere

**Files:**
- Modify: `backend/src/greenwave/routing/planner.py` (`_edge_weight` looks up `index.edge(edge_id)` per parallel candidate and uses `ambulance_edge_seconds`; `_edge_key` same; `PlannedRoute` gains `edges: tuple[EdgeView, ...]` and drops `edge_speeds_kmh`), `backend/src/greenwave/routing/estimates.py` (sum `normal_edge_seconds` / `ambulance_edge_seconds` over `route.edges`), `backend/src/greenwave/simulation/route_track.py` (`_speeds_mps` from `ambulance_effective_speed_mps`)
- Test: `backend/tests/routing/test_planner.py`, `backend/tests/routing/test_estimates.py`, `backend/tests/simulation/test_route_track.py`, `backend/tests/simulation/test_engine.py`

**Interfaces:**
- Consumes: Task 6 functions; `EdgeView`.
- Produces: `PlannedRoute.edges: tuple[EdgeView, ...]` (route order). Any caller of `edge_speeds_kmh` is updated (grep it; `graphify query "edge_speeds_kmh"` first).

- [ ] **Step 1: Write failing tests**: `test_planner_prefers_bus_lane_branch_when_boosted` (two parallel branches, equal time at neutral; boosted bus-lane branch wins with `ambulance_bus_lane_factor=1.5`); `test_estimates_include_calming_seconds`; `test_route_track_speed_includes_calming_seconds`; `test_simulated_elapsed_matches_greenwave_estimate_with_calming` (Review Focus 5: run engine to ARRIVED on the corridor fixture with `ambulance_calming_seconds=2`, `calming_count=3` on one edge; `abs(elapsed - greenwave_estimate) <= tick_interval_seconds`, intersections' `D_min` included).
- [ ] **Step 2: Run** `uv run pytest tests/routing tests/simulation -v` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full backend checks → PASS, including `test_engine_golden.py` unchanged.
- [ ] **Step 5: Commit** `feat: route, estimate and simulate with road-attribute edge times`.

### Task 8: Real-data rebuild and evidence table

**Files:**
- Create: `backend/scripts/road_attribute_evidence.py`
- Modify: `backend/README.md` (document the script and the new artifacts)

**Interfaces:**
- Consumes: built `data/processed/`, the six dispatch endpoints in `frontend/src/components/map/dispatch-endpoints.ts` (copy their coordinates into the script as a constant with a comment pointing at the source file).
- Produces: stdout Markdown with (a) km and edge counts per attribute value from `etl_report.json` `road_attributes`, (b) bus-lane cross-check counts, (c) for each origin×destination pair and each candidate profile, normal and GreenWave estimates. Candidate profiles are CLI-supplied (`--set normal_single_lane_factor=1.2 ...`, repeatable `--profile NAME`), not hard-coded.

- [ ] **Step 1: Rebuild** `cd backend && uv run python scripts/build_manifest.py --check && uv run python scripts/run_etl.py intersections && uv run python scripts/run_etl.py neighbours` → completes; server starts: `uv run uvicorn greenwave.main:app` → no startup error.
- [ ] **Step 2: Write** the script (no unit test: manual report tool, like `scripts/bench/`); run it with the neutral profile → estimates equal current dashboard values for the same pairs.
- [ ] **Step 3: Sanity-check** the report: bus-lane km > 0, tram km > 0, calming `points_on_edges` close to the ~1,768 OSM features minus off-network. If any is zero, stop and debug (systematic-debugging) before Task 9.
- [ ] **Step 4: Commit** `feat: add road-attribute evidence report script`.

### Task 9: HUMAN CHECKPOINT — approve factor values

- [ ] **Step 1: STOP.** Present the evidence output from Task 8 to the human with at least two candidate profiles. Ask for values for the six settings and the two tram thresholds. Do not proceed without an explicit answer.
- [ ] **Step 2: Apply approved values** as `SimulationSettings` defaults and `etl/config.py` tram constants, each with comment `# APPROVED <YYYY-MM-DD> (human): <one-line reason>`. Re-run `intersections` and `neighbours` if tram thresholds changed.
- [ ] **Step 3: Update tests** whose expected values change because defaults changed: golden snapshots get regenerated only through the golden test's documented update path; review the diff and confirm every change is explained by the new factors.
- [ ] **Step 4: Docs.** Tell the human, then edit `GreenWave_ARCHITECTURE.md` §3 (normal and GreenWave formulas as in the spec "Time model") and §6 item 6 (bus-lane CSV: cross-check only). Create `docs/adr/0005-road-attribute-time-factors.md` from `docs/adr/0001-template.md` recording values, evidence summary, the `max` boost rule and the tram reserved-track caveat. Document the six `GREENWAVE_SIM_*` variables in `backend/README.md`.
- [ ] **Step 5: Verify** full backend checks and frontend checks (`cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`) → PASS. Smoke-run the dashboard against the backend for one route (playwright-cli skill, output under `.tmp/playwright/`): estimates render, run completes.
- [ ] **Step 6: Commit** `feat: apply approved road-attribute time factors` and separately `docs: record road-attribute time model`.
