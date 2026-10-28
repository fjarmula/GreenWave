# P8 On-Foot Incident Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Also: test-driven-development, systematic-debugging, emil-design-eng (ranking row, connector styling), playwright-cli, verification-before-completion. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An incident off the drivable network but within 800 m on foot of it (Błonia, Park Jordana) gets a corridor to the access node with the lowest drive + walk time. The walking leg is shown in the ranking, on the map and in driver mode.

**Architecture:**
- A new `routing/access.py` finds access nodes within the on-foot limit and picks the best by drive + walk.
- `plan_route` falls back to it when the destination does not snap, so start, comparison and ranking share one behaviour. `PlannedRoute.on_foot` carries the leg.
- Ranking replaces its reversed single-source Dijkstra with a seeded one (each access node starts at its walking seconds). For on-road incidents that is the same single seed at 0.
- The contract gains an additive `OnFootLeg`; the frontend shows it.

**Tech Stack:** Python 3.12+, FastAPI, Pydantic v2, networkx, shapely 2 (`STRtree.query(..., predicate="dwithin")`), pytest; React 19, MapLibre GL 6.14, Vitest, `@playwright/cli`.

**Spec:** `docs/superpowers/specs/2026-10-24-dispatch-access-and-map-framing-design.md` (section D). Depends on P5 (selected candidate) and runs after P7.

## Global Constraints

- Settings, labelled `PLACEHOLDER 2026-10-24 (human: 800 m max walk; detour and speed uncalibrated)`:
  - `max_on_foot_meters = 800` (`gt=0`, finite)
  - `on_foot_detour_factor = 1.3` (`ge=1.0`)
  - `on_foot_speed_meters_per_second = 1.4` (`gt=0`)
- On-foot distance = straight line (EPSG:2178) × detour factor. Only main-component nodes (the index's snap set) qualify.
- The access node is chosen by minimum `drive seconds + on-foot seconds`, ties by `node_key`, never the origin's own node.
- On-road behaviour (snap ≤ 150 m) is byte-identical: existing routing, ranking, simulation and golden tests pass unchanged.
- Origins never use the fallback (`ORIGIN_OFF_NETWORK` unchanged).
- Contract additive, `schema_version` `"1.0"`:
  - `OnFootLeg {access_point: Position, distance_m ≥ 0, seconds ≥ 0}`
  - `RankedCandidate.on_foot: OnFootLeg | None = None`
  - `SimulationStartResponse.destination_on_foot: OnFootLeg | None = None`
- Copy (exact):
  - backend 422 message: `Incident is farther than 800 m on foot from any vehicle access point` (the number comes from the setting, `:.0f`)
  - rank error: `No vehicle access within 800 m of this location`
  - ranking sub-line: `incl. {distance} on foot` (`formatSignalDistance`)
  - driver terminal: `Arrived at access point in {duration} · {distance} on foot`
- Contracts are regenerated, never hand-edited: `cd backend && uv run python scripts/export_openapi.py && cd ../frontend && npm run generate:types`.
- Tell the human before editing `GreenWave_ARCHITECTURE.md` (AGENTS.md).
- Checks: backend `uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`; frontend `npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`.

## Review Focus

1. A station whose own node is one of the access nodes: it must route to another access node, not fail with "zero-edge route" and not be dropped. Task 3 test `origin on an access node uses another`.
2. Access nodes exist, but none is reachable from a station (one-way island): that station is skipped; others still rank; if none rank → `NO_STATION_REACHABLE`. Task 4 test `unreachable access nodes skip the station`.
3. Ranking order versus displayed time: the order uses drive + walk, and the UI must show the same total so the list never looks unsorted. Task 4 test `orders by total` and Task 6 test `shows the total time`.
4. An incident exactly at the limit (on-foot distance == 800 m) is accepted; 800.01 m is rejected (inclusive, like the snap limit). Task 2 test `limit is inclusive`.
5. Comparison start with an off-road incident: both runs end at the same access node (same origin, same deterministic choice). Task 5 API test `comparison members share the access node`.

---

### Task 1: Settings, nearby nodes, and the park fixture

**Files:**
- Modify: `backend/src/greenwave/simulation_settings.py` (three fields after `max_snap_distance_meters`)
- Modify: `backend/src/greenwave/routing/network_index.py` (`RoutingIndex.nodes_within`)
- Modify: `backend/tests/support/route_fixtures.py` (`park_index`, `park_stations`, `PARK_CENTRE`)
- Test: `backend/tests/routing/test_network_index.py`

**Interfaces:**
- Produces:
  - `RoutingIndex.nodes_within(self, x_m: float, y_m: float, radius_m: float) -> tuple[tuple[str, float], ...]`: snap-set nodes with distance ≤ `radius_m`, sorted by `(distance, node_key)`.
  - `park_index() -> RoutingIndex`; `park_stations() -> pl.DataFrame`; `PARK_CENTRE: tuple[float, float] = (_X + 500, _Y + 400)` (metric x, y).

  Park fixture (all edges two-way; build each direction with `_builders`; speeds are tagged km/h):

  | Edge | From → to | Length | Speed |
  |---|---|---|---|
  | south road | `s-west` (_X, _Y) – `s-mid` (_X+500, _Y) – `s-east` (_X+1000, _Y) | 500 each | 30 |
  | north road | `n-west` (_X, _Y+900) – `n-mid` (_X+500, _Y+900) | 500 | 90 |
  | west link | `n-west` – `s-west` | 900 | 30 |
  | west depot road | `depot-w` (_X−3000, _Y+900) – `n-west` | 3000 | 90 |
  | east depot road | `depot-e` (_X+2000, _Y) – `s-east` | 1000 | 90 |

  Only `s-mid` (400 m) and `n-mid` (500 m) are within 800 / 1.3 ≈ 615 m of `PARK_CENTRE`. With default settings, `depot-w` is faster via `n-mid` (≈140 s + 464 s walk) than via `s-mid` (≈249 s + 371 s), and `depot-e` is faster via `s-mid`. `park_stations()` holds ambulances `STN-A-0001` at `depot-w` and `STN-A-0002` at `depot-e`.

- [ ] **Step 1: Write the failing tests:**
  - `test_settings_on_foot_defaults`: `SimulationSettings()` has `800`, `1.3`, `1.4`; extend the existing invalid-range parametrisation with `("max_on_foot_meters", 0)`, `("on_foot_detour_factor", 0.9)`, `("on_foot_speed_meters_per_second", 0)`.
  - `test_nodes_within_sorts_and_limits`: `park_index().nodes_within(*PARK_CENTRE, 615)` → keys `("s-mid", "n-mid")`, distances `≈ (400, 500)`; radius 399 → `()`.
- [ ] **Step 2: Run, expect FAIL.** `uv run pytest tests/routing/test_network_index.py -q`.
- [ ] **Step 3: Implement** the settings, `nodes_within` (`self._tree.query(Point(x, y), predicate="dwithin", distance=radius_m)`, then exact distances) and the fixture.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit**
  ```bash
  git add backend/src/greenwave/simulation_settings.py backend/src/greenwave/routing/network_index.py backend/tests/support/route_fixtures.py backend/tests/routing/test_network_index.py
  git commit -m "feat: find routable nodes within walking distance"
  ```

### Task 2: Access nodes and seeded Dijkstra

**Files:**
- Create: `backend/src/greenwave/routing/access.py`
- Test: `backend/tests/routing/test_access.py`

**Interfaces:**
- Consumes: `nodes_within`, settings (Task 1).
- Produces:
  ```python
  @dataclass(frozen=True, slots=True)
  class AccessNode:
      node_key: str
      straight_m: float
      on_foot_m: float        # straight_m * on_foot_detour_factor
      on_foot_seconds: float  # on_foot_m / on_foot_speed_meters_per_second

  def access_nodes(index: RoutingIndex, position: Position, settings: SimulationSettings) -> tuple[AccessNode, ...]
      # radius = max_on_foot_meters / on_foot_detour_factor; raises DestinationOffNetwork(<spec message>) when empty
  def seeded_lengths(graph: nx.MultiDiGraph, seeds: Mapping[str, float], weight: Callable[[str, str, Mapping[object, object]], float]) -> dict[str, float]
      # heapq Dijkstra; every seed starts at its value; same weight callback signature as networkx
  def best_access(lengths: Mapping[str, float], nodes: Sequence[AccessNode], exclude: str | None = None) -> AccessNode | None
      # argmin lengths[n] + n.on_foot_seconds over reachable, non-excluded nodes; ties by node_key
  ```

- [ ] **Step 1: Write the failing tests:**
  - `test_access_nodes_carry_walk_cost`: at `PARK_CENTRE`, `s-mid` has `straight_m ≈ 400`, `on_foot_m ≈ 520`, `on_foot_seconds ≈ 371.43`.
  - `test_limit_is_inclusive`: a position whose nearest node is exactly `800 / 1.3` m away is accepted; `+0.01` m raises `DestinationOffNetwork` with the message `Incident is farther than 800 m on foot from any vehicle access point`.
  - `test_seeded_lengths_equal_networkx_for_one_seed`: on `corridor_index()` reversed, `seeded_lengths(rev, {node: 0.0}, w) == nx.single_source_dijkstra_path_length(rev, node, weight=w)` for every node of the fixture.
  - `test_seeds_start_at_their_value`: seeds `{"a": 10.0}` → `lengths["a"] == 10.0`.
  - `test_best_access_prefers_total_and_skips_excluded_and_unreachable`.
- [ ] **Step 2: Run, expect FAIL.** `uv run pytest tests/routing/test_access.py -q`.
- [ ] **Step 3: Implement `access.py`.**
- [ ] **Step 4: Run, expect PASS;** `uv run mypy`.
- [ ] **Step 5: Commit**
  ```bash
  git add backend/src/greenwave/routing/access.py backend/tests/routing/test_access.py
  git commit -m "feat: choose incident access nodes by drive plus walk time"
  ```

### Task 3: `plan_route` falls back to an access node

**Files:**
- Modify: `backend/src/greenwave/routing/planner.py`
- Test: `backend/tests/routing/test_planner.py`

**Interfaces:**
- Consumes: `access_nodes`, `best_access`, `AccessNode` (Task 2).
- Produces: `PlannedRoute.on_foot: AccessNode | None = None` (last field, so the hand-built `PlannedRoute(...)` in `tests/simulation/*` stays valid). For an off-road destination, `destination_snap` is the access node, with `snap_distance_m = straight_m`.

- [ ] **Step 1: Write the failing tests:**
  - `test_off_road_destination_picks_fastest_total_not_nearest`: from `depot-w` to `position_at(*PARK_CENTRE)` → `destination_snap.node_key == "n-mid"`, `on_foot.straight_m ≈ 500`.
  - The same from `depot-e` → `"s-mid"`.
  - `test_origin_on_an_access_node_uses_another`: origin at `n-mid`'s position → `"s-mid"`.
  - `test_on_road_destination_has_no_on_foot_leg`: an existing corridor route has `on_foot is None`.
  - `test_off_road_origin_still_rejected`: origin at `PARK_CENTRE` → `OriginOffNetwork`.
- [ ] **Step 2: Run, expect FAIL.** `uv run pytest tests/routing/test_planner.py -q`.
- [ ] **Step 3: Implement.** Catch `DestinationOffNetwork` from `snap_endpoint(..., origin=False)` only. Get the nodes from `access_nodes`, compute forward lengths with `nx.single_source_dijkstra_path_length(index.graph, origin_node, weight=…)`, and choose with `best_access(lengths, nodes, exclude=origin_node)`. If that is `None`, raise `NoRoute("no vehicle access point is reachable")`. Build the snap from the node's `lat`/`lon`, then continue with today's path code.
- [ ] **Step 4: Run** `uv run pytest -q`. Expected: PASS, including every existing routing and simulation test.
- [ ] **Step 5: Commit**
  ```bash
  git add backend/src/greenwave/routing/planner.py backend/tests/routing/test_planner.py
  git commit -m "feat: route off-road incidents to the best access node"
  ```

### Task 4: Ranking by drive + walk

**Files:**
- Modify: `backend/src/greenwave/routing/station_ranking.py`
- Test: `backend/tests/routing/test_station_ranking.py`

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces: `RankedStation.on_foot: AccessNode | None = None`. Candidates are sorted by `(greenwave_seconds + (on_foot.on_foot_seconds if on_foot else 0), station_id)`. For an off-road incident, `StationRanking.incident_snap` is the first candidate's route `destination_snap` and `station_at_incident` is `None`.

- [ ] **Step 1: Write the failing tests** (`park_index`, `build_station_nodes(park_stations(), index)`):
  - `test_off_road_orders_by_total`: candidate IDs `["STN-A-0002", "STN-A-0001"]`; their `on_foot.node_key` are `"s-mid"` and `"n-mid"`; `incident_snap.node_key == "s-mid"`.
  - `test_off_road_matches_brute_force`: the winner equals the argmin over stations of `estimate_times(plan_route(...)).greenwave_seconds + route.on_foot.on_foot_seconds`.
  - `test_unreachable_access_nodes_skip_the_station`: add a node `trap` (_X+500, _Y−900) with a single one-way edge `s-mid → trap` and an ambulance `STN-A-0003` on it. It cannot leave, so it is absent from candidates. With only that station → `NoStationReachable`.
  - Every existing on-road ranking test is untouched and passes.
- [ ] **Step 2: Run, expect FAIL.** `uv run pytest tests/routing/test_station_ranking.py -q`.
- [ ] **Step 3: Implement.** Seeds: `{incident_snap.node_key: 0.0}` on-road; `{n.node_key: n.on_foot_seconds}` off-road. Replace `nx.single_source_dijkstra_path_length` with `seeded_lengths` on the reversed graph. Shortlist, per-station `plan_route` and `NoRoute` skips stay as they are.
- [ ] **Step 4: Run** `uv run pytest -q`. Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add backend/src/greenwave/routing/station_ranking.py backend/tests/routing/test_station_ranking.py
  git commit -m "feat: rank stations for off-road incidents by drive plus walk"
  ```

### Task 5: Contract and API

**Files:**
- Modify: `backend/src/greenwave/schemas/simulation.py` (`OnFootLeg`, `SimulationStartResponse.destination_on_foot`), `backend/src/greenwave/schemas/dispatch.py` (`RankedCandidate.on_foot`), `backend/src/greenwave/schemas/__init__.py` (export)
- Modify: `backend/src/greenwave/simulation/route_model.py:139-160` (map `route.on_foot`), `backend/src/greenwave/api/dispatch.py` (map `on_foot`; 422 message from the error), `backend/src/greenwave/api/simulation.py:70-73` (422 message from the error)
- Generated: `contracts/openapi.json`, `frontend/src/types/api.generated.ts`
- Modify: `frontend/src/lib/transport/validate.ts` (optional `on_foot` / `destination_on_foot`: absent, `null`, or a valid leg)
- Test: `backend/tests/schemas/test_dispatch_schemas.py`, `backend/tests/schemas/test_simulation_schemas.py`, `backend/tests/api/test_dispatch_api.py`, `backend/tests/api/test_simulation_api.py`, `frontend/src/lib/transport/validate.test.ts`

**Interfaces:**
- Produces: `OnFootLeg(access_point: Position, distance_m: float, seconds: float)`. Mapping: `access_point = route.destination_snap.position`, `distance_m = on_foot.on_foot_m`, `seconds = on_foot.on_foot_seconds`.

- [ ] **Step 1: Write the failing tests:**
  - Schemas: both new fields default to `None`; negative `distance_m` is rejected.
  - API: find an off-road point in the tiny dataset (Poprzeczna 7 moved north until `routing_index.snap` returns `None` while `access_nodes` is non-empty) and hard-code it, asserting that precondition through `app.state.routing_index` at the start of the test.
    - `test_rank_off_road_incident_returns_on_foot_leg`: 200, `candidates[0]["on_foot"]["distance_m"] > 0`, `incident_snapped.snap_distance_m > 150`.
    - `test_start_off_road_returns_destination_on_foot`.
    - `test_comparison_members_share_the_access_node`.
    - `test_rank_beyond_on_foot_limit_is_422`: the `{lat: 10, lng: 10}` request now carries the spec message.
  - Frontend: `parseStartResponse` accepts a missing, `null` or valid `destination_on_foot` and rejects `distance_m: -1`; the same for the rank candidates' `on_foot`.
- [ ] **Step 2: Run, expect FAIL.** `uv run pytest tests/schemas tests/api -q`; `cd frontend && npx vitest run src/lib/transport`.
- [ ] **Step 3: Implement**, then regenerate the contracts (Global Constraints command).
- [ ] **Step 4: Run** both full check suites. Expected: PASS, and `git diff --stat contracts/ frontend/src/types/` shows only the generated additions.
- [ ] **Step 5: Commit**
  ```bash
  git add backend/src/greenwave/schemas backend/src/greenwave/simulation/route_model.py backend/src/greenwave/api/dispatch.py backend/src/greenwave/api/simulation.py backend/tests/schemas backend/tests/api contracts/openapi.json frontend/src/types/api.generated.ts frontend/src/lib/transport
  git commit -m "feat: report the on-foot leg for off-road incidents"
  ```

### Task 6: Frontend presentation

**Files:**
- Modify: `frontend/src/components/hud/dispatch/StationRanking.tsx` (total time, sub-line, deltas on totals)
- Modify: `frontend/src/components/map/snap-connectors.ts` (`properties.onFoot: boolean`), `frontend/src/components/map/EndpointMarkers.tsx` (second line layer filtered on `onFoot`: dotted `[0.5, 2]`, width 2.5, colour `mapPalette(theme).onFootLine`), `frontend/src/components/map/map-palette.ts` (`onFootLine` = the `--beacon` value per theme)
- Modify: `frontend/src/components/driver/DriverStatus.tsx:40` (terminal copy), `frontend/src/lib/useIncidentDispatch.ts` (`RANK_ERROR_COPY.DESTINATION_OFF_NETWORK`)
- Test: `StationRanking.test.tsx`, `snap-connectors.test.ts`, `map-palette.test.ts`, `driver-status.test.tsx`, `useIncidentDispatch.test.ts`

**Interfaces:**
- Consumes: generated `OnFootLeg`; P5's selectable `StationRanking`.
- Produces: `export function candidateTotalSeconds(candidate: RankedCandidate): number` in `frontend/src/lib/station-choice.ts` (used for the shown time and the deltas).

- [ ] **Step 1: Write the failing tests:**
  - `shows the total time`: candidate `greenwave_seconds: 140, on_foot: {distance_m: 650, seconds: 464}` → shows `10:04` and `incl. 650 m on foot`.
  - Deltas use totals.
  - `snapConnectorFeatures` marks the destination `onFoot: true` only when `destination_on_foot` is set.
  - The palette has `onFootLine` in both themes.
  - The driver terminal copy is `Arrived at access point in … · 650 m on foot` with a leg, and unchanged without one.
  - `describeRankError` for `DESTINATION_OFF_NETWORK` → `No vehicle access within 800 m of this location`.
- [ ] **Step 2: Run, expect FAIL.** `npx vitest run`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the frontend checks.** Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src
  git commit -m "feat: show the on-foot leg in ranking, map and driver mode"
  ```
  (Stage the exact files listed above, not the directory, if anything else is dirty.)

### Task 7: Records, then browser verification

**Files:**
- Create: `docs/adr/0009-on-foot-incident-access.md` (from `0001-template.md`, status `Proposed`)
- Modify (after telling the human and getting an OK): `GreenWave_ARCHITECTURE.md` (invariant 10, the dispatch section around line 236, the error table at line 368)

- [ ] **Step 1:** Write the ADR: context (Błonia measurement from spec C), decision (spec D bullets), consequences (straight-line walk ignores barriers; estimates and `time_saved` exclude the walk).
- [ ] **Step 2: Human checkpoint.** Tell the human which three places in `GreenWave_ARCHITECTURE.md` will change, and wait. Then edit.
- [ ] **Step 3: Browser verification** with the backend on rebuilt P7 data and `npm run dev`, using the `playwright-cli` skill (artefacts in `.tmp/playwright/p8/`):
  - Green Wave at 1440×900: pin Błonia centre (50.0597, 19.9090) → the ranking shows `incl. … on foot` and is sorted by the shown time. Initialize → the route ends at the edge of Błonia, with a dotted beacon line to the incident.
  - Pick the second station (P5) → its own access point may differ.
  - Comparison → both panes end at the same access node.
  - Driver at 390×844 → the terminal line shows the on-foot copy.
  - A point 2 km into Las Wolski's interior → `No vehicle access within 800 m of this location`.
  Look at every screenshot.
- [ ] **Step 4:** Run the full backend and frontend checks; commit the ADR and the architecture edits:
  ```bash
  git add docs/adr/0009-on-foot-incident-access.md GreenWave_ARCHITECTURE.md
  git commit -m "docs: record on-foot access to off-road incidents"
  ```
  Report the milestone and verify every spec D bullet against the result.
