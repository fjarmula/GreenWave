# Phase 2 · Backend — Simulation Engine, Routing and Streaming API (Piotr)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Expand each task with superpowers:writing-plans before coding if a step leaves a choice open.

**Owner:** Piotr Lorek · **Branch:** `feature/simulation-engine` from tag `contract-v1` · **Worktree:** own worktree, never shared.

**Goal:** Replace the three HTTP 501 stubs from Phase 0 with a real, deterministic simulation: snap → route → estimates → 1 Hz engine (TTI, state machine, cascade, ITS mock) → SSE stream, using only the validated `ProcessedDataset`.

**Architecture:** Three layers with one-way dependencies — `routing/` (pure, built once at startup from the dataset), `simulation/` (pure step function + an asyncio session manager), `api/` (thin FastAPI adapter: validation, error mapping, SSE framing). Domain code never imports FastAPI (`.agents/INSTRUCTIONS_REFERENCE.md` §5.1). The engine is a pure `step(state) -> (state, events)` driven by an injectable clock, so every timing rule is unit-testable without sleeping.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, NetworkX (frozen `MultiDiGraph`), Shapely 2 (`STRtree`, `line_interpolate_point`), GeoPandas/pyproj via the existing `greenwave.etl.geo` helpers, pytest + pytest-asyncio, `httpx2` for API tests.

**Spec:** `GreenWave_ARCHITECTURE.md` §3–§6 + `docs/adr/0003-simulation-contract-v1.md` + `docs/superpowers/plans/2026-10-16-phase2-00-contract-freeze-and-coordination.md` (decisions D2–D23).

## Global Constraints

- You write **only** `backend/**` excluding `backend/src/greenwave/schemas/**`. Schemas, `contracts/openapi.json`, `graphify-out/`, root docs are frozen (coordination doc §4). Need a schema change → coordination doc §5.
- Never `git add graphify-out`. Run `graphify update .` locally whenever navigation needs it.
- Distances in EPSG:2178 metres only; WGS84 only at the API boundary. Reuse `greenwave.etl.geo.project_points` / `unproject_points`; do not add a second CRS path.
- Thresholds: `CLEARING` at TTI ≤ 40 s, `PRIORITY_GREEN` at TTI ≤ 25 s, `RECOVERY` at d ≤ 0 m past the **last** controlled stop line, `NORMAL` 15 s later. `D_min = 3 s`. `V_ambulance(e) = min(max(1.3·V_e, 30), 90)` km/h. EMA α = 0.25, floor 5.0 m/s. Cascade threshold: read `dataset.cascade_threshold_m` (250.0, inclusive) — **do not** re-declare 250. `D_u`: read `intersections.delay_seconds` per intersection — **do not** hard-code 35.
- `D_u`/`D_min` applied once per unique `INT-xxxx` whose controlled approach the route passes; never sum `signal_approaches.delay_seconds` (ProcessedDataset docstring).
- `approach_neighbours` is a candidate set only; cascade decisions use along-route stop-line distance on the actual route.
- All tunables in one `SimulationSettings` (pydantic-settings, env prefix `GREENWAVE_SIM_`), with unit suffixes (`_seconds`, `_meters`, `_kmh`) and range validation.
- No new runtime dependency without asking. `sse-starlette` is **not** needed: a `StreamingResponse` with `media_type="text/event-stream"` and hand-framed lines is enough (D3).
- Simulated only: no outbound network calls, no controller protocols; the ITS gateway is in-memory.

## Review Focus

1. **Origin/destination on a one-way dead end or a disconnected island** — must return `NO_ROUTE`/`*_OFF_NETWORK` (D7, D12), never a 500 and never a fabricated route. → Task B2 tests.
2. **A route passing two approaches of one intersection** — pays `D_u`/`D_min` once, dwells once, `RECOVERY` only after the last stop line. → Task B3 and B5 tests.
3. **Cascade boundary** — 250.0 m along the route cascades, 250.01 m does not; an intersection *behind* the trigger never cascades; with `enable_cascade_mode=false` nothing cascades. → Task B3 and B5 tests.
4. **A client that disconnects or reads slowly** — must not block or slow the tick loop for anyone else (bounded per-subscriber queue, drop-oldest). → Task B6 tests.
5. **A second `start` while a run is active** — the first run's subscribers get `SIMULATION_CANCELLED{reason: SUPERSEDED}` and their stream closes; no task or queue leaks. → Task B6 tests.

---

## File structure (all new unless marked)

```
backend/src/greenwave/
  simulation_settings.py        SimulationSettings (all tunables, validated)
  routing/
    __init__.py
    network_index.py            RoutingIndex: built once from ProcessedDataset
    planner.py                  snap + shortest path + polyline + stop-line events
    estimates.py                T_normal / T_greenwave (pure)
    errors.py                   OriginOffNetwork, DestinationOffNetwork, NoRoute
  simulation/
    __init__.py
    route_model.py              RouteModel: intersections in route order, cascade adjacency
    state_machine.py            per-intersection transitions (pure)
    engine.py                   EngineState + step() (pure, deterministic)
    session.py                  SessionManager (asyncio, single active run, fan-out)
  its/
    __init__.py
    gateway.py                  ItsGateway Protocol + MockItsGateway
  api/
    simulation.py   (MODIFY)    replace 501 stubs; error mapping
    sse.py                      event -> SSE text frame
  main.py           (MODIFY)    lifespan builds RoutingIndex + SessionManager; CORS
backend/tests/
  support/route_fixtures.py     hand-built small graphs + RouteModels with exact distances
  routing/  simulation/  its/  api/
```

---

### Task B1: Settings and RoutingIndex (startup build)

**Files:** Create `simulation_settings.py`, `routing/network_index.py`, `routing/errors.py`; Test `tests/routing/test_network_index.py`.

**Interfaces:**
- Consumes: `ProcessedDataset` (`greenwave.dataset`).
- Produces: `SimulationSettings` fields — `clearing_tti_seconds=40`, `priority_green_tti_seconds=25`, `recovery_hold_seconds=15`, `min_intersection_delay_seconds=3`, `ambulance_speed_factor=1.3`, `ambulance_min_speed_kmh=30`, `ambulance_max_speed_kmh=90`, `speed_ema_alpha=0.25`, `speed_floor_meters_per_second=5.0`, `its_min_hold_seconds=40`, `its_hold_buffer_seconds=5` (D17: `hold_duration_sec = max(its_min_hold_seconds, ceil(TTI at dispatch) + its_hold_buffer_seconds)`, group uses its largest TTI), `tick_interval_seconds=1.0`, `max_snap_distance_meters=150` (D12), `max_playback_speed=10` (D9), `subscriber_queue_size` (choose small, e.g. 32, and state it in the PR). `build_routing_index(dataset, settings) -> RoutingIndex` exposing: `snap(x_m, y_m) -> tuple[node_key, distance_m] | None`, `edge(edge_id) -> EdgeView`, `approaches_on_edge(edge_id) -> tuple[ApproachRef, ...]`, `intersection(intersection_id) -> IntersectionInfo` (id, name|None, kind, lon, lat, delay_seconds).

- [ ] Tests first: settings reject `priority_green_tti_seconds > clearing_tti_seconds`, negative values, alpha outside (0,1]; index built from the existing `tiny_dataset` fixture: every approach edge resolves, both intersections resolve with coordinates from `intersection_ids`, snapping a point 1 m from a node returns that node, a point farther than `max_snap_distance_meters` returns `None`.
- [ ] Implement. `STRtree` over node points (`x_m`, `y_m`) for snapping. Edge lookups keyed by `edge_id` (the graph's edge key). Build is O(nodes + edges) once; nothing here runs per tick.
- [ ] Measure the build time on real data once (`scripts/benchmark.py` already exists — extend or reuse it) and write the number in the PR. Do not invent a budget.

### Task B2: Planner — snap, route, polyline

**Files:** Create `routing/planner.py`; Create `tests/support/route_fixtures.py`; Test `tests/routing/test_planner.py`.

**Interfaces:**
- Produces: `plan_route(index, origin: Position, destination: Position, settings) -> PlannedRoute`, where `PlannedRoute` holds `edge_ids: tuple[str, ...]`, `edge_lengths_m`, `edge_speeds_kmh`, `cumulative_m` (start offset of each edge), `total_distance_m`, `polyline_wgs84: list[(lng, lat)]`, `origin_snap`, `destination_snap`, `stop_lines: tuple[StopLineEvent, ...]` (`intersection_id`, `edge_id`, `distance_along_route_m` = end of the controlled edge). Raises `OriginOffNetwork`, `DestinationOffNetwork`, `NoRoute`.

- [ ] Fixture `route_fixtures.py`: a hand-built `MultiDiGraph` (no ETL) with a straight corridor whose controlled stop lines sit at known distances (include one pair exactly 250.0 m apart, one 250.01 m, one intersection controlled on two consecutive route edges, one one-way edge, one disconnected node). Reused by B3–B6.
- [ ] Tests: weight is `length_m / V_ambulance(speed_kmh)` (D11) — construct a case where shortest-by-length ≠ fastest and assert the fastest wins; snapping to the disconnected node → `NoRoute`; snap beyond 150 m → `OriginOffNetwork`/`DestinationOffNetwork`; same origin and destination node → define behaviour explicitly (recommend `NoRoute` with a clear message; ask Filip only if you choose otherwise); polyline starts at the snapped origin and is contiguous (no duplicate joint vertices); `stop_lines` ordered by distance.
- [ ] Implement with `nx.shortest_path(..., weight=callable)` on the frozen graph (MultiDiGraph: pick the min-weight parallel edge and remember its `edge_id`). Edge geometries are EPSG:2178 → concatenate, then `unproject_points` once per route.
- [ ] Real-data check (manual, not in CI): every preset pair in `frontend/src/components/map/dispatch-endpoints.ts` (read-only for you) plans successfully; record snap distances and planning time in the PR. If a preset fails, tell Filip which one and why — he owns that file.

### Task B3: RouteModel and estimates

**Files:** Create `routing/estimates.py`, `simulation/route_model.py`; Tests `tests/routing/test_estimates.py`, `tests/simulation/test_route_model.py`.

**Interfaces:**
- Produces: `estimate_times(route, route_model, multiplier, settings) -> Estimates(normal_seconds, greenwave_seconds)`; `build_route_model(route, index, settings, cascade_enabled) -> RouteModel` with `intersections: tuple[RouteIntersection, ...]` in route order (`id`, `first_stop_line_m`, `last_stop_line_m`, `delay_seconds`) and `cascade_targets(intersection_id) -> tuple[str, ...]` (only those **ahead**, along-route distance between stop lines ≤ `dataset.cascade_threshold_m`, inclusive; empty when cascade disabled).

- [ ] Tests (exact arithmetic on the fixture): `T_normal = Σ L_e·μ / (V_e/3.6) + Σ D_u` and `T_greenwave = Σ L_e / (V_amb(e)/3.6) + Σ D_min` (architecture §3); μ = 1.0 and 3.0 boundaries; an intersection on two route edges counts once; cascade 250.0 in / 250.01 out; disabled → empty.
- [ ] Decide and document which stop-line pair defines "distance between j and i" when an intersection has two stop lines on the route — recommend j's **first** to i's **first** (the moment j enters `CLEARING` is governed by its first stop line). Put it in the docstring.
- [ ] Response mapping helper: `RouteModel` + `PlannedRoute` → `SimulationStartResponse` (incl. D4 `route_intersections` with WGS84 positions from `intersection_ids` lon/lat).

### Task B4: Intersection state machine (pure)

**Files:** Create `simulation/state_machine.py`; Test `tests/simulation/test_state_machine.py`.

**Interfaces:**
- Produces: `IntersectionRuntime` (state, is_cascade, recovery_started_at_s, passed) and `advance_intersection(runtime, tti_s: float | None, remaining_to_last_m: float, now_s: float, cascade_trigger: bool, settings) -> tuple[IntersectionRuntime, Transition | None]`.

- [ ] Tests at every boundary: TTI 40.0 → `CLEARING` (`is_cascade=false`), 40.01 → stays `NORMAL`; 25.0 → `PRIORITY_GREEN`, 25.01 stays `CLEARING`; cascade trigger moves `NORMAL→CLEARING` with `is_cascade=true` and keeps that flag through later states (the engine, not the state machine, only raises `cascade_trigger` from own-TTI `CLEARING` entries — D16 one-hop); remaining ≤ 0 → `RECOVERY` from `PRIORITY_GREEN` **and** from `CLEARING`/`NORMAL` if the vehicle passed faster than a tick (explicitly allowed skip — write it down, architecture is silent; otherwise an intersection could stay `CLEARING` forever); `RECOVERY→NORMAL` exactly at +15.0 s; no transition out of terminal `NORMAL` after pass (passed intersections never re-enter `CLEARING`); illegal transitions impossible by construction.
- [ ] Implement as a function over an enum; no I/O, no clock reads.

### Task B5: Engine step (pure, deterministic)

**Files:** Create `simulation/engine.py`; Test `tests/simulation/test_engine.py`.

**Interfaces:**
- Consumes: `RouteModel`, `PlannedRoute`, `Estimates`, `SimulationSettings`, an `ItsGateway` (B6-its).
- Produces: `EngineState` (sim time, distance travelled, current edge index, dwell remaining, `v_avg`, per-intersection runtimes, tick number, completed flag) and `step(state, wall_clock_utc) -> tuple[EngineState, list[SimulationStreamEvent]]` advancing exactly 1 simulated second; `run_tick(state, wall_clock_utc, playback_speed)` calls `step` `playback_speed` times and returns the **last** tick event plus every ITS/terminal event in order (D9).

- [ ] Tests: kinematics per D13 (advance at `V_amb` of current edge, carry over edge boundaries, 3 s dwell at each intersection's first stop line, speed 0 while dwelling); total simulated arrival time within ±(number of intersections) s of `T_greenwave`; EMA per architecture with floor; TTI = remaining distance to first stop line / `v_avg`, rounded int in the event, `null` once passed (D5); ambulance status per D14; KPI per D15 — ends at `T_normal − T_greenwave` ±1; cascade one-hop per **D16** (an own-TTI `CLEARING` cascades to targets ≤ 250 m ahead; a cascade-triggered `CLEARING` does **not** cascade further — assert a three-intersection chain A→B→C where C is ≤ 250 m from B but > 250 m from A stays `NORMAL` until its own TTI ≤ 40; same-tick tie: own TTI wins, `is_cascade=false`); ITS batching per D18 (exactly one `ITS_DISPATCH` per tick that has new `CLEARING`s, group contents, `hold_duration_sec = max(40, ceil(largest TTI in group) + 5)` per D17 — include a cascaded group whose hold exceeds 40, message ids increment); after `ARRIVED`, ticks continue until all `NORMAL`, then exactly one `SIMULATION_COMPLETED` (D19); `playback_speed=10` produces identical final state to ten `step` calls (no threshold skipped).
- [ ] **Determinism test:** same inputs → byte-identical event JSON sequence (excluding `timestamp`, which comes from the injected clock — inject a fixed one and then it is identical too). `.agents/SIMULATION_ENGINE.md` requires deterministic replay.
- [ ] Every emitted event is constructed as the Phase 0 Pydantic model (so serialization is the contract by construction) with `is_simulated=True`.

### Task B6: ITS gateway and session manager (asyncio)

**Files:** Create `its/gateway.py`, `simulation/session.py`; Tests `tests/its/test_gateway.py`, `tests/simulation/test_session.py`.

**Interfaces:**
- Produces: `class ItsGateway(Protocol): def dispatch(self, payload: ItsDispatchPayload) -> None`; `MockItsGateway` keeps the last N records in memory and logs one structured line per dispatch (no network). `SessionManager(index, settings, gateway, clock, sleep)` with `async start(request) -> SimulationStartResponse`, `subscribe(simulation_id) -> AsyncIterator[SimulationStreamEvent]`, `async stop(simulation_id) -> StopResponse`, `async shutdown()`.

- [ ] Tests (fake clock + fake `sleep`, no real waiting): one active run — a second `start` cancels the first and the first's subscribers receive `SIMULATION_CANCELLED{SUPERSEDED}` then end; same `simulation_id` while active → `SIMULATION_ID_IN_USE`; `stop` → `SIMULATION_CANCELLED{STOPPED}`; unknown id → not-found error; a subscriber that never reads does not delay other subscribers or the tick count (queue bounded, drop-oldest — terminal events must **never** be dropped: if the queue is full, drop a tick to make room); subscribe after completion yields the terminal event once and ends (D19); new subscriber first receives the latest snapshot (D19); `shutdown()` cancels the loop task and leaves no pending tasks.
- [ ] Loop: one `asyncio.Task` per run; per iteration call `engine.run_tick`, publish, then sleep until the next tick boundary (compensate for work time; if a deadline is missed, log it with the overrun ms and do **not** catch up with a burst — `.agents/INSTRUCTIONS_REFERENCE.md` §6.2 asks you to define this; this is the definition, record it in the docstring).
- [ ] Route planning (B2) is CPU-bound: call it via `asyncio.to_thread` in `start` so it never blocks a running tick loop. Measure it.

### Task B7: API wiring, SSE framing, CORS

**Files:** Modify `api/simulation.py`, `main.py`; Create `api/sse.py`; Tests `tests/api/test_simulation_api.py`, `tests/api/test_sse.py`.

**Interfaces:**
- Consumes: everything above. Produces: the three endpoints behaving exactly as the Phase 0 OpenAPI says.

- [ ] Lifespan: after `load_dataset`, `build_routing_index`, create `MockItsGateway` and `SessionManager`, store on `app.state`; on shutdown `await manager.shutdown()`. `create_app(dataset=...)` test injection must keep working (existing `tests/dataset/test_app_startup.py` must stay green).
- [ ] CORS per D21 from a settings field (`GREENWAVE_CORS_ORIGINS`), methods `GET, POST`, no credentials. Test: allowed origin gets the header, other origin does not.
- [ ] Error mapping per D7 — domain exceptions → `ErrorResponse` with the right status; no stack traces or file paths in bodies (`.agents/INSTRUCTIONS_REFERENCE.md` §8.3).
- [ ] SSE: `event: <event_type>\nid: <tick>\ndata: <model_dump_json()>\n\n`, first frame `retry: 2000`. Headers `Cache-Control: no-cache`, `X-Accel-Buffering: no`. Detect client disconnect (`request.is_disconnected()`) and unsubscribe.
- [ ] API tests on the tiny dataset (+ B2 fixture graph injected where tiny is too small): start → 200 with D4 fields; stream yields tick events whose JSON validates against `SimulationStreamEvent`; stop → stream ends with `SIMULATION_CANCELLED`; 404/409/422 bodies validate as `ErrorResponse`; multiplier 3.01 → 422.
- [ ] Confirm `uv run python scripts/export_openapi.py` produces **no diff** to `contracts/openapi.json`. If it does, you changed the contract — revert and use coordination doc §5.

### Task B8: Branch finish

- [ ] Full backend checks (`AGENTS.md`). Coverage of `simulation/` and `routing/` should be near-complete because they are pure — state the number.
- [ ] Manual real-data run: start with a preset pair, `curl -N` the stream for one full run at `playback_speed=10`, save the transcript under `.tmp/` (not committed), skim for: monotonic tick ids, states only in the 4-value set, at least one cascade (if `enable_cascade_mode`), `SIMULATION_COMPLETED` at the end.
- [ ] Record in the PR description: startup time, route planning time, tick duration p50/max, observed snap distances for presets (Phase 3 needs them).
- [ ] `git diff --name-only contract-v1...HEAD` — every path under `backend/` and not under `backend/src/greenwave/schemas/`, plus your own plan file.
- [ ] Update `backend/README.md` (yours) with the new env vars. Root `README.md` waits for Phase 3.
- [ ] PR → `main` with merge commit (not squash). Merge **before** the frontend PR (coordination doc §6).

## What you hand to Filip during the branch (no file sharing — messages only)

- As soon as B2 runs on real data: the list of preset endpoints that do/don't snap, and the real snap distances.
- As soon as B7 works locally: "backend runnable" + the exact env (`GREENWAVE_CORS_ORIGINS`) so he can smoke-test his adapter against your branch locally **without merging** (he runs your worktree's server; no code crosses branches).
- Any contract surprise → coordination doc §5 immediately, not at merge time.
