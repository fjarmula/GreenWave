from datetime import UTC, datetime

from greenwave.its import MockItsGateway
from greenwave.routing.estimates import Estimates
from greenwave.routing.planner import PlannedRoute, SnappedRouteEndpoint
from greenwave.schemas import Position
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
        SimulationSettings(),
        MockItsGateway(),
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
