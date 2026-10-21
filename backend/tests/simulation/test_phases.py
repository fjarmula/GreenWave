from dataclasses import replace

import pytest
from pydantic import ValidationError
from tests.support.route_fixtures import corridor_index, position_at, signal_ref

from greenwave.routing.network_index import RoutingIndex
from greenwave.routing.planner import plan_route
from greenwave.schemas import (
    IntersectionState,
    SignalMovementKind,
    SignalPhaseColor,
    SignalPhaseIndicator,
)
from greenwave.simulation.phases import project_signal_phases
from greenwave.simulation.route_model import RouteModel, build_route_model
from greenwave.simulation.state import EngineState
from greenwave.simulation.state_machine import IntersectionRuntime
from greenwave.simulation_settings import SimulationSettings

_X, _Y = 7_421_000.0, 5_541_000.0
GREEN, YELLOW, RED = SignalPhaseColor.GREEN, SignalPhaseColor.YELLOW, SignalPhaseColor.RED
VEHICLE, PEDESTRIAN = SignalMovementKind.VEHICLE, SignalMovementKind.PEDESTRIAN
# 20 s green + 3 s yellow + 2 s all-red per group; two groups make a 50 s cycle.
SETTINGS = SimulationSettings(
    signal_green_seconds=20, signal_yellow_seconds=3, signal_all_red_seconds=2
)
# INT-A: sig-a controls the route's approach edge; sig-a-cross controls the crossing street.
SIGNALS = {
    "INT-A": (
        signal_ref("INT-A", "sig-a", _X + 1_095, _Y + 5, "corridor-a"),
        signal_ref("INT-A", "sig-a-cross", _X + 1_105, _Y - 5, "cross-street"),
    )
}


def _model(index: RoutingIndex) -> RouteModel:
    route = plan_route(index, position_at(_X + 1_000), position_at(_X + 1_850.02), SETTINGS)
    return build_route_model(route, index, SETTINGS, cascade_enabled=False)


def _state(model: RouteModel, now_s: int, int_a: IntersectionState) -> EngineState:
    runtimes = [IntersectionRuntime() for _ in model.intersections]
    runtimes[0] = IntersectionRuntime(state=int_a)
    return EngineState(
        simulated_time_s=now_s,
        distance_travelled_m=0.0,
        current_edge_index=0,
        dwell_remaining_s=0.0,
        dwelling_intersection_id=None,
        v_avg_meters_per_second=10.0,
        intersection_runtimes=tuple(runtimes),
        tick=now_s,
        message_sequence=0,
        arrived=False,
        completed=False,
    )


def _colors(
    now_s: int, state: IntersectionState = IntersectionState.NORMAL
) -> dict[tuple[str, SignalMovementKind], SignalPhaseColor]:
    model = _model(corridor_index(signal_approaches=SIGNALS))
    phases = project_signal_phases(model, _state(model, now_s, state), SETTINGS)
    return {(item.signal_key, item.kind): item.color for item in phases}


def _phases(now_s: int = 0) -> list[SignalPhaseIndicator]:
    model = _model(corridor_index(signal_approaches=SIGNALS))
    return project_signal_phases(model, _state(model, now_s, IntersectionState.NORMAL), SETTINGS)


@pytest.mark.parametrize(
    ("now_s", "route_vehicle", "cross_vehicle", "route_pedestrian", "cross_pedestrian"),
    [
        (0, GREEN, RED, RED, GREEN),  # first group (route arm) green; walkers cross the other arm
        (19, GREEN, RED, RED, GREEN),
        (20, YELLOW, RED, RED, RED),  # explicit yellow, never inferred by the UI
        (23, RED, RED, RED, RED),  # all-red clearance
        (25, RED, GREEN, GREEN, RED),  # second group green
        (45, RED, YELLOW, RED, RED),
        (48, RED, RED, RED, RED),
        (50, GREEN, RED, RED, GREEN),  # cycle repeats
    ],
)
def test_normal_cycle_alternates_two_movement_groups(
    now_s: int,
    route_vehicle: SignalPhaseColor,
    cross_vehicle: SignalPhaseColor,
    route_pedestrian: SignalPhaseColor,
    cross_pedestrian: SignalPhaseColor,
) -> None:
    assert _colors(now_s) == {
        ("sig-a", VEHICLE): route_vehicle,
        ("sig-a-cross", VEHICLE): cross_vehicle,
        ("sig-a", PEDESTRIAN): route_pedestrian,
        ("sig-a-cross", PEDESTRIAN): cross_pedestrian,
    }


def test_a_pedestrian_crossing_is_never_green_with_its_vehicle_arm() -> None:
    """Walkers on green across moving vehicles would contradict the explanatory model."""
    for now_s in range(100):
        colors = _colors(now_s)
        for key in ("sig-a", "sig-a-cross"):
            if colors[(key, PEDESTRIAN)] is GREEN:
                assert colors[(key, VEHICLE)] is RED
        assert RED in (colors[("sig-a", VEHICLE)], colors[("sig-a-cross", VEHICLE)])
        assert all(color in {GREEN, YELLOW, RED} for color in colors.values())
        assert {colors[(key, PEDESTRIAN)] for key in ("sig-a", "sig-a-cross")} <= {GREEN, RED}


@pytest.mark.parametrize("now_s", [0, 20, 23, 30, 47])
def test_priority_green_gives_the_route_approach_green_and_holds_conflicts_red(
    now_s: int,
) -> None:
    assert _colors(now_s, IntersectionState.PRIORITY_GREEN) == {
        ("sig-a", VEHICLE): GREEN,
        ("sig-a-cross", VEHICLE): RED,
        ("sig-a", PEDESTRIAN): RED,
        ("sig-a-cross", PEDESTRIAN): RED,
    }


def test_clearing_ends_conflicting_green_with_yellow_and_stops_pedestrians() -> None:
    assert _colors(30, IntersectionState.CLEARING) == {
        ("sig-a", VEHICLE): RED,  # the route arm keeps its cycle colour until PRIORITY_GREEN
        ("sig-a-cross", VEHICLE): YELLOW,
        ("sig-a", PEDESTRIAN): RED,
        ("sig-a-cross", PEDESTRIAN): RED,
    }
    assert _colors(10, IntersectionState.CLEARING)[("sig-a", VEHICLE)] is GREEN
    assert _colors(10, IntersectionState.CLEARING)[("sig-a-cross", VEHICLE)] is RED


@pytest.mark.parametrize("now_s", [0, 20, 30])
def test_recovery_returns_to_the_normal_cycle(now_s: int) -> None:
    assert _colors(now_s, IntersectionState.RECOVERY) == _colors(now_s)


def test_indicators_use_the_signal_positions_and_say_they_are_simulated() -> None:
    phases = _phases()
    by_key = {(item.signal_key, item.kind): item for item in phases}
    for ref in SIGNALS["INT-A"]:
        for kind in (VEHICLE, PEDESTRIAN):
            item = by_key[(ref.signal_key, kind)]
            assert item.intersection_id == "INT-A"
            assert (item.position.lng, item.position.lat) == (ref.lon, ref.lat)
            assert item.accessible_label.startswith("Simulated")
            assert item.color.lower() in item.accessible_label
    assert [(item.signal_key, item.kind) for item in phases] == [
        ("sig-a", VEHICLE),
        ("sig-a", PEDESTRIAN),
        ("sig-a-cross", VEHICLE),
        ("sig-a-cross", PEDESTRIAN),
    ]


def test_intersections_without_signal_geometry_produce_no_indicators() -> None:
    model = _model(corridor_index())
    assert project_signal_phases(model, _state(model, 0, IntersectionState.NORMAL), SETTINGS) == []


def test_projection_is_deterministic() -> None:
    assert _phases(37) == _phases(37)


def test_route_model_records_the_approach_edges_and_signals_of_each_intersection() -> None:
    model = _model(corridor_index(signal_approaches=SIGNALS))
    first = model.intersections[0]
    assert first.approach_edge_ids == ("corridor-a",)
    assert first.signals == SIGNALS["INT-A"]
    assert model.intersections[1].signals == ()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("signal_green_seconds", 0),
        ("signal_yellow_seconds", -1),
        ("signal_all_red_seconds", -1),
    ],
)
def test_phase_durations_reject_invalid_values(field: str, value: float) -> None:
    with pytest.raises(ValidationError):
        SimulationSettings(**{field: value})


def test_a_passed_intersection_follows_the_normal_cycle() -> None:
    model = _model(corridor_index(signal_approaches=SIGNALS))
    state = _state(model, 0, IntersectionState.NORMAL)
    passed = replace(
        state,
        intersection_runtimes=(
            IntersectionRuntime(passed=True),
            *state.intersection_runtimes[1:],
        ),
    )
    assert project_signal_phases(model, passed, SETTINGS) == project_signal_phases(
        model, state, SETTINGS
    )


def test_engine_ticks_carry_the_projected_phases() -> None:
    """The map must receive phases only through the tick contract."""
    from datetime import UTC, datetime

    from greenwave.its import MockItsGateway
    from greenwave.routing.estimates import estimate_times
    from greenwave.simulation.engine import SimulationEngine

    index = corridor_index(signal_approaches=SIGNALS)
    route = plan_route(index, position_at(_X + 1_000), position_at(_X + 1_850.02), SETTINGS)
    model = build_route_model(route, index, SETTINGS, cascade_enabled=False)
    engine = SimulationEngine(
        "SIM-phases",
        route,
        model,
        estimate_times(route, model, 1.0, SETTINGS),
        1.0,
        SETTINGS,
        MockItsGateway(),
    )

    state, events = engine.step(engine.initial_state(), datetime(2026, 10, 21, tzinfo=UTC))

    tick = next(event for event in events if event.event_type == "SIMULATION_TICK")
    assert tick.signal_phases == project_signal_phases(model, state, SETTINGS)
    assert len(tick.signal_phases) == 4
