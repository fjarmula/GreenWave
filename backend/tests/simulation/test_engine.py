from datetime import UTC, datetime
from math import cos, radians

import pytest
from tests.support.route_fixtures import (
    corridor_index,
    neutral_settings,
    position_at,
    route_edges,
)

from greenwave.its import MockItsGateway
from greenwave.routing.estimates import Estimates, estimate_times
from greenwave.routing.planner import PlannedRoute, SnappedRouteEndpoint, plan_route
from greenwave.schemas import Position, SimulationTickEvent, VehicleType
from greenwave.simulation.engine import SimulationEngine
from greenwave.simulation.route_model import RouteIntersection, RouteModel, build_route_model
from greenwave.simulation_settings import SimulationSettings


def engine_for_single_stop() -> SimulationEngine:
    route = PlannedRoute(
        edge_ids=("first", "second"),
        edge_lengths_m=(100.0, 100.0),
        edges=route_edges(("first", "second"), (100.0, 100.0), (36.0, 36.0)),
        cumulative_m=(0.0, 100.0),
        total_distance_m=200.0,
        polyline_wgs84=[(19.0, 50.0), (19.1, 50.0)],
        origin_snap=SnappedRouteEndpoint("origin", Position(lat=50.0, lng=19.0), 0),
        destination_snap=SnappedRouteEndpoint("destination", Position(lat=50.0, lng=19.1), 0),
        stop_lines=(),
    )
    model = RouteModel(
        intersections=(RouteIntersection("INT-1", 50.0, 50.0, 35.0),),
        _cascade_targets={},
    )
    return SimulationEngine(
        "SIM-1",
        route,
        model,
        Estimates(normal_seconds=55.0, greenwave_seconds=23.0),
        1.0,
        SimulationSettings(),
        MockItsGateway(),
    )


_METERS_PER_DEGREE_LAT = 111_320.0
_LNG_SCALE = cos(radians(50.0))


def _local_xy(lng: float, lat: float) -> tuple[float, float]:
    return (lng - 19.0) * _METERS_PER_DEGREE_LAT * _LNG_SCALE, (lat - 50.0) * _METERS_PER_DEGREE_LAT


def engine_for_l_shaped_route() -> SimulationEngine:
    """Two 100 m legs, north then east: the origin-destination chord cuts the corner by ~71 m."""
    leg_lat = 100.0 / _METERS_PER_DEGREE_LAT
    leg_lng = 100.0 / (_METERS_PER_DEGREE_LAT * _LNG_SCALE)
    route = PlannedRoute(
        edge_ids=("north", "east"),
        edge_lengths_m=(100.0, 100.0),
        edges=route_edges(("north", "east"), (100.0, 100.0), (36.0, 36.0)),
        cumulative_m=(0.0, 100.0),
        total_distance_m=200.0,
        polyline_wgs84=[(19.0, 50.0), (19.0, 50.0 + leg_lat), (19.0 + leg_lng, 50.0 + leg_lat)],
        origin_snap=SnappedRouteEndpoint("origin", Position(lat=50.0, lng=19.0), 0),
        destination_snap=SnappedRouteEndpoint(
            "destination", Position(lat=50.0 + leg_lat, lng=19.0 + leg_lng), 0
        ),
        stop_lines=(),
    )
    return SimulationEngine(
        "SIM-L",
        route,
        RouteModel(intersections=(), _cascade_targets={}),
        Estimates(normal_seconds=20.0, greenwave_seconds=16.0),
        1.0,
        SimulationSettings(),
        MockItsGateway(),
    )


def test_ambulance_position_follows_the_route_polyline() -> None:
    engine = engine_for_l_shaped_route()
    state = engine.initial_state()
    now = datetime(2026, 10, 16, tzinfo=UTC)

    samples: list[tuple[float, Position]] = []
    while not state.arrived:
        state, events = engine.step(state, now)
        tick = next(event for event in events if isinstance(event, SimulationTickEvent))
        samples.append((state.distance_travelled_m, tick.ambulance.position))

    assert len(samples) > 2
    for distance, position in samples:
        x, y = _local_xy(position.lng, position.lat)
        # Up the north leg (x = 0) for the first 100 m, then along the east leg (y = 100).
        expected = (0.0, distance) if distance <= 100.0 else (distance - 100.0, 100.0)
        assert x == pytest.approx(expected[0], abs=0.5)
        assert y == pytest.approx(expected[1], abs=0.5)


def test_time_saved_on_arrival_uses_the_standard_run_at_the_selected_density() -> None:
    """The same standard-motion baseline is used by pre-flight and final savings."""
    multiplier = 2.0
    settings = SimulationSettings()
    template = engine_for_single_stop()
    estimates = estimate_times(template.route, template.route_model, multiplier, settings)
    engine = SimulationEngine(
        "SIM-2",
        template.route,
        template.route_model,
        estimates,
        multiplier,
        settings,
        MockItsGateway(),
    )
    state = engine.initial_state()
    now = datetime(2026, 10, 16, tzinfo=UTC)

    while not state.arrived:
        state, events = engine.step(state, now)
    tick = next(event for event in events if isinstance(event, SimulationTickEvent))

    assert tick.kpi_metrics.current_time_saved_sec == 35 - tick.kpi_metrics.total_time_elapsed_sec


def engine_for_mixed_speeds(multiplier: float = 1.0) -> SimulationEngine:
    """10 m at 36 km/h (13 m/s ambulance), then 190 m at 72 km/h (25 m/s); a signal 5 m from
    the end, so its 15 s recovery outlasts arrival."""
    route = PlannedRoute(
        edge_ids=("slow", "fast"),
        edge_lengths_m=(10.0, 190.0),
        edges=route_edges(("slow", "fast"), (10.0, 190.0), (36.0, 72.0)),
        cumulative_m=(0.0, 10.0),
        total_distance_m=200.0,
        polyline_wgs84=[(19.0, 50.0), (19.003, 50.0)],
        origin_snap=SnappedRouteEndpoint("origin", Position(lat=50.0, lng=19.0), 0),
        destination_snap=SnappedRouteEndpoint("destination", Position(lat=50.0, lng=19.003), 0),
        stop_lines=(),
    )
    model = RouteModel(
        intersections=(RouteIntersection("INT-END", 195.0, 195.0, 20.0),),
        _cascade_targets={},
    )
    settings = SimulationSettings()
    return SimulationEngine(
        "SIM-MIX",
        route,
        model,
        estimate_times(route, model, multiplier, settings),
        multiplier,
        settings,
        MockItsGateway(),
    )


def test_a_step_carries_its_remaining_time_onto_the_next_edge() -> None:
    """D13: 10 m at 13 m/s takes 10/13 s; the other 3/13 s is driven at 25 m/s."""
    engine = engine_for_mixed_speeds()

    state, _ = engine.step(engine.initial_state(), datetime(2026, 10, 16, tzinfo=UTC))

    assert state.distance_travelled_m == pytest.approx(10.0 + 25.0 * 3.0 / 13.0)


def test_kpi_ends_at_standard_minus_greenwave_and_holds_through_recovery() -> None:
    """D13 + D15: arrival lands on T_greenwave, and recovery ticks after it do not erode the KPI."""
    engine = engine_for_mixed_speeds(multiplier=1.5)
    expected_saved = 2  # Standard includes the shared 3 s delay as well as cautious crossing.
    expected_elapsed = round(engine.estimates.greenwave_seconds)
    state = engine.initial_state()
    now = datetime(2026, 10, 16, tzinfo=UTC)

    arrived_ticks: list[SimulationTickEvent] = []
    while not state.completed:
        state, events = engine.step(state, now)
        tick = next(event for event in events if isinstance(event, SimulationTickEvent))
        if state.arrived:
            arrived_ticks.append(tick)

    assert len(arrived_ticks) > 1, "recovery should outlast arrival in this fixture"
    for tick in arrived_ticks:
        assert tick.kpi_metrics.current_time_saved_sec == expected_saved
        assert tick.kpi_metrics.total_time_elapsed_sec == expected_elapsed


def test_step_rolls_d_min_before_the_stop_line_at_current_edge_speed() -> None:
    engine = engine_for_single_stop()
    state = engine.initial_state()
    now = datetime(2026, 10, 16, tzinfo=UTC)
    # The 50 m stop line is inside the 60 m approach, so D_min = 3 s is spread over [0, 50] at
    # 13 m/s: 50 m take 50/13 + 3 s, then open road at 13 m/s (no stop).
    slow_mps = 50 / (50 / 13 + 3)

    state, events = engine.step(state, now)
    assert state.distance_travelled_m == pytest.approx(slow_mps)
    assert events[-1].ambulance.speed_kmh == pytest.approx(slow_mps * 3.6)
    assert events[-1].ambulance.status == "CROSSING_INTERSECTION"
    for _ in range(6):
        state, events = engine.step(state, now)
    assert state.dwell_remaining_s == 0.0
    assert state.distance_travelled_m == pytest.approx(50 + 13 * (7 - (50 / 13 + 3)))
    assert events[-1].ambulance.speed_kmh > 0


def test_own_clear_cascades_once_and_batches_its_dispatch() -> None:
    engine = engine_for_single_stop()
    state, events = engine.step(engine.initial_state(), datetime(2026, 10, 16, tzinfo=UTC))

    assert state.intersection_runtimes[0].state.value == "NORMAL"
    assert events[0].event_type == "ITS_DISPATCH"
    assert events[0].payload.intersections_group == ["INT-1"]
    assert events[0].payload.hold_duration_sec == 40


def test_calming_reaches_the_estimate_the_motion_and_the_hold_alike() -> None:
    """Calming seconds reach the estimate, the simulated motion and the hold (one edge-time
    model), so a multi-line junction behind calmed edges no longer outlives its hold."""
    settings = neutral_settings(ambulance_calming_seconds=2.0)
    index = corridor_index({"corridor-twin-1": {"calming_count": 3}})
    # Ends past INT-B: a route ending on a stop line arrives before that last D_min dwell.
    origin, destination = position_at(7_422_000), position_at(7_422_950.02)
    route = plan_route(index, origin, destination, settings)
    model = build_route_model(route, index, settings, cascade_enabled=True)
    estimates = estimate_times(route, model, 1.0, settings)
    neutral = estimate_times(route, model, 1.0, neutral_settings())
    engine = SimulationEngine("SIM-CALM", route, model, estimates, 1.0, settings, MockItsGateway())
    state = engine.initial_state()

    while not state.completed:
        state, events = engine.step(state, datetime(2026, 10, 19, tzinfo=UTC))

    assert len(model.intersections) == 4  # D_min is part of both numbers
    assert estimates.greenwave_seconds == pytest.approx(neutral.greenwave_seconds + 6.0)
    assert events[-1].event_type == "SIMULATION_COMPLETED"


def test_ticks_identify_the_dispatched_vehicle_type_not_the_simulation() -> None:
    """The dashboard shows ``ambulance.id``; a police run must not show the run's UUID."""
    single = engine_for_single_stop()
    engine = SimulationEngine(
        "SIM-1",
        single.route,
        single.route_model,
        single.estimates,
        1.0,
        SimulationSettings(),
        MockItsGateway(),
        VehicleType.POLICE_CAR,
    )
    state = engine.initial_state()
    ids: set[str] = set()
    for _ in range(3):
        state, events = engine.step(state, datetime(2026, 10, 22, tzinfo=UTC))
        ids |= {event.ambulance.id for event in events if isinstance(event, SimulationTickEvent)}

    assert ids == {"POL-KRA-01"}
