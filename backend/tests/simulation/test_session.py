import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from greenwave.routing.errors import OriginOffNetwork
from greenwave.schemas import (
    CancelReason,
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
    def run_tick(
        self, state: SimpleNamespace, _: datetime, __: int
    ) -> tuple[SimpleNamespace, list[object]]:
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
