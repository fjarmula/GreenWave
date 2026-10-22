import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from greenwave.routing.errors import OriginOffNetwork
from greenwave.schemas import (
    CancelReason,
    SimulationCancelledEvent,
    SimulationCompletedEvent,
    SimulationStartRequest,
    SimulationStartResponse,
)
from greenwave.simulation.assembly import PlannedSimulation, SimulationPlanner
from greenwave.simulation.session import SessionManager
from greenwave.simulation_settings import SimulationSettings


class _Gateway:
    def dispatch(self, payload: object) -> None:
        del payload


class _Engine:
    def __init__(self, *_: object) -> None:
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
async def test_failed_run_replays_only_its_terminal_and_stops_as_a_no_op(
    manager: SessionManager,
) -> None:
    [*_, terminal] = await asyncio.wait_for(_failed_run(manager), timeout=1)
    late = asyncio.Queue[object]()

    replay = [event async for event in manager.subscribe("first")]
    manager._sessions["first"].subscribers.add(late)  # type: ignore[arg-type]
    response = await manager.stop("first")

    assert replay == [terminal]
    assert response.status == "STOPPED"
    assert late.empty(), "stop published a second terminal"
    assert manager._active is None
    await manager.shutdown()


@pytest.mark.asyncio
async def test_start_after_a_failed_run_supersedes_nothing(manager: SessionManager) -> None:
    [*_, terminal] = await asyncio.wait_for(_failed_run(manager), timeout=1)
    manager._planner = _planner(_Engine)

    await manager.start(_request("second"))

    assert [event async for event in manager.subscribe("first")] == [terminal]
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
