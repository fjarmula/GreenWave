# Refactor: ETL (M3 intersections, M4 pipeline-artifact modules) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break the ETL's multi-responsibility functions and the 890-line `etl/intersections.py` into single-responsibility units with byte-identical artifacts.

**Architecture:** `greenwave.etl.intersections` becomes a package (model, assignment, merge, grouping, grouping_report, naming, frames) whose `__init__` keeps today's public names. Long ETL functions (`build_signals` 249 lines, `build_graph` 160, `weld_ways` 119, `find_near_misses` 102, `run_route_checks` 131, `_split_edge` 9 params, `_grouping_report` 15 params) are split into named phase functions passing small dataclasses. `run_intersections` splits compute / write / report. `dataset/helpers.py` splits into IO and integrity checks. One measured optimisation: the merge-cap diagnostics reuse one along-road search instead of seven.

**Tech Stack:** Python 3.12, polars, networkx, shapely, numpy, Pydantic v2, pytest, ruff, mypy strict.

**Spec:** `docs/superpowers/specs/2026-10-17-clean-code-solid-refactor-design.md` (M3, M4, Constraints).

**Out of scope here (later plan, M4b):** analysis-only diagnostics that write no pipeline artifact the server loads — `profile*.py`, `roundabouts.py`, `cluster_map.py`, `override_map.py`, `street_comparison.py`, `overrides.draft_override_entries`. They are covered by the same ETL gate when touched.

## Global Constraints

- No behaviour, timing, or numeric change in ETL artifacts. No Pydantic schema change; `contracts/openapi.json` and `api.generated.ts` unchanged.
- No new dependencies, frameworks, DI containers, or abstract base classes "for the future". No new config knobs.
- Existing tests are the behaviour spec. Moving a test to follow a moved module is allowed; changing an assertion is not, without the human's approval. Import-line updates in tests are setup-only edits, listed in the milestone summary.
- **ETL equivalence gate:** harness `<scratchpad>/etl_golden.py` runs every `run_etl.py` step (profile, signals, graph, override-map, intersections, neighbours, roundabouts, cluster-map) through `main()` into a fresh scratch data dir (raw/overrides symlinked read-only), hashes every output file and `etl_report.json` with `generated_at_utc` stripped. Baseline = two runs on the pre-refactor code; files differing between those two runs are the only ones allowed to differ later. Compare with `<scratchpad>/etl_compare.py base1.json new.json --allow <volatile files>` → exit 0. Never write into `backend/data/`.
- Public names importable from `greenwave.etl.intersections` today stay importable from it.
- Performance claims need before/after numbers; drop a change whose gain is negligible.
- Branch `refactor/clean-code`; one commit per milestone (M3, M4) after checks are green; message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `graphify update .` after each milestone.
- Checks (from `backend/`): `uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`.

## Review Focus

- Graph node/edge insertion order: parquet row order follows it; any reordering in `build_graph`, `_split_edge` or `write_graph` changes artifact bytes. → ETL gate (Tasks 5, 12).
- Shared-reach optimisation (Task 4): a node beyond one cap's cutoff must still report `would_be_diameter_m=None` for that cap. → `test_cap_diagnostics_match_independent_merges` (Task 4).
- Signal handling of crossings judged against *counted* signals only, and the `standalone_if_every_signal_node_counted` diagnostic against *all* signals. → existing `test_crossings_are_typed_and_judged_against_counted_signals` + ETL gate (Task 6).
- Weld skip precedence: "endpoint already moved" before level check before collapse. → existing `test_weld.py` + ETL gate.
- Float summation order in reports (lengths, KPIs): keep the original loop order; `sum()` vs manual accumulation can differ in the last bit. → ETL gate.

---

## Milestone M3: Intersections

### Task 1: ETL equivalence baseline

**Files:** scratch only (`etl_golden.py`, `etl_compare.py`, `base1.json`, `base2.json`).

- [ ] **Step 1:** Run the harness twice on the pre-refactor tree (HEAD `eed9534`): `uv run python $S/etl_golden.py $S/etl_base1 $S/base1.json`, same for base2.
- [ ] **Step 2:** `python3 $S/etl_compare.py $S/base1.json $S/base2.json` → list of volatile files (expected: none or the HTML maps). Record the list and the per-step timings in the ledger.

### Task 2: `intersections` package — pure move

**Files:**
- Delete: `backend/src/greenwave/etl/intersections.py`
- Create: `backend/src/greenwave/etl/intersections/__init__.py` (module docstring with the 2026-10-14 decisions; re-exports; `__all__`)
- Create: `.../intersections/model.py` — `METHOD_*`, `REASON_*`, `NAME_SOURCE_*`, `GroupingSettings`, `Assignment`, `IntersectionRecord`
- Create: `.../intersections/node_queries.py` — `_ROAD_RANK`, `best_incident_class`, `centroid` (was `_centroid`)
- Create: `.../intersections/assignment.py` — `assign_approaches`, `AssignmentDistribution`, `distance_distribution`
- Create: `.../intersections/merge.py` — `reach_within`, `CappedCase`, `MergeResult`, `merge_junction_nodes`, `capped_case_sensitivity`, `capped_case_details`
- Create: `.../intersections/grouping.py` — `build_intersections`, `prepare_rings`, `intersection_index`
- Create: `.../intersections/grouping_report.py` — `GroupingReport`, `grouping_report` (was `_grouping_report`)
- Create: `.../intersections/naming.py` — `NameReport`, `name_report`
- Create: `.../intersections/frames.py` — `kind_delay_seconds`, `intersection_frame`, `approach_frame`
- Test: `backend/tests/etl/test_intersections_package.py`

**Interfaces:** Produces: every name in today's module stays importable from `greenwave.etl.intersections` (`__all__` lists exactly: AssignmentDistribution, Assignment, CappedCase, GroupingReport, GroupingSettings, IntersectionRecord, MergeResult, NameReport, METHOD_NEAREST, METHOD_OVERRIDE_ARM, METHOD_NONE, REASON_BEYOND_LIMIT, REASON_NO_JUNCTION, NAME_SOURCE_STREETS, NAME_SOURCE_COORDINATES, approach_frame, assign_approaches, best_incident_class, build_intersections, capped_case_details, capped_case_sensitivity, distance_distribution, intersection_frame, intersection_index, kind_delay_seconds, merge_junction_nodes, name_report, prepare_rings, reach_within).

- [ ] **Step 1: Failing test** `test_public_names_stay_importable_from_the_package` — for each name above, `getattr(greenwave.etl.intersections, name)` exists; and `test_submodules_own_their_parts` — `from greenwave.etl.intersections.merge import merge_junction_nodes` and `.grouping import build_intersections` import.
- [ ] **Step 2:** `uv run pytest tests/etl/test_intersections_package.py -q` → FAIL (no submodules).
- [ ] **Step 3:** Move code verbatim (only intra-package imports change). No logic edits in this task.
- [ ] **Step 4:** `uv run pytest tests/etl -q` → PASS; mypy clean.

### Task 3: Decompose `build_intersections`; `grouping_report` takes two dataclasses

**Files:** Modify `intersections/grouping.py`, `intersections/grouping_report.py`, `intersections/naming.py`; Test `backend/tests/etl/test_intersection_grouping.py`

**Interfaces:**
- Produces (grouping.py):
  - `@dataclass(frozen=True, slots=True) class GroupingInputs: graph: nx.MultiDiGraph; adjacency: Adjacency; attachments: list[Attachment]; assignments: list[Assignment]; rings: list[Ring]; settings: GroupingSettings`
  - `@dataclass(frozen=True, slots=True) class GroupingTrace: within: list[Assignment]; standalone: list[tuple[Assignment, str]]; junction_nodes: list[str]; ring_nodes_by_id: dict[int, list[str]]; free_nodes: list[str]; merge: MergeResult; crossing_merge: MergeResult; crossing_nodes: int`
  - `partition_by_limit(assignments: list[Assignment], limit_meters: float) -> tuple[list[Assignment], list[tuple[Assignment, str]]]`
  - Private phases, called in today's order: `_ring_records`, `_merged_records`, `_crossing_records`, `_midblock_records`, `_number_and_name`.
  - `build_intersections(...)` public signature unchanged.
- Produces (grouping_report.py): `grouping_report(inputs: GroupingInputs, trace: GroupingTrace, intersections: list[IntersectionRecord]) -> GroupingReport`.
- Produces (naming.py): `assign_names(record: IntersectionRecord, graph: nx.MultiDiGraph, ring: Ring | None) -> None` (the per-record naming block: ring name first, ≤3 components, coordinate fallback).

- [ ] **Step 1: Failing tests:** `test_partition_by_limit_names_each_standalone_reason` — assignments `(junction None)`, `(distance 60, limit 50)`, `(distance 50)`, `(distance None, junction "n")` → within = last two, standalone reasons `[REASON_NO_JUNCTION, REASON_BEYOND_LIMIT]`. `test_ring_name_leads_and_duplicates_drop` — ring named "Rondo X", graph names `["Rondo X", "A", "B", "C"]` (via a 1-node graph whose edges carry those names) → `street_names == ["Rondo X", "A", "B"]`, `name == "Rondo X / A / B"`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `uv run pytest tests/etl -q` PASS.

### Task 4: One along-road search for the merge-cap diagnostics

**Files:** Modify `intersections/merge.py`, `intersections/grouping_report.py`; Test `backend/tests/etl/test_intersection_merge.py`

**Interfaces:**
- `reach_table(adjacency: Adjacency, nodes: Iterable[str], cutoff: float) -> dict[str, dict[str, float]]` (today's dict comprehension over sorted nodes).
- `merge_junction_nodes(graph, adjacency, nodes, merge_distance_meters, max_diameter_meters, reach: Mapping[str, Mapping[str, float]] | None = None) -> MergeResult` — when `reach` is given, truncate each row to today's cutoff `max(merge_distance, 2 * max_diameter)` before use. Exact equivalence: Dijkstra distances ≤ c are the same whatever larger cutoff the search used.
- `capped_case_sensitivity` / `capped_case_details` gain optional `reach` with the same meaning; `grouping_report` computes one table at `max(merge_distance, 2 * max(all caps incl. configured))` and passes it to both.

- [ ] **Step 1: Failing test** `test_cap_diagnostics_match_independent_merges` — on a 6-node chain graph with 10 m/25 m/40 m gaps (adjacency built directly), for caps `(30, 40, 50, 60, 80)`: `merge_junction_nodes(..., cap, reach=reach_table(adj, nodes, 160))` equals `merge_junction_nodes(..., cap)` field by field (groups, capped incl. `would_be_diameter_m`, candidate_pairs, merges, diameters).
- [ ] **Step 2:** FAIL (unexpected kwarg). **Step 3:** implement. **Step 4:** `uv run pytest tests/etl -q` PASS.
- [ ] **Step 5:** Time the `intersections` step via the harness `_timing` before (Task 1) vs after (Task 5 run); keep only if faster beyond run-to-run spread, else revert and rule.

### Task 5: Pipeline compute / write / report split; M3 gate and commit

**Files:** Modify `backend/src/greenwave/etl/intersections_pipeline.py`; Test `backend/tests/etl/test_intersections_pipeline.py` (add one test)

**Interfaces:**
- `@dataclass(frozen=True, slots=True) class IntersectionsBuild` — everything `run_intersections` computes before writing: `prepared`, `attached`, `graph`, `attachments`, `assignments`, `intersections`, `grouping`, `rings`, `ring_problems`, `overrides`, `largest_scc`, `ulice_names`, `delay_by_kind`, `intersections_frame`, `approaches`, `near_after_frame`, `near_after`, `tertiary`, `settings`, `snap_tolerance_meters`.
- `compute_intersections(raw_dir: Path, overrides_dir: Path, snap_tolerance_meters: float, settings: GroupingSettings) -> IntersectionsBuild` (no processed dir: cannot write).
- `write_intersection_artifacts(build: IntersectionsBuild, raw_dir: Path, processed_dir: Path) -> str` → manifest sha256; same write order as today.
- `intersections_section(build: IntersectionsBuild, overrides_dir: Path, processed_dir: Path, manifest_sha256: str) -> IntersectionsSection`.
- `run_intersections(...)` signature unchanged = compute → write → section.

- [ ] **Step 1: Failing test** `test_compute_writes_nothing` — `make_raw(tmp_path)`; snapshot `sorted(tmp_path.rglob("*"))`; `compute_intersections(raw, tmp_path / "overrides", SIGNAL_SNAP_TOLERANCE_METERS, GroupingSettings())`; same file list afterwards; `build.intersections_frame.height > 0`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** full backend checks green.
- [ ] **Step 5: ETL gate:** harness → `$S/m3.json`; `etl_compare.py $S/base1.json $S/m3.json --allow <Task 1 volatile list>` → exit 0.
- [ ] **Step 6:** `graphify update .`; commit `refactor(etl): split intersections into a package of single-purpose modules`.

---

## Milestone M4: Pipeline-artifact modules

Tasks 7–11 are behaviour-preserving restructures of functions whose behaviour the existing module tests already pin (test_graph 16, test_weld 11, test_network 12, test_near_misses 7, test_route_checks 4, test_loader); they add no new test: green before, green after, plus the ETL gate. Each task ends with `uv run pytest tests/etl tests/dataset -q` green. The ETL gate runs once in Task 12 (and may be run earlier to localise a diff).

### Task 6: `build_signals` phases (`etl/signals.py`)

**Interfaces:**
- `classify_signal_tag(variant: str) -> tuple[SignalHandling, str | None]` — the policy branch (unrecognised → EXCLUDE_AND_REJECT + reason; EXCLUDE → reason; MANUAL_REVIEW → reason; else none).
- `@dataclass(slots=True) class _SignalTable` — `nodes`, `xy`, `node_types`, `variants`, `kinds`, `handling`, `reasons` (parallel lists, mutated by the crossing pass exactly as today).
- Phases, in today's order: `_classify(nodes) -> _SignalTable`, `_judge_crossings(table, settings) -> _CrossingVerdicts` (nearest_by_row, standalone_flags, standalone_if_any), `_provisional_clusters(xy, counts_signal, radius) -> tuple[np.ndarray, np.ndarray, np.ndarray]`, `_off_network_distances(...) -> dict[int, float]`, `_signal_frame(...) -> pl.DataFrame`, `_rejects(...) -> list[RejectEntry]`, `_signals_report(...) -> SignalsSection`.
- **Test (RED first):** `test_classify_signal_tag_policies` in `tests/etl/test_signals.py` — for one variant per `SignalHandling` value found in `SIGNAL_TAG_HANDLING`, plus `"made_up"`: handling as in the policy (`EXCLUDE_AND_REJECT` for `made_up`) and reason `None` only for `COUNT_IN_DELAY`; `made_up` reason contains `"unrecognised traffic_signals value"`.

### Task 7: `build_graph` phases (`etl/graph.py`)

**Interfaces:** `_clean_ways(routable) -> _CleanWays` (cleaned list, usage Counter, duplicates_removed, collapsed); `_project_vertices(cleaned, usage) -> tuple[dict[str, LonLat], dict[str, np.ndarray]]`; `@dataclass(slots=True) class _GraphStats` (reversible/unrecognised samples+counts, per-source length accumulators, highway counter, total_road_m) with `record_edge(highway, oneway_source, speed_source, length_m) -> None`; `_add_way_edges(graph, way, keys, ...) -> None` (node insertion via `ensure_node` order unchanged); `_graph_report(...) -> GraphBuildReport`.

### Task 8: `weld_ways` decisions (`etl/weld.py`)

**Interfaces:** `@dataclass(slots=True) class _WeldState` (`by_line`, `coordinates`, `lines_at_vertex`, `touched_ends`); `_decide(state, candidate) -> _Weld | str` (str = skip reason; precedence unchanged); `_apply(state, candidate, weld) -> None`; `_skip_record(candidate, reason) -> SkippedWeld`; `_weld_record(candidate, weld) -> WeldRecord`.

### Task 9: `_split_edge` context (`etl/network.py`)

**Interfaces:** `@dataclass(frozen=True, slots=True) class _SplitContext: graph; attachments; signals; arrivals`; `_split_edge(context, u, v, edge_id, data, requests) -> int` (6 params); phases `_place_requests(...) -> list[_NewNode]` (`_NewNode` NamedTuple: distance_m, key, signal_index, snap_kind), `_add_nodes(...)`, `_replace_with_pieces(...)`.

### Task 10: `find_near_misses` and `run_route_checks` phases

**Interfaces:** near_misses: `@dataclass(frozen=True) class _NearMissContext(graph, way_by_line)` with `row(kind, key, line, other_line, distance, *, other_node=None, other_xy=None)`; `_way_ends(graph, ways)`, `_lines_at(graph)`, `_node_near_misses(...)`, `_segment_near_misses(...)`, `_near_miss_report(frame, ends, tolerance)`. route_checks: `_unrouted(origin, destination, start, end, note) -> RouteCheck`, `_measure(graph, path, origin, destination, start, end, detour_range) -> tuple[RouteCheck, list[dict]]`, `_route_features(...) -> list[dict]`.

### Task 11: `dataset/helpers.py` → `dataset/artifact_io.py` + `dataset/integrity.py`

**Interfaces:** `artifact_io.py`: `require_files`, `read_json`, `parse`, `report_section`, `read_parquet`, `read_network`. `integrity.py`: `check_manifest_hashes`, `check_artifact_hashes`, `check_delays`, `check_references`, `check_ids_file`, `check_counts` (+ private `_unknown`, `_require_known`). Delete `helpers.py`; update `dataset/loader.py` and test imports.
- Test imports of `greenwave.dataset.helpers` switch to the new modules (setup-only). Run `uv run pytest tests/dataset -q`.

### Task 12: M4 gate and commit

- [ ] Full backend checks green; contracts diff empty.
- [ ] ETL gate: harness → `$S/m4.json`; compare against `base1.json` → exit 0.
- [ ] `graphify update .`; commit `refactor(etl): split long ETL builders into named phases`.
