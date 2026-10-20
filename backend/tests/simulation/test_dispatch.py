from dataclasses import replace
from datetime import UTC, datetime, timedelta

from tests.support.route_fixtures import corridor_index, position_at

from greenwave.its import MockItsGateway
from greenwave.schemas import SimulationStartRequest, VehicleType
from greenwave.simulation import dispatch
from greenwave.simulation.assembly import plan_simulation
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

    payload = build_dispatch_payload(
        _model(), _state(), ("FAR", "NEAR"), _NOW, settings, VehicleType.AMBULANCE
    )

    assert payload.hold_duration_sec == max(
        settings.its_min_hold_seconds, 10 + settings.its_hold_buffer_seconds
    )
    assert payload.expected_arrival_utc == _NOW + timedelta(seconds=4.2)
    assert payload.intersections_group == ["FAR", "NEAR"]


def test_event_uses_the_state_message_sequence_and_tick() -> None:
    payload = build_dispatch_payload(
        _model(), _state(), ("NEAR",), _NOW, SimulationSettings(), VehicleType.AMBULANCE
    )

    event = dispatch_event("SIM-1", replace(_state(), message_sequence=3), payload, _NOW)

    assert event.message_id == "MSG-ITS-3"
    assert event.tick == 3
    assert event.payload is payload


def test_dispatch_builders_do_not_touch_the_gateway() -> None:
    assert "ItsGateway" not in vars(dispatch)


def test_its_payload_carries_vehicle_type() -> None:
    x = 7_421_000.0
    request = SimulationStartRequest.model_validate(
        {
            "simulation_id": "SIM-fire",
            "origin": position_at(x + 1_000).model_dump(),
            "destination": position_at(x + 1_850.02).model_dump(),
            "traffic_density_multiplier": 1.0,
            "enable_cascade_mode": True,
            "vehicle_type": "FIRE_TRUCK",
        }
    )
    engine = plan_simulation(
        corridor_index(), request, SimulationSettings(), MockItsGateway()
    ).engine
    state, payloads = engine.initial_state(), []
    while not state.completed:
        state, events = engine.step(state, _NOW)
        payloads += [e.payload for e in events if e.event_type == "ITS_DISPATCH"]

    assert payloads
    assert {p.vehicle_type for p in payloads} == {VehicleType.FIRE_TRUCK}
