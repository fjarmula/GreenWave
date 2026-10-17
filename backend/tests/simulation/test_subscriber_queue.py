import asyncio
from datetime import UTC, datetime

from greenwave.schemas import (
    CancelReason,
    KpiMetrics,
    SimulationCancelledEvent,
    SimulationCompletedEvent,
    SimulationTickEvent,
)
from greenwave.simulation.events import SimulationEvent, is_terminal
from greenwave.simulation.subscriber_queue import offer

_NOW = datetime(2026, 10, 16, tzinfo=UTC)
_KPI = KpiMetrics(current_time_saved_sec=0, total_time_elapsed_sec=1)


def _cancelled() -> SimulationCancelledEvent:
    return SimulationCancelledEvent(
        schema_version="1.0",
        is_simulated=True,
        event_type="SIMULATION_CANCELLED",
        simulation_id="SIM-1",
        tick=1,
        timestamp=_NOW,
        reason=CancelReason.STOPPED,
    )


def _completed() -> SimulationCompletedEvent:
    return SimulationCompletedEvent(
        schema_version="1.0",
        is_simulated=True,
        event_type="SIMULATION_COMPLETED",
        simulation_id="SIM-1",
        tick=1,
        timestamp=_NOW,
        kpi_metrics=_KPI,
    )


def _tick(tick: int) -> SimulationTickEvent:
    return SimulationTickEvent.model_validate(
        {
            "schema_version": "1.0",
            "is_simulated": True,
            "event_type": "SIMULATION_TICK",
            "simulation_id": "SIM-1",
            "tick": tick,
            "timestamp": _NOW,
            "ambulance": {
                "id": "SIM-1",
                "position": {"lat": 50.0, "lng": 19.0},
                "speed_kmh": 0.0,
                "status": "EN_ROUTE",
            },
            "kpi_metrics": _KPI,
            "intersections": [],
        }
    )


def _drain(queue: asyncio.Queue[SimulationEvent]) -> list[SimulationEvent]:
    return [queue.get_nowait() for _ in range(queue.qsize())]


def test_full_subscriber_queue_makes_room_for_terminal_event() -> None:
    queue: asyncio.Queue[SimulationEvent] = asyncio.Queue(maxsize=1)
    queue.put_nowait(_tick(1))
    terminal = _cancelled()

    offer(queue, terminal)

    assert queue.get_nowait() is terminal


def test_offer_drops_oldest_tick_for_a_new_tick() -> None:
    queue: asyncio.Queue[SimulationEvent] = asyncio.Queue(maxsize=2)
    queue.put_nowait(_tick(1))
    queue.put_nowait(_tick(2))

    offer(queue, _tick(3))

    assert [event.tick for event in _drain(queue)] == [2, 3]


def test_offer_keeps_existing_terminal_and_drops_a_tick() -> None:
    queue: asyncio.Queue[SimulationEvent] = asyncio.Queue(maxsize=2)
    completed, cancelled = _completed(), _cancelled()
    queue.put_nowait(_tick(1))
    queue.put_nowait(completed)

    offer(queue, cancelled)

    assert _drain(queue) == [completed, cancelled]


def test_only_cancelled_and_completed_are_terminal() -> None:
    assert is_terminal(_cancelled())
    assert is_terminal(_completed())
    assert not is_terminal(_tick(1))
