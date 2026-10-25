import asyncio
from datetime import UTC, datetime
from threading import Event
from types import SimpleNamespace

import pytest

from greenwave.routing.errors import OriginOffNetwork
from greenwave.schemas import (
    CancelReason,
    ComparisonStartRequest,
    GreenWaveMode,
    SimulationCancelledEvent,
    SimulationCompletedEvent,
    SimulationStartRequest,
    SimulationStartResponse,
)
from greenwave.simulation.assembly import PlannedSimulation, SimulationPlanner
from greenwave.simulation.session import (
    SessionManager,
    SimulationIdInUseError,
    SimulationNotFoundError,
)
from greenwave.simulation_settings import SimulationSettings


class _Gateway:
    def dispatch(self, payload: object) -> None:
        del payload


class _Engine:
    def __init__(self, *_: object) -> None:
        pass

    def close(self) -> None:
        pass

    def initial_state(self) -> SimpleNamespace:
        return SimpleNamespace(tick=0, completed=False)

    def step(self, state: SimpleNamespace, _: datetime) -> tuple[SimpleNamespace, list[object]]:
        return state, []


class _CompletingEngine(_Engine):
    def step(
        self, state: SimpleNamespace, timestamp: datetime
    ) -> tuple[SimpleNamespace, list[object]]:
        state.completed = True
        return state, [
            SimulationCompletedEvent(
                schema_version="1.0",
                is_simulated=True,
                event_type="SIMULATION_COMPLETED",
                simulation_id="first",
                tick=1,
                timestamp=timestamp,
                kpi_metrics={"current_time_saved_sec": 0, "total_time_elapsed_sec": 1},
            )
        ]


async def _sleep_forever(_: float) -> None:
    await asyncio.Event().wait()


def _request(simulation_id: str) -> SimulationStartRequest:
    return SimulationStartRequest.model_validate(
        {
            "simulation_id": simulation_id,
            "origin": {"lat": 50.0, "lng": 19.0},
            "destination": {"lat": 50.1, "lng": 19.1},
            "traffic_density_multiplier": 1.0,
            "enable_cascade_mode": False,
        }
    )


def _response(simulation_id: str) -> SimulationStartResponse:
    return SimulationStartResponse.model_validate(
        {
            "schema_version": "1.0",
            "is_simulated": True,
            "simulation_id": simulation_id,
            "status": "INITIALIZED",
            "route_geometry": {
                "type": "LineString",
                "coordinates": [[19.0, 50.0], [19.1, 50.1]],
            },
            "total_distance_m": 1,
            "estimated_normal_time_sec": 1,
            "estimated_greenwave_time_sec": 1,
            "intersections_on_route": [],
            "route_intersections": [],
            "origin_snapped": {
                "position": {"lat": 50.0, "lng": 19.0},
                "snap_distance_m": 0,
            },
            "destination_snapped": {
                "position": {"lat": 50.1, "lng": 19.1},
                "snap_distance_m": 0,
            },
        }
    )


def _planner(engine_type: type[_Engine]) -> SimulationPlanner:
    def plan(_: object, request: SimulationStartRequest, *__: object) -> PlannedSimulation:
        return PlannedSimulation(engine_type(), _response(request.simulation_id))  # type: ignore[arg-type]

    return plan


def _failing_planner(*_: object) -> PlannedSimulation:
    raise OriginOffNetwork("outside network")


@pytest.fixture
def manager() -> SessionManager:
    return SessionManager(
        object(),
        SimulationSettings(),
        _Gateway(),  # type: ignore[arg-type]
        clock=lambda: datetime(2026, 10, 16, tzinfo=UTC),
        sleep=_sleep_forever,
        planner=_planner(_Engine),
    )


@pytest.mark.asyncio
async def test_second_start_supersedes_first_and_closes_subscriber(manager: SessionManager) -> None:
    await manager.start(_request("first"))
    stream = manager.subscribe("first")
    next_event = asyncio.create_task(anext(stream))
    await asyncio.sleep(0)

    await manager.start(_request("second"))

    event = await next_event
    assert event.reason is CancelReason.SUPERSEDED
    with pytest.raises(StopAsyncIteration):
        await anext(stream)
    await manager.shutdown()


@pytest.mark.asyncio
async def test_completed_session_is_not_cancelled_while_loop_finishes(
    manager: SessionManager,
) -> None:
    manager._planner = _planner(_CompletingEngine)
    await manager.start(_request("first"))
    await asyncio.sleep(0)

    await manager.start(_request("second"))

    stream = manager.subscribe("first")
    event = await anext(stream)
    assert isinstance(event, SimulationCompletedEvent)
    await manager.shutdown()


@pytest.mark.asyncio
async def test_failed_replacement_keeps_active_session(manager: SessionManager) -> None:
    await manager.start(_request("first"))
    manager._planner = _failing_planner

    with pytest.raises(OriginOffNetwork):
        await manager.start(_request("invalid"))

    assert manager.exists("first")
    assert manager._active is not None
    assert manager._active.simulation_id == "first"
    await manager.shutdown()


class _FailingEngine(_Engine):
    def step(self, state: SimpleNamespace, _: datetime) -> tuple[SimpleNamespace, list[object]]:
        raise RuntimeError("engine bug")


@pytest.mark.asyncio
async def test_engine_failure_is_logged_with_the_simulation_id(
    manager: SessionManager, caplog: pytest.LogCaptureFixture
) -> None:
    """An unlogged loop crash leaves a silent, frozen run that nobody can diagnose."""
    manager._planner = _planner(_FailingEngine)
    with caplog.at_level("ERROR", logger="greenwave.simulation.session"):
        await manager.start(_request("first"))
        await asyncio.sleep(0)

    [record] = [r for r in caplog.records if r.getMessage() == "simulation_loop_failed"]
    assert record.exc_info is not None
    assert getattr(record, "simulation_id", None) == "first"
    await manager.shutdown()


class _TickThenFailEngine(_Engine):
    """Publishes ticks 1-2 (stand-in tick events), then raises on the third step."""

    def step(self, state: SimpleNamespace, _: datetime) -> tuple[SimpleNamespace, list[object]]:
        if state.tick == 2:
            raise RuntimeError("engine bug")
        tick = state.tick + 1
        return SimpleNamespace(tick=tick, completed=False), [SimpleNamespace(tick=tick)]


async def _yield(_: float) -> None:
    await asyncio.sleep(0)


async def _failed_run(manager: SessionManager) -> list[object]:
    """Every event one subscriber receives for a run whose loop crashes on its third step."""
    manager._planner = _planner(_TickThenFailEngine)
    manager._sleep = _yield
    await manager.start(_request("first"))
    return [event async for event in manager.subscribe("first")]


@pytest.mark.asyncio
async def test_engine_failure_publishes_a_server_error_terminal(manager: SessionManager) -> None:
    """Without a terminal, clients wait out their silence timeout on a dead run (D2)."""
    events = await asyncio.wait_for(_failed_run(manager), timeout=1)

    *ticks, terminal = events
    assert [event.tick for event in ticks] == [1, 2]  # type: ignore[attr-defined]
    assert isinstance(terminal, SimulationCancelledEvent)
    assert terminal.reason is CancelReason.SERVER_ERROR
    assert terminal.tick == 2
    assert terminal.simulation_id == "first"
    await manager.shutdown()


@pytest.mark.asyncio
async def test_failed_run_replays_latest_snapshot_then_terminal_and_stop_is_a_no_op(
    manager: SessionManager,
) -> None:
    [*_, latest, terminal] = await asyncio.wait_for(_failed_run(manager), timeout=1)
    late = asyncio.Queue[object]()

    replay = [event async for event in manager.subscribe("first")]
    manager._sessions["first"].subscribers.add(late)  # type: ignore[arg-type]
    response = await manager.stop("first")

    assert replay == [latest, terminal]
    assert response.status == "STOPPED"
    assert late.empty(), "stop published a second terminal"
    assert manager._active is None
    await manager.shutdown()


@pytest.mark.asyncio
async def test_start_after_a_failed_run_supersedes_nothing(manager: SessionManager) -> None:
    [*_, latest, terminal] = await asyncio.wait_for(_failed_run(manager), timeout=1)
    manager._planner = _planner(_Engine)

    await manager.start(_request("second"))

    assert [event async for event in manager.subscribe("first")] == [latest, terminal]
    assert manager._active is not None
    assert manager._active.simulation_id == "second"
    await manager.shutdown()


async def _stream_at(playback: int, mode: str) -> tuple[list[dict[str, object]], list[float]]:
    """Every event a subscriber receives for one corridor run, and every wall-clock sleep."""
    from tests.support.route_fixtures import corridor_index, position_at

    from greenwave.its import MockItsGateway

    sleeps: list[float] = []

    async def record_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        await asyncio.sleep(0)

    manager = SessionManager(
        corridor_index(),
        SimulationSettings(),
        MockItsGateway(),
        clock=lambda: datetime(2026, 10, 21, tzinfo=UTC),
        sleep=record_sleep,
    )
    request = SimulationStartRequest.model_validate(
        {
            "simulation_id": "SIM-speed",
            "origin": position_at(7_422_000).model_dump(),
            "destination": position_at(7_422_950.02).model_dump(),
            "traffic_density_multiplier": 1.5,
            "enable_cascade_mode": True,
            "playback_speed": playback,
            "green_wave_mode": mode,
        }
    )
    await manager.start(request)

    async def collect() -> list[dict[str, object]]:
        return [event.model_dump(mode="json") async for event in manager.subscribe("SIM-speed")]

    events = await asyncio.wait_for(collect(), timeout=30)
    await manager.shutdown()
    return events, sleeps


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["ENABLED", "DISABLED"])
async def test_every_simulated_second_is_streamed_whatever_the_playback_speed(mode: str) -> None:
    """Playback speed only shortens the wall-clock gap; it never skips or batches a second."""
    baseline, _ = await _stream_at(1, mode)
    ticks = [event["tick"] for event in baseline if event["event_type"] == "SIMULATION_TICK"]
    assert ticks == list(range(1, len(ticks) + 1))
    for playback in (2, 5, 10):
        events, sleeps = await _stream_at(playback, mode)
        assert events == baseline
        assert sleeps
        assert all(seconds <= 1 / playback for seconds in sleeps)
        assert max(sleeps) == pytest.approx(1 / playback, abs=0.01)


def _limited(manager: SessionManager, limit: int) -> SessionManager:
    manager._settings = SimulationSettings(retained_session_limit=limit)
    return manager


@pytest.mark.asyncio
async def test_oldest_terminal_sessions_are_evicted_beyond_the_limit(
    manager: SessionManager,
) -> None:
    """Every retained engine, route and phase state otherwise lives as long as the process (B3)."""
    _limited(manager, 2)
    for simulation_id in ("A", "B", "C"):
        await manager.start(_request(simulation_id))

    assert [manager.exists(sid) for sid in ("A", "B", "C")] == [False, True, True]
    with pytest.raises(SimulationNotFoundError):
        await anext(manager.subscribe("A"))
    with pytest.raises(SimulationNotFoundError):
        await manager.stop("A")
    await manager.shutdown()


@pytest.mark.asyncio
async def test_the_active_session_is_kept_at_a_limit_of_one(manager: SessionManager) -> None:
    _limited(manager, 1)
    await manager.start(_request("A"))
    assert manager.exists("A")

    await manager.start(_request("B"))

    assert not manager.exists("A")
    assert manager.exists("B")
    assert manager._active is not None
    assert manager._active.simulation_id == "B"
    await manager.shutdown()


@pytest.mark.asyncio
async def test_a_retained_finished_session_without_snapshot_replays_only_its_terminal(
    manager: SessionManager,
) -> None:
    _limited(manager, 2)
    manager._planner = _planner(_CompletingEngine)
    await manager.start(_request("first"))
    await asyncio.sleep(0)
    manager._planner = _planner(_Engine)

    await manager.start(_request("second"))

    [event] = [event async for event in manager.subscribe("first")]
    assert isinstance(event, SimulationCompletedEvent)
    await manager.shutdown()


@pytest.mark.asyncio
async def test_restarting_a_finished_id_makes_it_the_newest_session(
    manager: SessionManager,
) -> None:
    _limited(manager, 2)
    for simulation_id in ("A", "B", "A", "C"):
        await manager.start(_request(simulation_id))

    assert [manager.exists(sid) for sid in ("A", "B", "C")] == [True, False, True]
    await manager.shutdown()


async def _slow_to_unwind(_: float) -> None:
    """A tick sleep whose cancellation takes a moment, so concurrent cancellers overlap."""
    try:
        await asyncio.Event().wait()
    except asyncio.CancelledError:
        await asyncio.sleep(0.01)
        raise


async def _terminals_of_a_raced_run(manager: SessionManager, stop_first: bool) -> list[object]:
    manager._sleep = _slow_to_unwind
    await manager.start(_request("A"))
    await asyncio.sleep(0)
    stream = manager.subscribe("A")
    first = asyncio.create_task(anext(stream))
    await asyncio.sleep(0)

    racers = [manager.stop("A"), manager.start(_request("B"))]
    await asyncio.gather(*(racers if stop_first else reversed(racers)))

    events = [await first, *[event async for event in stream]]
    await manager.shutdown()
    return events


@pytest.mark.asyncio
@pytest.mark.parametrize("stop_first", [True, False])
async def test_racing_stop_and_supersede_publish_one_terminal(
    manager: SessionManager, stop_first: bool
) -> None:
    """Both callers can pass ``terminal is None`` before either publishes (B4)."""
    events = await asyncio.wait_for(_terminals_of_a_raced_run(manager, stop_first), timeout=1)

    [terminal] = events
    assert isinstance(terminal, SimulationCancelledEvent)
    assert terminal.reason in {CancelReason.STOPPED, CancelReason.SUPERSEDED}
    assert manager._sessions["A"].terminal is terminal


@pytest.mark.asyncio
async def test_racing_stop_and_supersede_publish_one_terminal_to_late_listeners(
    manager: SessionManager,
) -> None:
    manager._sleep = _slow_to_unwind
    await manager.start(_request("A"))
    await asyncio.sleep(0)
    listener = asyncio.Queue[object](maxsize=8)
    manager._sessions["A"].subscribers.add(listener)  # type: ignore[arg-type]

    await asyncio.gather(manager.stop("A"), manager.start(_request("B")))

    received = [listener.get_nowait() for _ in range(listener.qsize())]
    assert len(received) == 1, received
    await manager.shutdown()


@pytest.mark.asyncio
async def test_stop_after_natural_completion_publishes_nothing(manager: SessionManager) -> None:
    manager._planner = _planner(_CompletingEngine)
    await manager.start(_request("first"))
    await asyncio.sleep(0)
    listener = asyncio.Queue[object](maxsize=8)
    manager._sessions["first"].subscribers.add(listener)  # type: ignore[arg-type]

    await manager.stop("first")

    assert listener.empty()
    assert isinstance(manager._sessions["first"].terminal, SimulationCompletedEvent)
    await manager.shutdown()


class _TerminalThenFailEngine(_CompletingEngine):
    """An engine bug: emits its terminal without marking the state completed, then raises."""

    def step(
        self, state: SimpleNamespace, timestamp: datetime
    ) -> tuple[SimpleNamespace, list[object]]:
        if state.tick == 1:
            raise RuntimeError("engine bug after the terminal")
        _, events = super().step(state, timestamp)
        return SimpleNamespace(tick=1, completed=False), events


@pytest.mark.asyncio
async def test_a_failure_after_the_terminal_publishes_no_second_terminal(
    manager: SessionManager,
) -> None:
    manager._planner = _planner(_TerminalThenFailEngine)
    manager._sleep = _yield
    await manager.start(_request("first"))
    listener = asyncio.Queue[object](maxsize=8)
    manager._sessions["first"].subscribers.add(listener)  # type: ignore[arg-type]
    task = manager._sessions["first"].task
    assert task is not None

    await asyncio.wait_for(task, timeout=1)

    received = [listener.get_nowait() for _ in range(listener.qsize())]
    assert [type(event) for event in received] == [SimulationCompletedEvent]
    await manager.shutdown()


# Comparison pairs (ADR 0008): one operation of two sessions advanced by one shared loop.


def _comparison(enabled_id: str = "on", disabled_id: str = "off") -> ComparisonStartRequest:
    return ComparisonStartRequest.model_validate(
        {
            "enabled_simulation_id": enabled_id,
            "disabled_simulation_id": disabled_id,
            "origin": {"lat": 50.0, "lng": 19.0},
            "destination": {"lat": 50.1, "lng": 19.1},
            "traffic_density_multiplier": 1.0,
            "enable_cascade_mode": False,
        }
    )


def _completed(simulation_id: str, tick: int) -> SimulationCompletedEvent:
    return SimulationCompletedEvent(
        schema_version="1.0",
        is_simulated=True,
        event_type="SIMULATION_COMPLETED",
        simulation_id=simulation_id,
        tick=tick,
        timestamp=datetime(2026, 10, 16, tzinfo=UTC),
        kpi_metrics={"current_time_saved_sec": 0, "total_time_elapsed_sec": tick},
    )


class _CountingEngine(_Engine):
    """Ticks 1..n (stand-in tick events), completing on tick ``n``; logs every step."""

    def __init__(self, simulation_id: str, n: int | None, log: list[tuple[str, int]]) -> None:
        self.simulation_id, self.n, self.log = simulation_id, n, log

    def step(self, state: SimpleNamespace, _: datetime) -> tuple[SimpleNamespace, list[object]]:
        tick = state.tick + 1
        self.log.append((self.simulation_id, tick))
        if tick == self.n:
            return SimpleNamespace(tick=tick, completed=True), [
                _completed(self.simulation_id, tick)
            ]
        return SimpleNamespace(tick=tick, completed=False), [SimpleNamespace(tick=tick)]


def _pair_planner(
    log: list[tuple[str, int]], enabled_n: int | None, disabled_n: int | None
) -> SimulationPlanner:
    def plan(_: object, request: SimulationStartRequest, *__: object) -> PlannedSimulation:
        n = enabled_n if request.green_wave_mode is GreenWaveMode.ENABLED else disabled_n
        engine = _CountingEngine(request.simulation_id, n, log)
        response = _response(request.simulation_id).model_copy(
            update={"green_wave_mode": request.green_wave_mode}
        )
        return PlannedSimulation(engine, response)  # type: ignore[arg-type]

    return plan


async def _events(manager: SessionManager, simulation_id: str) -> list[object]:
    return [event async for event in manager.subscribe(simulation_id)]


async def _pair_run(
    manager: SessionManager, enabled_n: int | None, disabled_n: int | None
) -> tuple[list[tuple[str, int]], list[object], list[object]]:
    log: list[tuple[str, int]] = []
    manager._planner = _pair_planner(log, enabled_n, disabled_n)
    manager._sleep = _yield
    response = await manager.start_comparison(_comparison())
    assert response.enabled.green_wave_mode is GreenWaveMode.ENABLED
    assert response.disabled.green_wave_mode is GreenWaveMode.DISABLED
    on, off = await asyncio.wait_for(
        asyncio.gather(_events(manager, "on"), _events(manager, "off")), timeout=1
    )
    return log, on, off


@pytest.mark.asyncio
async def test_pair_members_advance_in_lockstep(manager: SessionManager) -> None:
    log, on, off = await _pair_run(manager, 4, 4)
    assert log == [(sid, tick) for tick in range(1, 5) for sid in ("on", "off")]
    assert isinstance(on[-1], SimulationCompletedEvent)
    assert isinstance(off[-1], SimulationCompletedEvent)
    await manager.shutdown()


@pytest.mark.asyncio
async def test_pair_keeps_streaming_the_slower_member_after_the_first_completes(
    manager: SessionManager,
) -> None:
    log, on, off = await _pair_run(manager, 3, 5)
    assert [tick for sid, tick in log if sid == "on"] == [1, 2, 3]
    assert [tick for sid, tick in log if sid == "off"] == [1, 2, 3, 4, 5]
    assert isinstance(on[-1], SimulationCompletedEvent) and on[-1].tick == 3
    assert isinstance(off[-1], SimulationCompletedEvent) and off[-1].tick == 5
    assert manager._active is None
    await manager.shutdown()


async def _running_pair(
    manager: SessionManager, enabled_n: int | None = None, disabled_n: int | None = None
) -> list[tuple[str, int]]:
    log: list[tuple[str, int]] = []
    manager._planner = _pair_planner(log, enabled_n, disabled_n)
    await manager.start_comparison(_comparison())
    await asyncio.sleep(0)
    return log


def _terminal(manager: SessionManager, simulation_id: str) -> object:
    return manager._sessions[simulation_id].terminal


@pytest.mark.asyncio
async def test_stopping_one_member_stops_both(manager: SessionManager) -> None:
    await _running_pair(manager)
    await manager.stop("on")
    for simulation_id in ("on", "off"):
        terminal = _terminal(manager, simulation_id)
        assert isinstance(terminal, SimulationCancelledEvent)
        assert terminal.reason is CancelReason.STOPPED
    assert manager._active is None
    await manager.shutdown()


@pytest.mark.asyncio
async def test_stopping_a_pair_after_one_arrival_cancels_only_the_live_member(
    manager: SessionManager,
) -> None:
    await _running_pair(manager, enabled_n=1)
    assert isinstance(_terminal(manager, "on"), SimulationCompletedEvent)

    await manager.stop("on")  # the finished member's id still stops the live one

    assert isinstance(_terminal(manager, "on"), SimulationCompletedEvent)
    off = _terminal(manager, "off")
    assert isinstance(off, SimulationCancelledEvent)
    assert off.reason is CancelReason.STOPPED
    await manager.shutdown()


@pytest.mark.asyncio
async def test_single_start_supersedes_a_running_pair(manager: SessionManager) -> None:
    await _running_pair(manager)
    manager._planner = _planner(_Engine)
    await manager.start(_request("single"))
    for simulation_id in ("on", "off"):
        terminal = _terminal(manager, simulation_id)
        assert isinstance(terminal, SimulationCancelledEvent)
        assert terminal.reason is CancelReason.SUPERSEDED
    assert manager._active is not None
    assert manager._active.simulation_id == "single"
    await manager.shutdown()


@pytest.mark.asyncio
async def test_comparison_start_supersedes_a_running_single(manager: SessionManager) -> None:
    await manager.start(_request("single"))
    await _running_pair(manager)
    terminal = _terminal(manager, "single")
    assert isinstance(terminal, SimulationCancelledEvent)
    assert terminal.reason is CancelReason.SUPERSEDED
    assert _terminal(manager, "on") is None
    assert _terminal(manager, "off") is None
    await manager.shutdown()


@pytest.mark.asyncio
async def test_comparison_start_rejects_a_live_id(manager: SessionManager) -> None:
    await manager.start(_request("on"))
    with pytest.raises(SimulationIdInUseError):
        await manager.start_comparison(_comparison())
    assert _terminal(manager, "on") is None
    await manager.shutdown()


@pytest.mark.asyncio
async def test_failed_pair_planning_keeps_the_active_operation(manager: SessionManager) -> None:
    await manager.start(_request("first"))
    manager._planner = _failing_planner

    with pytest.raises(OriginOffNetwork):
        await manager.start_comparison(_comparison())

    assert not manager.exists("on")
    assert not manager.exists("off")
    assert manager._active is not None
    assert manager._active.simulation_id == "first"
    assert _terminal(manager, "first") is None
    await manager.shutdown()


class _PairFailEngine(_CountingEngine):
    def step(self, state: SimpleNamespace, at: datetime) -> tuple[SimpleNamespace, list[object]]:
        if self.simulation_id == "off" and state.tick == 1:
            raise RuntimeError("engine bug")
        return super().step(state, at)


@pytest.mark.asyncio
async def test_pair_loop_failure_ends_both_with_server_error(manager: SessionManager) -> None:
    log: list[tuple[str, int]] = []

    def plan(_: object, request: SimulationStartRequest, *__: object) -> PlannedSimulation:
        engine = _PairFailEngine(request.simulation_id, None, log)
        return PlannedSimulation(engine, _response(request.simulation_id))  # type: ignore[arg-type]

    manager._planner = plan
    manager._sleep = _yield
    await manager.start_comparison(_comparison())
    on, off = await asyncio.wait_for(
        asyncio.gather(_events(manager, "on"), _events(manager, "off")), timeout=1
    )
    for events in (on, off):
        assert isinstance(events[-1], SimulationCancelledEvent)
        assert events[-1].reason is CancelReason.SERVER_ERROR
    assert manager._active is None
    await manager.shutdown()


@pytest.mark.asyncio
async def test_pair_members_are_kept_by_eviction(manager: SessionManager) -> None:
    _limited(manager, 1)
    await manager.start(_request("old"))
    await _running_pair(manager)
    assert not manager.exists("old")
    assert manager.exists("on")
    assert manager.exists("off")
    await manager.shutdown()


@pytest.mark.asyncio
async def test_second_pair_plan_failure_closes_the_first_engine(manager: SessionManager) -> None:
    closed: list[str] = []

    class TrackedEngine(_Engine):
        def close(self) -> None:
            closed.append("on")

    def plan(_: object, request: SimulationStartRequest, *__: object) -> PlannedSimulation:
        if request.green_wave_mode is GreenWaveMode.DISABLED:
            raise OriginOffNetwork("second plan failed")
        return PlannedSimulation(TrackedEngine(), _response(request.simulation_id))  # type: ignore[arg-type]

    manager._planner = plan
    with pytest.raises(OriginOffNetwork):
        await manager.start_comparison(_comparison())
    assert closed == ["on"]
    assert not manager.exists("on")


def test_comparison_members_preserve_the_selected_its_scenario() -> None:
    from greenwave.schemas.its import ItsScenario

    request = ComparisonStartRequest.model_validate(
        {**_comparison().model_dump(), "its_scenario": "REJECTED"}
    )
    assert request.member(GreenWaveMode.ENABLED).its_scenario is ItsScenario.REJECTED


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("scenario", "failure"),
    # A nominal request holds until the vehicle clears its farthest target (ADR 0010).
    [("NOMINAL", None), ("REJECTED", "ITS_REJECTED"), ("NO_FEEDBACK", "ITS_TIMEOUT")],
)
async def test_real_engine_comparison_keeps_feedback_and_baseline_isolated(
    scenario: str, failure: str | None
) -> None:
    from tests.support.route_fixtures import corridor_index, position_at

    manager = SessionManager(corridor_index(), SimulationSettings(), sleep=_yield)
    request = ComparisonStartRequest.model_validate(
        {
            **_comparison().model_dump(),
            "origin": position_at(7_422_000),
            "destination": position_at(7_422_850.02),
            "its_scenario": scenario,
        }
    )
    try:
        response = await manager.start_comparison(request)
        assert response.enabled.its_scenario.value == scenario
        assert response.disabled.its_scenario.value == "NOMINAL"
        assert (
            manager._sessions["on"].engine.controller
            is not manager._sessions["off"].engine.controller
        )
        on, off = await asyncio.wait_for(
            asyncio.gather(_events(manager, "on"), _events(manager, "off")), timeout=3
        )
        assert isinstance(off[-1], SimulationCompletedEvent)
        if failure:
            assert isinstance(on[-1], SimulationCancelledEvent)
            assert on[-1].reason.value == failure
            assert not any(isinstance(event, SimulationCompletedEvent) for event in on)
        else:
            assert isinstance(on[-1], SimulationCompletedEvent)
        assert all(session.engine._closed for session in manager._sessions.values())
    finally:
        await manager.shutdown()


@pytest.mark.asyncio
@pytest.mark.parametrize("blocked_member", ["single", "on", "off"])
async def test_stop_during_planning_waits_then_stops_every_member(
    manager: SessionManager, blocked_member: str
) -> None:
    entered = asyncio.Event()
    release = Event()
    loop = asyncio.get_running_loop()

    def plan(_: object, request: SimulationStartRequest, *__: object) -> PlannedSimulation:
        if request.simulation_id == blocked_member:
            loop.call_soon_threadsafe(entered.set)
            if not release.wait(timeout=5):
                raise TimeoutError("test did not release planning")
        return PlannedSimulation(_Engine(), _response(request.simulation_id))  # type: ignore[arg-type]

    manager._planner = plan
    start = asyncio.create_task(
        manager.start(_request("single"))
        if blocked_member == "single"
        else manager.start_comparison(_comparison())
    )
    stop = None
    try:
        await asyncio.wait_for(entered.wait(), timeout=1)
        stop = asyncio.create_task(manager.stop(blocked_member))
        await asyncio.sleep(0)  # Stop reaches the lifecycle boundary before planning resumes.
        release.set()
        await asyncio.wait_for(start, timeout=1)
        response = await asyncio.wait_for(stop, timeout=1)
        assert response.status == "STOPPED"
        for simulation_id in ("single",) if blocked_member == "single" else ("on", "off"):
            terminal = _terminal(manager, simulation_id)
            assert isinstance(terminal, SimulationCancelledEvent)
            assert terminal.reason is CancelReason.STOPPED
        assert manager._active is None
    finally:
        release.set()
        await asyncio.gather(start, *([stop] if stop is not None else []), return_exceptions=True)
        await manager.shutdown()


@pytest.mark.asyncio
async def test_stop_unknown_id_does_not_stop_the_active_operation(manager: SessionManager) -> None:
    await manager.start(_request("first"))
    try:
        with pytest.raises(SimulationNotFoundError):
            await manager.stop("unknown")
        assert manager._active is not None
        assert _terminal(manager, "first") is None
    finally:
        await manager.shutdown()


@pytest.mark.asyncio
async def test_completed_run_replays_last_snapshot_before_one_terminal(
    manager: SessionManager,
) -> None:
    manager._planner = _pair_planner([], enabled_n=3, disabled_n=3)
    manager._sleep = _yield
    await manager.start(_request("first"))
    task = manager._sessions["first"].task
    assert task is not None
    await asyncio.wait_for(task, timeout=1)

    snapshot, terminal = [event async for event in manager.subscribe("first")]

    assert snapshot.tick == 2
    assert isinstance(terminal, SimulationCompletedEvent)
    assert terminal.tick == 3
    await manager.shutdown()


@pytest.mark.asyncio
async def test_real_engine_finishing_before_subscription_replays_arrival_at_destination() -> None:
    import networkx as nx
    from tests.support.route_fixtures import _builders, _index, position_at

    from greenwave.schemas import AmbulanceStatus, SimulationTickEvent

    graph = nx.MultiDiGraph()
    node, edge = _builders(graph, {})
    node("origin", 7_424_000)
    node("destination", 7_424_001)
    edge("one-metre", "origin", "destination", 1, 36)
    destination = position_at(7_424_001)
    manager = SessionManager(_index(graph, {}, {}, None), SimulationSettings(), sleep=_yield)
    try:
        response = await manager.start(
            SimulationStartRequest.model_validate(
                {
                    **_request("short-route").model_dump(),
                    "origin": position_at(7_424_000),
                    "destination": destination,
                }
            )
        )
        assert response.total_distance_m == 1
        assert response.route_intersections == []
        await asyncio.sleep(0)  # The signal-free metre completes in the first engine step.

        snapshot, terminal = [event async for event in manager.subscribe("short-route")]

        assert isinstance(snapshot, SimulationTickEvent)
        assert snapshot.tick == 1
        assert snapshot.ambulance.status is AmbulanceStatus.ARRIVED
        assert snapshot.ambulance.position.lat == pytest.approx(destination.lat, abs=1e-9)
        assert snapshot.ambulance.position.lng == pytest.approx(destination.lng, abs=1e-9)
        assert isinstance(terminal, SimulationCompletedEvent)
        assert terminal.tick == snapshot.tick
        assert terminal.simulation_id == snapshot.simulation_id == "short-route"
    finally:
        await manager.shutdown()
