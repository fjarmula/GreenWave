# Refactor: Simulation Core (M1 engine, M2 session) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `SimulationEngine` and `SessionManager` into single-responsibility units with byte-identical simulation output.

**Architecture:** `SimulationEngine` stays the façade (same constructor and `initial_state`/`step`/`run_tick`) and delegates to pure modules: route track (geometry/edge lookup), motion (D13 move), corridor (signal advance + cascade), dispatch (ITS payload), telemetry (tick/KPI/completed events). `SessionManager` keeps lifecycle/locking; engine assembly moves to an injectable planner and the subscriber drop policy to its own module.

**Tech Stack:** Python 3.12, Pydantic v2, pytest/pytest-asyncio, ruff, mypy (strict as configured).

**Spec:** `docs/superpowers/specs/2026-10-17-clean-code-solid-refactor-design.md` (sections M1, M2, Constraints).

Plans for M3–M4 (ETL), M5 (frontend), M6 (scripts) are written when their milestone starts, against the code as it then stands.

## Global Constraints

- No behaviour, timing, or numeric change in simulation output, REST/SSE payloads.
- No Pydantic schema changes → `contracts/openapi.json` and `api.generated.ts` must not change.
- No new dependencies, frameworks, DI containers, or abstract base classes "for the future".
- Existing tests are the behaviour spec. Changing an assertion requires human approval; setup-only edits (fixtures, how a fake is injected) are allowed and must be called out in the milestone summary.
- `SimulationEngine.__init__(simulation_id, route, route_model, estimates, traffic_density_multiplier, settings, gateway)` signature unchanged; gateway called inline per step.
- Public names stay importable: `greenwave.simulation.{EngineState, SimulationEngine, SimulationEvent, IntersectionRuntime, Transition, advance_intersection}`, `greenwave.simulation.engine.{EngineState, SimulationEngine}`, `greenwave.simulation.session.{SessionManager, SimulationIdInUseError, SimulationNotFoundError}`.
- Performance claims need before/after numbers; drop a perf change whose gain is negligible.
- Branch `refactor/clean-code`; one commit per milestone after checks are green, message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Checks (from `backend/`): `uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`.

## Review Focus

- Playback speed > 1 with a dispatch mid-batch: dispatch events keep their per-step tick and message sequence, the gateway is called once per dispatch, only the last tick is retained. → golden scenario `cascade_x5` (Task 1).
- Cascade off vs on on the same route: identical motion, different dispatch groups. → golden scenarios `no_cascade_x1` and `cascade_x1` (Task 1).
- Distance exactly on an edge boundary and zero-length edges in edge lookup. → `test_edge_at_matches_linear_scan_on_boundaries` (Task 2).
- Terminal event when a subscriber queue is full of a terminal already (stop after completion race). → `test_offer_keeps_existing_terminal_and_drops_a_tick` (Task 7).
- Planner failure on replacement must leave the active session untouched (existing `test_failed_replacement_keeps_active_session`, re-wired in Task 8).

---

## Milestone M1: Simulation engine

### Task 1: Golden characterization of the engine event stream

**Files:**
- Create: `backend/tests/simulation/test_engine_golden.py`
- Create: `backend/tests/simulation/golden/engine_events.json` (generated once, committed)

**Interfaces:**
- Consumes: `tests.support.route_fixtures.corridor_index`, `position_at`; `plan_route`, `build_route_model`, `estimate_times`, `SimulationEngine`, `MockItsGateway`.
- Produces: golden file every later task must keep green.

- [ ] **Step 1: Write the test.** Scenarios (name → origin x, destination x, cascade, density, playback): `no_cascade_x1` (1_000→1_850.02 offset from `_X`=7_421_000, False, 1.5, 1), `cascade_x1` (same, True, 1.5, 1), `cascade_x5` (same, True, 2.0, 5). For each: build engine with fixed `simulation_id=f"SIM-{name}"`, a recording gateway (list of `payload.model_dump(mode="json")`), clock fixed at `datetime(2026, 10, 17, tzinfo=UTC)`; loop `run_tick` until `state.completed` (hard cap 10_000 iterations → `pytest.fail`). Record `{"events": [e.model_dump(mode="json") for all events], "dispatched": [...], "final_state": dataclasses.asdict(state)}` (enums via `str`). Test `test_engine_event_stream_matches_golden` compares to the JSON file. When env `GREENWAVE_REGEN_GOLDEN=1`, write the file instead and `pytest.skip("golden regenerated")`.
- [ ] **Step 2: Generate on the unmodified engine.** Run: `GREENWAVE_REGEN_GOLDEN=1 uv run pytest tests/simulation/test_engine_golden.py` → skipped; then `uv run pytest tests/simulation/test_engine_golden.py -v` → PASS. Check the file contains at least one `ITS_DISPATCH` with `intersections_group` length ≥ 2 in `cascade_x1` (else pick destination/density so the cascade fires and regenerate).
- [ ] **Step 3: Record baseline timing** of 1_000 `step` calls on `cascade_x1` with `timeit` in a throwaway script under the scratchpad (not committed); keep the number for Task 2.

### Task 2: `RouteTrack` — route geometry and edge lookup

**Files:**
- Create: `backend/src/greenwave/simulation/route_track.py`
- Test: `backend/tests/simulation/test_route_track.py`
- Modify: `backend/src/greenwave/simulation/engine.py` (remove `_polyline_offsets_m`, `_point_along`, `_edge_at`, `_speed`)

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True, slots=True) class RouteTrack` with `from_route(route: PlannedRoute, settings: SimulationSettings) -> RouteTrack` (classmethod).
  - `edge_at(distance_m: float) -> int` — same result as today's linear `_edge_at` (first `i` with `distance < cumulative[i] + length[i]`, else last index), implemented with `bisect_right` on precomputed `edge_ends_m`.
  - `edge_end_m(index: int) -> float`, `speed_mps(index: int) -> float` (precomputed `ambulance_speed_kmh(...) / 3.6`), `total_distance_m: float`.
  - `position_at(distance_m: float) -> Position` (moves `_polyline_offsets_m` + `_point_along`; fraction = distance / total).

- [ ] **Step 1: Failing tests:** `test_edge_at_matches_linear_scan_on_boundaries` — route lengths `(10.0, 0.0, 5.0, 20.0)`; for distances `[0, 9.999, 10, 10.0001, 15, 34.999, 35, 50]` assert `track.edge_at(d) == linear(d)` where `linear` is today's expression copied into the test. `test_position_at_clamps_to_ends` — `position_at(-1)` equals first vertex, `position_at(total+1)` equals last. `test_speed_mps_applies_ambulance_speed` — equals `ambulance_speed_kmh(36.0, settings)/3.6`.
- [ ] **Step 2:** `uv run pytest tests/simulation/test_route_track.py -v` → FAIL (module missing).
- [ ] **Step 3:** Implement; engine builds `self._track = RouteTrack.from_route(route, settings)` in `__init__` and uses it everywhere.
- [ ] **Step 4:** `uv run pytest tests/simulation -v` → all PASS incl. golden. Re-run Task 1 Step 3 timing; note before/after. If no measurable gain, keep `bisect` only if the code is no less clear (it is a one-liner), and say so in the summary.

### Task 3: Corridor — intersection advance with one shared helper

**Files:**
- Create: `backend/src/greenwave/simulation/corridor.py`
- Create: `backend/src/greenwave/simulation/state.py` (move `EngineState` here; `engine.py` re-imports it so `greenwave.simulation.engine.EngineState` still works)
- Test: `backend/tests/simulation/test_corridor.py`
- Modify: `backend/src/greenwave/simulation/engine.py`

**Interfaces:**
- Produces:
  - `ACTIVE_STATES: frozenset[IntersectionState] = frozenset({CLEARING, PRIORITY_GREEN})` (used by telemetry in Task 5).
  - `time_to_intersection(stop_line_m: float, runtime: IntersectionRuntime, state: EngineState) -> float | None` (today's `_tti`).
  - `@dataclass(frozen=True, slots=True) class CorridorAdvance: runtimes: tuple[IntersectionRuntime, ...]; entered_clearing: tuple[str, ...]`.
  - `advance_corridor(route_model: RouteModel, state: EngineState, settings: SimulationSettings) -> CorridorAdvance` — own pass then one-hop cascade pass, both via private `_advance_one(item, runtime, state, cascade_trigger, settings) -> tuple[IntersectionRuntime, Transition | None]`; `entered_clearing` order identical to today (own in route order, then cascade targets in source/target order).

- [ ] **Step 1: Failing tests:** `test_cascade_target_enters_clearing_after_its_source` — two intersections 100 m apart, cascade target mapping `{"A": ("B",)}`, state with ambulance so A's TTI ≤ `clearing_tti_seconds` and B's > it: `entered_clearing == ("A", "B")`, B `is_cascade`. `test_no_cascade_without_targets` — same with empty mapping: `("A",)`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement, engine calls `advance_corridor`. **Step 4:** `uv run pytest tests/simulation -v` → PASS incl. golden.

### Task 4: Dispatch — pure payload and event builders

**Files:**
- Create: `backend/src/greenwave/simulation/dispatch.py`
- Test: `backend/tests/simulation/test_dispatch.py`
- Modify: `backend/src/greenwave/simulation/engine.py`

**Interfaces:**
- Consumes: `time_to_intersection` (Task 3).
- Produces:
  - `build_dispatch_payload(route_model: RouteModel, state: EngineState, intersection_ids: tuple[str, ...], now: datetime, settings: SimulationSettings) -> ItsDispatchPayload` (hold = `max(its_min_hold_seconds, ceil(max(ttis)) + its_hold_buffer_seconds)`, arrival = `now + min(ttis)`, passed → TTI 0.0, as today).
  - `dispatch_event(simulation_id: str, state: EngineState, payload: ItsDispatchPayload, now: datetime) -> ItsDispatchEvent` (`message_id=f"MSG-ITS-{state.message_sequence}"`; caller passes the already-incremented state).
  - Engine `_dispatch` becomes: payload → `self.gateway.dispatch(payload)` → `replace(message_sequence+1)` → `dispatch_event`.

- [ ] **Step 1: Failing test** `test_payload_holds_until_last_member_plus_buffer` — two ids with TTIs 4.2 s and 9.1 s, default settings: `hold_duration_sec == max(settings.its_min_hold_seconds, 10 + settings.its_hold_buffer_seconds)`, `expected_arrival_utc == now + timedelta(seconds=4.2)`, `intersections_group` order preserved. `test_dispatch_builders_do_not_touch_the_gateway` — module imports no `ItsGateway` (assert `"ItsGateway" not in dispatch.__dict__`).
- [ ] **Steps 2–4:** FAIL → implement → `uv run pytest tests/simulation -v` PASS incl. golden.

### Task 5: Telemetry — tick, KPI and completion projection

**Files:**
- Create: `backend/src/greenwave/simulation/telemetry.py`
- Test: `backend/tests/simulation/test_telemetry.py`
- Modify: `backend/src/greenwave/simulation/engine.py`

**Interfaces:**
- Consumes: `RouteTrack` (Task 2), `ACTIVE_STATES`, `time_to_intersection` (Task 3).
- Produces:
  - `ambulance_telemetry(simulation_id: str, state: EngineState, speed_mps: float, track: RouteTrack) -> AmbulanceTelemetry`
  - `intersection_telemetry(route_model: RouteModel, state: EngineState) -> list[IntersectionTelemetry]`
  - `kpi_metrics(route: PlannedRoute, route_model: RouteModel, state: EngineState, traffic_density_multiplier: float) -> KpiMetrics`
  - `tick_event(simulation_id: str, state: EngineState, now: datetime, ambulance: AmbulanceTelemetry, kpi: KpiMetrics, intersections: list[IntersectionTelemetry]) -> SimulationTickEvent`
  - `completed_event(simulation_id: str, state: EngineState, now: datetime, kpi: KpiMetrics) -> SimulationCompletedEvent`

- [ ] **Step 1: Failing test** `test_status_priority_arrived_then_crossing_then_approaching` — three states (arrived; dwelling with an active runtime; active runtime, no dwell) → `ARRIVED`, `CROSSING_INTERSECTION`, `APPROACHING_INTERSECTION`.
- [ ] **Steps 2–4:** FAIL → move code (existing KPI tests in `test_engine.py` keep covering `kpi_metrics` through the façade) → `uv run pytest tests/simulation -v` PASS incl. golden.

### Task 6: Motion and façade cleanup

**Files:**
- Create: `backend/src/greenwave/simulation/motion.py`
- Modify: `backend/src/greenwave/simulation/engine.py`, `backend/src/greenwave/simulation/__init__.py` (exports unchanged)

**Interfaces:**
- Produces: `next_stop(route_model: RouteModel, state: EngineState, distance_m: float) -> RouteIntersection | None`; `move_one_second(state: EngineState, track: RouteTrack, route_model: RouteModel, settings: SimulationSettings) -> tuple[EngineState, float]` (today's `_move` verbatim in behaviour, docstring with D13 kept).
- Façade end state: `engine.py` holds only `EngineEvent`, `SimulationEngine` (`__init__`, `initial_state` using **keyword** fields, `step`, `run_tick`, `_dispatch`), ≲ 120 lines.

- [ ] **Step 1:** Move; no new test (covered by `test_step_advances_at_current_edge_speed_and_dwells_at_stop_line`, `test_a_step_carries_its_remaining_time_onto_the_next_edge`, golden).
- [ ] **Step 2:** Full backend checks → green. `git diff --stat contracts frontend/src/types` → empty.
- [ ] **Step 3:** `graphify update .` (from repo root).
- [ ] **Step 4: Commit**
```bash
git add backend/src/greenwave/simulation backend/tests/simulation
git commit -m "refactor(simulation): split engine into track, motion, corridor, dispatch and telemetry"
```

---

## Milestone M2: Session manager

### Task 7: Terminal-event typing and subscriber queue policy

**Files:**
- Modify: `backend/src/greenwave/simulation/events.py`
- Create: `backend/src/greenwave/simulation/subscriber_queue.py`
- Test: `backend/tests/simulation/test_subscriber_queue.py`; move `test_full_subscriber_queue_makes_room_for_terminal_event` here from `test_session.py` (assertion unchanged; call becomes `offer(queue, terminal)`)

**Interfaces:**
- Produces:
  - `events.py`: `TerminalEvent = SimulationCancelledEvent | SimulationCompletedEvent`; `is_terminal(event: SimulationEvent) -> TypeGuard[TerminalEvent]`.
  - `subscriber_queue.py`: `offer(queue: asyncio.Queue[SimulationEvent], event: SimulationEvent) -> None` — same algorithm as `SessionManager._put`, with `terminal = is_terminal(event)`.

- [ ] **Step 1: Failing tests:** moved test; plus `test_offer_drops_oldest_tick_for_a_new_tick` (maxsize 2, two ticks queued, offer third → queue holds ticks 2, 3) and `test_offer_keeps_existing_terminal_and_drops_a_tick` (maxsize 2: tick, completed queued; offer cancelled → queue holds completed, cancelled).
- [ ] **Step 2:** FAIL. **Step 3:** implement; `SessionManager` uses `offer` and `is_terminal` (removes the three repeated `isinstance` tuples and the `cast`). **Step 4:** `uv run pytest tests/simulation -v` PASS.

### Task 8: Injectable simulation planner

**Files:**
- Create: `backend/src/greenwave/simulation/assembly.py`
- Test: `backend/tests/simulation/test_assembly.py`
- Modify: `backend/src/greenwave/simulation/session.py`, `backend/tests/simulation/test_session.py` (fixture only)

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True, slots=True) class PlannedSimulation: engine: SimulationEngine; response: SimulationStartResponse`
  - `SimulationPlanner = Callable[[RoutingIndex, SimulationStartRequest, SimulationSettings, ItsGateway], PlannedSimulation]`
  - `plan_simulation(index: RoutingIndex, request: SimulationStartRequest, settings: SimulationSettings, gateway: ItsGateway) -> PlannedSimulation` — `plan_route` → `build_route_model` → `estimate_times` → `SimulationEngine(...)` → `to_start_response(...)`.
  - `SessionManager.__init__(..., sleep=asyncio.sleep, planner: SimulationPlanner = plan_simulation)`; `start()` runs `await asyncio.to_thread(self._planner, ...)` before the supersede check-and-cancel, under the lock, exactly where `plan_route` runs today. `main.py` unchanged.

- [ ] **Step 1: Failing test** `test_plan_simulation_matches_start_response_of_parts` — with `corridor_index()` and the `cascade_x1` request from Task 1: `planned.response == to_start_response(...)` built by hand from the parts; `planned.engine.initial_state() == SimulationEngine(...).initial_state()`.
- [ ] **Step 2:** FAIL. **Step 3:** implement; rewire `test_session.py` fixture: drop the five `monkeypatch.setattr` lines, pass `planner=lambda _i, request, _s, _g: PlannedSimulation(_Engine(), _response(request.simulation_id))` (`_response` = the existing inline response factory, extracted). `test_completed_session_...` passes a planner yielding `_CompletingEngine()`; `test_failed_replacement_...` swaps `manager._planner` to one raising `OriginOffNetwork("outside network")`. No assertion changes.
- [ ] **Step 4:** Full backend checks green; `uv run pytest tests/api -v` PASS (real planner through the app).
- [ ] **Step 5:** `graphify update .`
- [ ] **Step 6: Commit**
```bash
git add backend/src/greenwave/simulation backend/tests/simulation
git commit -m "refactor(simulation): extract session planner and subscriber queue policy"
```

### Milestone report (after each commit)
Changed files, check output, golden status, Task 2 timing before/after, setup-only test edits (Task 7 move, Task 8 fixture), deviations.
