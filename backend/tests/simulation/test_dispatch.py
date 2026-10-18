from dataclasses import replace
from datetime import UTC, datetime, timedelta

from greenwave.simulation import dispatch
from greenwave.simulation.dispatch import build_dispatch_payload, dispatch_event
from greenwave.simulation.route_model import RouteIntersection, RouteModel
from greenwave.simulation.state import EngineState
from greenwave.simulation.state_machine import IntersectionRuntime
from greenwave.simulation_settings import SimulationSettings

_NOW = datetime(2026, 10, 17, tzinfo=UTC)


def _model() -> RouteModel:
    return RouteModel(
        intersections=(
            RouteIntersection("NEAR", 4.2, 4.2, 10.0),
            RouteIntersection("FAR", 9.1, 9.1, 10.0),
        ),
        _cascade_targets={},
    )


def _state() -> EngineState:
    return EngineState(
        simulated_time_s=3,
        distance_travelled_m=0.0,
        current_edge_index=0,
        dwell_remaining_s=0.0,
        dwelling_intersection_id=None,
        v_avg_meters_per_second=1.0,
        intersection_runtimes=(IntersectionRuntime(), IntersectionRuntime()),
        tick=3,
        message_sequence=2,
        arrived=False,
        completed=False,
    )


def test_payload_holds_until_last_member_plus_buffer() -> None:
    settings = SimulationSettings()

    payload = build_dispatch_payload(_model(), _state(), ("FAR", "NEAR"), _NOW, settings)

    assert payload.hold_duration_sec == max(
        settings.its_min_hold_seconds, 10 + settings.its_hold_buffer_seconds
    )
    assert payload.expected_arrival_utc == _NOW + timedelta(seconds=4.2)
    assert payload.intersections_group == ["FAR", "NEAR"]


def test_event_uses_the_state_message_sequence_and_tick() -> None:
    payload = build_dispatch_payload(_model(), _state(), ("NEAR",), _NOW, SimulationSettings())

    event = dispatch_event("SIM-1", replace(_state(), message_sequence=3), payload, _NOW)

    assert event.message_id == "MSG-ITS-3"
    assert event.tick == 3
    assert event.payload is payload


def test_dispatch_builders_do_not_touch_the_gateway() -> None:
    assert "ItsGateway" not in vars(dispatch)
