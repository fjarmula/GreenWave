# Signal and Corridor Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each intersection kind its own delay key, expose per-intersection signal detail and cascade targets in the start response and dashboard, and use `approach_neighbours` as an independent cascade consistency check.

**Architecture:** The ETL adds `signal_count` and `needs_review` to `intersections.parquet` and splits the delay key per kind. `RoutingIndex.IntersectionInfo` carries the new fields; `to_start_response` maps them plus `RouteModel.cascade_targets` into four additive `RouteIntersection` fields. A pure checker compares route cascade pairs with the candidate table once per route start. The frontend renders the fields in `IntersectionList` and a new map layer.

**Tech Stack:** Python 3.12, polars, pydantic, FastAPI; Next.js, TypeScript, MapLibre, vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-signal-corridor-detail-design.md`

## Global Constraints

- Contract changes are additive; `schema_version` stays `"1.0"`.
- After the schema change: `cd backend && uv run python scripts/export_openapi.py && cd ../frontend && npm run generate:types`. Never hand-edit `contracts/openapi.json` or `frontend/src/types/api.generated.ts`.
- All three delay keys stay `35.0` until Task 6 approval.
- `approach_neighbours` never drives a runtime decision.
- Consistency check runs once per route start, never per tick.
- Fixed copy: review marker "Source data flagged for review".
- Backend checks: `cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`. Frontend checks (Node 22+): `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`.
- Read `frontend/AGENTS.md` (Next.js version notes) and `docs/engineering/frontend-dashboard.md` before frontend tasks.
- Commit subjects: `<category>: <message>`; stage explicit paths only.

## Review Focus

1. A route whose intersection has two approaches on the route: `cascade_targets` must reference ids only, never repeat the source, and only later intersections. Test in Task 3.
2. Cascade disabled in the start request → every `cascade_targets` is `[]` and the map draws no links. Tests in Tasks 3 and 5.
3. A cascade pair whose candidate row is missing produces exactly one WARNING log naming both intersection ids and does not fail the start request. Test in Task 4.
4. Mock mode and backend mode render the same list/badge/link components without runtime validation errors. Test in Task 5 (`validate.ts` on both fixtures).
5. An intersection with `needs_review=true` and `name=null` still renders ("Unnamed intersection" + marker). Test in Task 5.

---

### Task 1: Per-kind delay keys and new intersection columns (ETL)

**Files:**
- Modify: `backend/src/greenwave/etl/config.py` (add `MIDBLOCK_SIGNAL_DELAY_SECONDS = 35.0` beside the existing keys, comment: "placeholder equal to SIGNAL_DELAY_SECONDS until approved"), `backend/src/greenwave/etl/intersections/frames.py` (`kind_delay_seconds` gains `midblock_signal_delay_seconds` param; `intersection_frame` adds columns), `backend/src/greenwave/etl/intersections_pipeline.py` (pass `signals` frame into `intersection_frame`)
- Test: `backend/tests/etl/test_intersections.py`

**Interfaces:**
- Produces: `kind_delay_seconds(signal_delay_seconds=..., midblock_signal_delay_seconds=..., pedestrian_crossing_delay_seconds=...) -> dict[str, float]`; `intersections.parquet` columns `signal_count: Int64` (≥ 1) and `needs_review: Boolean`, defined exactly as in the spec "Definitions".

- [ ] **Step 1: Write failing tests**: `test_kind_delay_seconds_has_independent_midblock_key` (passing 20 for midblock leaves junction at 35); `test_intersection_frame_counts_distinct_member_signals`; `test_needs_review_true_when_member_signal_flagged`; `test_needs_review_true_when_approach_has_issue`; `test_needs_review_false_otherwise`.
- [ ] **Step 2: Run** `cd backend && uv run pytest tests/etl/test_intersections.py -v` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `uv run pytest tests/etl -v` → PASS.
- [ ] **Step 5: Commit** `feat: add per-kind delay keys and signal detail columns`.

### Task 2: Load signal detail and neighbour candidates into the routing index

**Files:**
- Modify: `backend/src/greenwave/dataset/constants.py` (`REQUIRED_COLUMNS[INTERSECTIONS_FILENAME]` += `signal_count: Int64`, `needs_review: Boolean`, `approaches: Int64`), `backend/src/greenwave/routing/network_index.py`, `backend/tests/support/processed.py`, `backend/tests/support/route_fixtures.py`
- Test: `backend/tests/routing/test_network_index.py`, `backend/tests/dataset/test_loader.py`

**Interfaces:**
- Produces: `IntersectionInfo` gains `signal_count: int`, `approach_count: int`, `needs_review: bool`. `RoutingIndex.neighbour_candidate(from_edge_id: str, to_edge_id: str) -> float | None` returns the smallest `distance_m` for that approach-edge pair from `dataset.approach_neighbours`, else `None` (built once into a mapping at index build). Fixture helpers gain matching keyword args with defaults `signal_count=1, approach_count=1, needs_review=False` and a way to add candidate rows.

- [ ] **Step 1: Write failing tests**: `test_index_exposes_signal_detail`; `test_neighbour_candidate_returns_min_distance_or_none`; `test_loader_rejects_intersections_without_signal_detail_columns` (message names `run_etl.py intersections`).
- [ ] **Step 2: Run** `uv run pytest tests/routing tests/dataset -v` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** backend checks → PASS.
- [ ] **Step 5: Commit** `feat: load signal detail and neighbour candidates into routing index`.

### Task 3: Contract fields on RouteIntersection

**Files:**
- Modify: `backend/src/greenwave/schemas/simulation.py` (`RouteIntersection`), `backend/src/greenwave/simulation/route_model.py` (`to_start_response`), `contracts/openapi.json` and `frontend/src/types/api.generated.ts` (regenerated only), `docs/adr/0003-simulation-contract-v1.md` (append an "Additive change 2026-10-19" note listing the four fields)
- Test: `backend/tests/simulation/test_route_model.py`, `backend/tests/schemas/test_simulation_schemas.py`

**Interfaces:**
- Produces on `RouteIntersection`: `signal_count: Annotated[int, Field(ge=1)]`, `approach_count: Annotated[int, Field(ge=1)]`, `needs_review: bool`, `cascade_targets: list[str]` (route order). All required in the model (backend always sends them).

- [ ] **Step 1: Write failing tests**: `test_start_response_includes_signal_detail`; `test_start_response_cascade_targets_are_later_route_ids_in_order` (Review Focus 1, reuse the two-approach fixture from `test_route_model_groups_multiple_approaches_and_uses_first_stop_line_for_cascade`); `test_start_response_cascade_targets_empty_when_cascade_disabled` (Review Focus 2); schema test rejecting `signal_count=0`.
- [ ] **Step 2: Run** `uv run pytest tests/simulation/test_route_model.py tests/schemas -v` → FAIL.
- [ ] **Step 3: Implement**, then regenerate contracts with the Global Constraints command.
- [ ] **Step 4: Run** backend checks → PASS; `cd frontend && npm run typecheck` → expected FAIL only in files Task 5 updates (note them).
- [ ] **Step 5: Commit** `feat: expose signal detail and cascade targets on route intersections` (include regenerated contract files).

### Task 4: Cascade consistency check against approach_neighbours

**Files:**
- Create: `backend/src/greenwave/simulation/cascade_check.py`
- Modify: `backend/src/greenwave/simulation/assembly.py` (call once after `build_route_model`, log mismatches)
- Test: `backend/tests/simulation/test_cascade_check.py`, `backend/tests/dataset/test_real_data_smoke.py` (add a case under the existing real-data skip marker)

**Interfaces:**
- Consumes: `RouteModel`, `PlannedRoute.stop_lines`, `RoutingIndex.neighbour_candidate` (Task 2).
- Produces: `CascadeMismatch(source_id: str, target_id: str, source_edge_id: str, target_edge_id: str, along_route_m: float, candidate_m: float | None)`; `find_cascade_mismatches(route: PlannedRoute, route_model: RouteModel, index: RoutingIndex) -> tuple[CascadeMismatch, ...]`. Rule exactly as the spec: candidate exists and `candidate_m <= along_route_m + 0.01`. Source/target edge = the `edge_id` of that intersection's first stop line on the route.

- [ ] **Step 1: Write failing tests**: `test_no_mismatch_when_candidate_present_and_shorter`; `test_mismatch_when_candidate_missing`; `test_mismatch_when_candidate_longer_than_along_route`; `test_boundary_candidate_equal_plus_tolerance_is_ok`; `test_assembly_logs_one_warning_per_mismatch_and_still_starts` (Review Focus 3, `caplog`); real-data smoke: for each origin×destination pair of the six dispatch endpoints, zero mismatches.
- [ ] **Step 2: Run** `uv run pytest tests/simulation/test_cascade_check.py -v` → FAIL.
- [ ] **Step 3: Implement.** Logger name `greenwave.simulation.cascade_check`; message includes both intersection ids and both distances.
- [ ] **Step 4: Run** backend checks → PASS. If the real-data smoke reports mismatches, stop and use systematic-debugging: a mismatch means either the route took a U-turn (candidate set excludes them, `CASCADE_ALLOW_U_TURNS=False`) or a bug; report to the human, do not loosen the rule.
- [ ] **Step 5: Commit** `feat: check route cascade against neighbour candidate set`.

### Task 5: Dashboard — intersection detail and cascade links

**Files:**
- Modify: `frontend/src/lib/transport/validate.ts` (validate the four fields), `frontend/src/lib/transport/__fixtures__/architecture-examples.ts`, `frontend/src/lib/mock-simulation-config.ts` (`MOCK_SAMPLE_INTERSECTIONS` gain `signal_count`, `approach_count`, `needs_review`; one sample has `needs_review: true`), `frontend/src/lib/mock-session.ts` (derive `cascade_targets` with the same threshold logic already used near line 255; empty when cascade disabled), `frontend/src/components/hud/IntersectionList.tsx`, `frontend/src/components/map/MapContainer.tsx`
- Create: `frontend/src/components/map/CascadeLinksLayer.tsx`, `frontend/src/lib/cascade-links.ts`
- Test: `frontend/src/lib/cascade-links.test.ts`, `frontend/src/lib/transport/validate.test.ts`, `frontend/src/lib/mock-session.test.ts`, `frontend/src/components/hud/` snapshot tests, `frontend/src/lib/mock-simulation-adapter.golden.test.ts`

**Interfaces:**
- Consumes: generated `RouteIntersection` type (Task 3).
- Produces: `cascadeLinkFeatures(route: SimulationStartResponse): GeoJSON.FeatureCollection<GeoJSON.LineString, { source_id: string; target_id: string }>` — one straight segment per (source, target) pair, source position → target position. `CascadeLinksLayer` props: `{ route: SimulationStartResponse | null }`, rendered below `SignalMarkers`. `IntersectionList` shows a kind label (`signalised_junction` → "Junction", `midblock_signal` → "Mid-block signal", `pedestrian_crossing` → "Pedestrian crossing"), "`n` signals", and the marker "Source data flagged for review" when `needs_review`.

- [ ] **Step 1: Write failing tests**: `cascadeLinkFeatures` returns 0 features when all targets empty (Review Focus 2) and N features otherwise with correct ids; `validate` rejects a start response missing `cascade_targets` and accepts both fixtures (Review Focus 4); mock session emits `cascade_targets: []` when cascade disabled; `IntersectionList` snapshot with `name: null, needs_review: true` shows "Unnamed intersection" and the marker (Review Focus 5).
- [ ] **Step 2: Run** `cd frontend && npm test` → FAIL.
- [ ] **Step 3: Implement.** Update the golden test fixture deliberately; the diff must contain only the new fields.
- [ ] **Step 4: Run** frontend checks → PASS. Visual check with the playwright-cli skill in mock and backend modes (screenshots to `.tmp/playwright/`): list shows kind and counts, links visible on a cascade route.
- [ ] **Step 5: Commit** `feat: show intersection detail and cascade links on dashboard`.

### Task 6: HUMAN CHECKPOINT — approve per-kind delays

- [ ] **Step 1: Rebuild** real data: `cd backend && uv run python scripts/run_etl.py intersections && uv run python scripts/run_etl.py neighbours`; server starts cleanly.
- [ ] **Step 2: STOP.** Present: count per kind (428 / 52 / 54 on the 2026-10-13 snapshot, re-read from the rebuilt data), count per kind on the six-endpoint demo routes, and normal-estimate deltas for any candidate values the human proposes. Ask for the three values. Do not proceed without an explicit answer.
- [ ] **Step 3: Apply** approved values in `etl/config.py` with `# APPROVED <YYYY-MM-DD> (human)`; rebuild; update tests whose expected delays change.
- [ ] **Step 4: Docs.** Tell the human, then edit `GreenWave_ARCHITECTURE.md` §3 (`D_u` sentence "35 s for every kind") with the per-kind values.
- [ ] **Step 5: Verify** backend and frontend checks → PASS.
- [ ] **Step 6: Commit** `feat: apply approved per-kind intersection delays` and `docs: record per-kind intersection delays`.
