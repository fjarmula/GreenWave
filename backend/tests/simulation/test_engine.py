from datetime import UTC, datetime
from math import cos, radians

import pytest

from greenwave.its import MockItsGateway
from greenwave.routing.estimates import Estimates, estimate_times
from greenwave.routing.planner import PlannedRoute, SnappedRouteEndpoint
from greenwave.schemas import Position, SimulationTickEvent
from greenwave.simulation.engine import SimulationEngine
from greenwave.simulation.route_model import RouteIntersection, RouteModel
from greenwave.simulation_settings import SimulationSettings


def engine_for_single_stop() -> SimulationEngine:
    route = PlannedRoute(
        edge_ids=("first", "second"),
        edge_lengths_m=(100.0, 100.0),
        edge_speeds_kmh=(36.0, 36.0),
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
        edge_speeds_kmh=(36.0, 36.0),
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


def test_time_saved_on_arrival_uses_the_traffic_density_multiplier() -> None:
    """D15: on arrival the normal-mode time covered is T_normal, scaled by the multiplier."""
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

    assert tick.kpi_metrics.total_time_elapsed_sec == state.simulated_time_s
    assert tick.kpi_metrics.current_time_saved_sec == round(
        estimates.normal_seconds - state.simulated_time_s
    )


def test_step_advances_at_current_edge_speed_and_dwells_at_stop_line() -> None:
    engine = engine_for_single_stop()
    state = engine.initial_state()
    now = datetime(2026, 10, 16, tzinfo=UTC)

    for _ in range(4):
        state, _ = engine.step(state, now)
    assert state.distance_travelled_m == 50.0
    assert state.dwell_remaining_s == 3

    state, events = engine.step(state, now)
    assert state.distance_travelled_m == 50.0
    assert state.dwell_remaining_s == 2
    assert events[-1].ambulance.speed_kmh == 0.0


def test_own_clear_cascades_once_and_batches_its_dispatch() -> None:
    engine = engine_for_single_stop()
    state, events = engine.step(engine.initial_state(), datetime(2026, 10, 16, tzinfo=UTC))

    assert state.intersection_runtimes[0].state.value == "CLEARING"
    assert events[0].event_type == "ITS_DISPATCH"
    assert events[0].payload.intersections_group == ["INT-1"]
    assert events[0].payload.hold_duration_sec == 40


def test_playback_returns_only_last_tick_and_keeps_terminal_events() -> None:
    engine = engine_for_single_stop()
    state, events = engine.run_tick(
        engine.initial_state(), datetime(2026, 10, 16, tzinfo=UTC), playback_speed=10
    )

    assert state.tick == 10
    assert sum(event.event_type == "SIMULATION_TICK" for event in events) == 1
