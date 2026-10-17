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

    def run_tick(
        self, state: SimpleNamespace, _: datetime, __: int
    ) -> tuple[SimpleNamespace, list[object]]:
        return state, []


class _CompletingEngine(_Engine):
    def run_tick(
        self, state: SimpleNamespace, timestamp: datetime, _: int
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


@pytest.fixture
def manager(monkeypatch: pytest.MonkeyPatch) -> SessionManager:
    import greenwave.simulation.session as session

    monkeypatch.setattr(session, "plan_route", lambda *_: object())
    monkeypatch.setattr(session, "build_route_model", lambda *_: object())
    monkeypatch.setattr(session, "estimate_times", lambda *_: object())
    monkeypatch.setattr(
        session,
        "to_start_response",
        lambda simulation_id, *_: SimulationStartResponse.model_validate(
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
        ),
    )
    monkeypatch.setattr(session, "SimulationEngine", _Engine)
    return SessionManager(
        object(),
        SimulationSettings(),
        _Gateway(),  # type: ignore[arg-type]
        clock=lambda: datetime(2026, 10, 16, tzinfo=UTC),
        sleep=_sleep_forever,
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
    manager: SessionManager, monkeypatch: pytest.MonkeyPatch
) -> None:
    import greenwave.simulation.session as session

    monkeypatch.setattr(session, "SimulationEngine", _CompletingEngine)
    await manager.start(_request("first"))
    await asyncio.sleep(0)

    await manager.start(_request("second"))

    stream = manager.subscribe("first")
    event = await anext(stream)
    assert isinstance(event, SimulationCompletedEvent)
    await manager.shutdown()


@pytest.mark.asyncio
async def test_failed_replacement_keeps_active_session(
    manager: SessionManager, monkeypatch: pytest.MonkeyPatch
) -> None:
    import greenwave.simulation.session as session

    await manager.start(_request("first"))
    monkeypatch.setattr(
        session,
        "plan_route",
        lambda *_: (_ for _ in ()).throw(OriginOffNetwork("outside network")),
    )

    with pytest.raises(OriginOffNetwork):
        await manager.start(_request("invalid"))

    assert manager.exists("first")
    assert manager._active is not None
    assert manager._active.simulation_id == "first"
    await manager.shutdown()


def test_full_subscriber_queue_makes_room_for_terminal_event() -> None:
    queue: asyncio.Queue[object] = asyncio.Queue(maxsize=1)
    queue.put_nowait(object())
    terminal = SimulationCancelledEvent(
        schema_version="1.0",
        is_simulated=True,
        event_type="SIMULATION_CANCELLED",
        simulation_id="SIM-1",
        tick=1,
        timestamp=datetime(2026, 10, 16, tzinfo=UTC),
        reason=CancelReason.STOPPED,
    )

    SessionManager._put(queue, terminal, terminal=True)

    assert queue.get_nowait() is terminal


class _FailingEngine(_Engine):
    def run_tick(
        self, state: SimpleNamespace, _: datetime, __: int
    ) -> tuple[SimpleNamespace, list[object]]:
        raise RuntimeError("engine bug")


@pytest.mark.asyncio
async def test_engine_failure_is_logged_with_the_simulation_id(
    manager: SessionManager, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """An unlogged loop crash leaves a silent, frozen run that nobody can diagnose."""
    import greenwave.simulation.session as session

    monkeypatch.setattr(session, "SimulationEngine", _FailingEngine)
    with caplog.at_level("ERROR", logger="greenwave.simulation.session"):
        await manager.start(_request("first"))
        await asyncio.sleep(0)

    [record] = [r for r in caplog.records if r.getMessage() == "simulation_loop_failed"]
    assert record.exc_info is not None
    assert getattr(record, "simulation_id", None) == "first"
    await manager.shutdown()


def test_full_subscriber_queue_drops_the_oldest_tick_for_a_new_tick() -> None:
    queue: asyncio.Queue[object] = asyncio.Queue(maxsize=2)
    oldest, newer, newest = object(), object(), object()
    queue.put_nowait(oldest)
    queue.put_nowait(newer)

    SessionManager._put(queue, newest, terminal=False)  # type: ignore[arg-type]

    assert [queue.get_nowait(), queue.get_nowait()] == [newer, newest]
