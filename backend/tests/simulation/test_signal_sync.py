"""The shown route light and the ambulance stay in step: with ER Green Wave enabled the ambulance
never leaves or passes a stop line unless the light it faces was last shown green, and priority is
held while it waits at the line. A light turning yellow or red under a waiting ambulance would show
it driving through red on the map.
"""

from datetime import UTC, datetime

import pytest
from tests.support.route_fixtures import corridor_index, position_at, signal_ref

from greenwave.its import MockItsGateway
from greenwave.routing.estimates import estimate_times
from greenwave.routing.planner import plan_route
from greenwave.schemas import IntersectionState, SignalPhaseColor, SimulationTickEvent
from greenwave.simulation.engine import SimulationEngine
from greenwave.simulation.route_model import build_route_model
from greenwave.simulation_settings import SimulationSettings

_X, _Y = 7_421_000.0, 5_541_000.0
_NOW = datetime(2026, 10, 21, tzinfo=UTC)
# Each corridor intersection: its route signal(s) plus one crossing-street signal.
SIGNALS = {
    "INT-A": (
        signal_ref("INT-A", "sig-a", _X + 1_100, _Y, "corridor-a"),
        signal_ref("INT-A", "sig-a-x", _X + 1_100, _Y + 5, "a-cross"),
    ),
    "INT-TWIN": (
        signal_ref("INT-TWIN", "sig-twin-1", _X + 1_350, _Y, "corridor-twin-1"),
        signal_ref("INT-TWIN", "sig-twin-2", _X + 1_600.01, _Y, "corridor-twin-2"),
        signal_ref("INT-TWIN", "sig-twin-x", _X + 1_350, _Y + 5, "twin-cross"),
    ),
    "INT-C": (
        signal_ref("INT-C", "sig-c", _X + 1_600.01, _Y, "corridor-twin-2"),
        signal_ref("INT-C", "sig-c-x", _X + 1_600.01, _Y + 5, "c-cross"),
    ),
    "INT-B": (
        signal_ref("INT-B", "sig-b", _X + 1_850.02, _Y, "corridor-b"),
        signal_ref("INT-B", "sig-b-x", _X + 1_850.02, _Y + 5, "b-cross"),
    ),
}


def _run(
    origin_x: float, settings: SimulationSettings, cascade: bool
) -> tuple[SimulationEngine, list[tuple[float, SimulationTickEvent]]]:
    index = corridor_index(signal_approaches=SIGNALS)
    route = plan_route(index, position_at(origin_x), position_at(_X + 1_950.02), settings)
    model = build_route_model(route, index, settings, cascade_enabled=cascade)
    engine = SimulationEngine(
        "SIM-sync",
        route,
        model,
        estimate_times(route, model, 1.0, settings),
        1.0,
        settings,
        MockItsGateway(),
    )
    state, ticks = engine.initial_state(), []
    while not state.completed:
        state, events = engine.step(state, _NOW)
        tick = next(e for e in events if isinstance(e, SimulationTickEvent))
        ticks.append((state.distance_travelled_m, tick))
        assert state.simulated_time_s < 1_000, "the ambulance never got its green"
    return engine, ticks


def _route_lights(engine: SimulationEngine, tick: SimulationTickEvent, item_id: str) -> set[str]:
    item = next(i for i in engine.route_model.intersections if i.id == item_id)
    return {
        phase.color
        for phase in tick.signal_phases
        if phase.intersection_id == item_id
        and phase.kind == "VEHICLE"
        and phase.signal_key in item.route_signal_keys
    }


_ORIGINS = [_X + 1_000, _X + 1_090, _X + 1_099]  # far, 10 m and 1 m before INT-A's stop line
_PROGRAMMES = [
    SimulationSettings(),
    SimulationSettings(signal_green_seconds=7, signal_yellow_seconds=3, signal_all_red_seconds=2),
    SimulationSettings(
        signal_green_seconds=13,
        signal_yellow_seconds=4,
        clearing_tti_seconds=10,
        priority_green_tti_seconds=5,
    ),
]


@pytest.mark.parametrize("cascade", [False, True])
@pytest.mark.parametrize("settings", _PROGRAMMES)
@pytest.mark.parametrize("origin_x", _ORIGINS)
def test_the_ambulance_only_leaves_a_stop_line_on_a_shown_green(
    origin_x: float, settings: SimulationSettings, cascade: bool
) -> None:
    engine, ticks = _run(origin_x, settings, cascade)
    stop_lines = [
        (stop.intersection_id, stop.distance_along_route_m) for stop in engine.route.stop_lines
    ]
    previous_m, previous_tick = 0.0, None
    for distance, tick in ticks:
        for item_id, stop_m in stop_lines:
            if previous_m <= stop_m < distance and previous_tick is not None:
                shown = _route_lights(engine, previous_tick, item_id)
                assert shown == {SignalPhaseColor.GREEN}, (item_id, tick.tick, shown)
        previous_m, previous_tick = distance, tick


@pytest.mark.parametrize("origin_x", _ORIGINS)
def test_priority_is_held_while_the_ambulance_waits_at_the_stop_line(origin_x: float) -> None:
    engine, ticks = _run(origin_x, SimulationSettings(), cascade=False)
    for item in engine.route_model.intersections:
        waiting = [tick for distance, tick in ticks if distance == item.first_stop_line_m]
        assert waiting, item.id
        for tick in waiting:
            state = next(i.state for i in tick.intersections if i.id == item.id)
            assert state in {IntersectionState.CLEARING, IntersectionState.PRIORITY_GREEN}
            assert tick.ambulance.status == "CROSSING_INTERSECTION"
        # Released only once the ambulance has gone.
        assert _route_lights(engine, waiting[-1], item.id) == {SignalPhaseColor.GREEN}


def test_without_a_late_start_the_trip_still_takes_t_greenwave() -> None:
    """Holding never delays an ambulance whose priority was in place in time."""
    engine, ticks = _run(_X + 1_000, SimulationSettings(), cascade=False)
    assert ticks[-1][1].kpi_metrics.total_time_elapsed_sec == round(
        engine.estimates.greenwave_seconds
    )


def _run_emitted(
    origin_x: float, settings: SimulationSettings, playback: int
) -> tuple[SimulationEngine, list[tuple[float, SimulationTickEvent]]]:
    """Run as the stream does: ``playback`` seconds per emitted tick, only the last one shown."""
    index = corridor_index(signal_approaches=SIGNALS)
    route = plan_route(index, position_at(origin_x), position_at(_X + 1_950.02), settings)
    model = build_route_model(route, index, settings, cascade_enabled=True)
    engine = SimulationEngine(
        "SIM-sync",
        route,
        model,
        estimate_times(route, model, 1.0, settings),
        1.0,
        settings,
        MockItsGateway(),
    )
    state, emitted = engine.initial_state(), []
    while not state.completed:
        state, events = engine.run_tick(state, _NOW, playback)
        tick = next(e for e in events if isinstance(e, SimulationTickEvent))
        emitted.append((state.distance_travelled_m, tick))
        assert state.simulated_time_s < 1_000
    return engine, emitted


@pytest.mark.parametrize("playback", [1, 2, 5, 10])
@pytest.mark.parametrize("settings", _PROGRAMMES)
@pytest.mark.parametrize("origin_x", _ORIGINS)
def test_a_light_the_map_animates_the_ambulance_past_is_still_green(
    origin_x: float, settings: SimulationSettings, playback: int
) -> None:
    """The map moves the marker across each emitted interval while showing that tick's lights.

    So a stop line crossed during an interval needs its route light green in that tick: priority
    is released only in a later tick, never under the animated ambulance.
    """
    engine, emitted = _run_emitted(origin_x, settings, playback)
    lines = [
        (stop.intersection_id, stop.distance_along_route_m) for stop in engine.route.stop_lines
    ]
    previous_m = 0.0
    for distance, tick in emitted:
        for item_id, line_m in lines:
            if previous_m <= line_m < distance:
                shown = _route_lights(engine, tick, item_id)
                assert shown == {SignalPhaseColor.GREEN}, (item_id, tick.tick, shown)
        previous_m = distance


def _held(distance_m: float, arrived: bool, interval_start_m: float) -> bool:
    from greenwave.simulation.corridor import holding_priority
    from greenwave.simulation.route_model import RouteIntersection
    from greenwave.simulation.state import EngineState

    state = EngineState(
        simulated_time_s=10,
        distance_travelled_m=distance_m,
        current_edge_index=0,
        dwell_remaining_s=0.0,
        dwelling_intersection_id=None,
        v_avg_meters_per_second=10.0,
        intersection_runtimes=(),
        tick=10,
        message_sequence=0,
        arrived=arrived,
        completed=False,
    )
    return holding_priority(RouteIntersection("INT", 100.0, 100.0, 10.0), state, interval_start_m)


def test_arriving_just_past_a_junction_keeps_its_light_for_the_animated_interval() -> None:
    assert _held(105.0, arrived=True, interval_start_m=95.0)
    assert not _held(105.0, arrived=True, interval_start_m=105.0)  # the next interval releases


def test_a_destination_on_the_stop_line_releases_the_junction() -> None:
    """Nothing is left to cross; holding would keep the run from ever completing."""
    assert not _held(100.0, arrived=True, interval_start_m=100.0)
    # Until the interval that animated it onto the line (through any earlier line) has ended.
    assert _held(100.0, arrived=True, interval_start_m=90.0)


@pytest.mark.parametrize("playback", [1, 10])
def test_a_run_ending_on_a_stop_line_completes(playback: int) -> None:
    settings = SimulationSettings()
    index = corridor_index(signal_approaches=SIGNALS)
    route = plan_route(index, position_at(_X + 1_000), position_at(_X + 1_850.02), settings)
    model = build_route_model(route, index, settings, cascade_enabled=False)
    engine = SimulationEngine(
        "SIM-end",
        route,
        model,
        estimate_times(route, model, 1.0, settings),
        1.0,
        settings,
        MockItsGateway(),
    )
    state = engine.initial_state()
    while not state.completed:
        state, _ = engine.run_tick(state, _NOW, playback)
        assert state.simulated_time_s < 1_000
