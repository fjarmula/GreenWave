import json
from datetime import UTC, datetime

from greenwave.api.sse import event_frame, retry_frame
from greenwave.schemas import (
    AmbulanceStatus,
    AmbulanceTelemetry,
    IntersectionState,
    IntersectionTelemetry,
    KpiMetrics,
    Position,
    SignalMovementKind,
    SignalPhaseColor,
    SignalPhaseIndicator,
    SimulationTickEvent,
)


def _tick() -> SimulationTickEvent:
    return SimulationTickEvent(
        schema_version="1.0",
        is_simulated=True,
        event_type="SIMULATION_TICK",
        simulation_id="SIM-1",
        tick=1,
        timestamp=datetime(2026, 10, 16, tzinfo=UTC),
        ambulance=AmbulanceTelemetry(
            id="AMB-1",
            position=Position(lat=50.0, lng=19.0),
            speed_kmh=30,
            status=AmbulanceStatus.EN_ROUTE,
        ),
        kpi_metrics=KpiMetrics(current_time_saved_sec=0, total_time_elapsed_sec=1),
        intersections=[
            IntersectionTelemetry(
                id="INT-1",
                name=None,
                state=IntersectionState.NORMAL,
                is_cascade=False,
                tti_seconds=30,
                is_active_corridor=False,
            )
        ],
        signal_phases=[
            SignalPhaseIndicator(
                intersection_id="INT-1",
                signal_key="INT-1:S1",
                kind=SignalMovementKind.VEHICLE,
                color=SignalPhaseColor.RED,
                position=Position(lat=50.0001, lng=19.0001),
                accessible_label="Simulated vehicle signal INT-1:S1: red",
            )
        ],
    )


def test_sse_event_frame_uses_contract_event_type_tick_and_json() -> None:
    frame = event_frame(_tick())

    assert frame.startswith("event: SIMULATION_TICK\nid: 1\ndata: {")
    assert frame.endswith("\n\n")
    assert '"simulation_id":"SIM-1"' in frame


def test_sse_retry_frame_is_first_control_frame() -> None:
    assert retry_frame() == "retry: 2000\n\n"


def test_sse_tick_frame_carries_signal_phases() -> None:
    frame = event_frame(_tick())
    data = json.loads(frame.split("data: ", 1)[1])
    assert data["signal_phases"][0]["color"] == "RED"
    assert data["signal_phases"][0]["kind"] == "VEHICLE"
