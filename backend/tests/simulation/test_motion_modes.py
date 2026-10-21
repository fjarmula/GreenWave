"""ER Green Wave enabled vs disabled motion on one controlled crossing.

The first 100 m edge is a 36 km/h road: the ambulance drives 13 m/s (x1.3) and the ordinary limit
is 10 m/s. INT-1's first stop line is at 90 m with a 20 s normal delay; at density 1.5 the disabled
cautious time is 30 s, spread over the 20 m controlled crossing [90, 110] that spans the edge end
at 100 m. Disabled red/yellow crossings roll; they never stop at the stop line.
"""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError
from tests.support.route_fixtures import route_edges

from greenwave.its import MockItsGateway
from greenwave.routing.estimates import Estimates
from greenwave.routing.network_index import SignalApproachRef
from greenwave.routing.planner import PlannedRoute, SnappedRouteEndpoint
from greenwave.schemas import (
    AmbulanceStatus,
    GreenWaveMode,
    IntersectionState,
    Position,
    SignalPhaseColor,
    SimulationTickEvent,
)
from greenwave.simulation.engine import SimulationEngine
from greenwave.simulation.motion import cautious_speed_mps, move_one_second
from greenwave.simulation.route_model import RouteIntersection, RouteModel
from greenwave.simulation.route_track import RouteTrack
from greenwave.simulation.state import EngineState
from greenwave.simulation_settings import SimulationSettings

_NOW = datetime(2026, 10, 21, tzinfo=UTC)
_DENSITY = 1.5
_STOP_M, _DELAY_S, _CROSSING_M = 90.0, 20.0, 20.0
_AMBULANCE_MPS, _LIMIT_MPS = 13.0, 10.0
_CAUTIOUS_S = _DELAY_S * _DENSITY
_REACH_S = _STOP_M / _AMBULANCE_MPS
GREEN, YELLOW, RED = SignalPhaseColor.GREEN, SignalPhaseColor.YELLOW, SignalPhaseColor.RED
# Phase programmes that put the route movement (controlling edge "first") in a known colour when
# the ambulance reaches the stop line at ~6.92 s. "a-cross" sorts before "first", so the cross
# street takes cycle slot 0 and the route slot 1 unless the cross signal is absent.
_PROGRAMMES = {
    GREEN: ({"signal_green_seconds": 1_000}, False),
    YELLOW: ({"signal_green_seconds": 5, "signal_yellow_seconds": 10}, False),
    RED: ({"signal_green_seconds": 1_000}, True),
}


def _signals(with_cross: bool) -> tuple[SignalApproachRef, ...]:
    route = SignalApproachRef("INT-1", "sig-route", "traffic_signals", 19.0, 50.0, ("first",))
    cross = SignalApproachRef("INT-1", "sig-cross", "traffic_signals", 19.0, 50.0, ("a-cross",))
    return (cross, route) if with_cross else (route,)


def _engine(
    mode: GreenWaveMode,
    crossing_m: float = _CROSSING_M,
    stop_lines: tuple[float, ...] = (_STOP_M,),
    speeds_kmh: tuple[float, float] = (36.0, 36.0),
    phase: SignalPhaseColor | None = None,
) -> SimulationEngine:
    """``phase`` None gives INT-1 no signal geometry (an unknown route movement)."""
    route = PlannedRoute(
        edge_ids=("first", "second"),
        edge_lengths_m=(100.0, 100.0),
        edges=route_edges(("first", "second"), (100.0, 100.0), speeds_kmh),
        cumulative_m=(0.0, 100.0),
        total_distance_m=200.0,
        polyline_wgs84=[(19.0, 50.0), (19.1, 50.0)],
        origin_snap=SnappedRouteEndpoint("origin", Position(lat=50.0, lng=19.0), 0),
        destination_snap=SnappedRouteEndpoint("destination", Position(lat=50.0, lng=19.1), 0),
        stop_lines=(),
    )
    overrides, with_cross = _PROGRAMMES[phase] if phase is not None else ({}, False)
    signals = _signals(with_cross) if phase is not None else ()
    model = RouteModel(
        intersections=tuple(
            RouteIntersection(
                f"INT-{i}",
                stop_m,
                stop_m,
                _DELAY_S,
                approach_edge_ids=("first",),
                signals=signals if i == 1 else (),
                route_signal_keys=frozenset({"sig-route"}) if i == 1 and signals else frozenset(),
            )
            for i, stop_m in enumerate(stop_lines, start=1)
        ),
        _cascade_targets={},
    )
    return SimulationEngine(
        "SIM-modes",
        route,
        model,
        Estimates(normal_seconds=60.0, greenwave_seconds=200 / 13 + 3),
        _DENSITY,
        SimulationSettings(standard_crossing_distance_m=crossing_m, **overrides),
        MockItsGateway(),
        green_wave_mode=mode,
    )


def _run(engine: SimulationEngine) -> tuple[list[EngineState], list[SimulationTickEvent]]:
    """Every state after each step (index t-1 is the state at t s), and every tick."""
    state, states, ticks = engine.initial_state(), [], []
    while not state.completed:
        state, events = engine.step(state, _NOW)
        assert not any(event.event_type == "ITS_DISPATCH" for event in events) or (
            engine.green_wave_mode is GreenWaveMode.ENABLED
        )
        states.append(state)
        ticks.extend(event for event in events if isinstance(event, SimulationTickEvent))
    return states, ticks


def _at(states: list[EngineState], seconds: int) -> EngineState:
    return states[seconds - 1]


def _crossing_s(crossing_m: float = _CROSSING_M) -> float:
    return crossing_m / _LIMIT_MPS + _CAUTIOUS_S


def test_cautious_speed_spreads_the_extra_time_over_the_remaining_distance() -> None:
    assert cautious_speed_mps(10.0, 20.0, 30.0) == pytest.approx(20.0 / 32.0)
    assert cautious_speed_mps(10.0, 20.0, 0.0) == pytest.approx(10.0)


def test_open_road_motion_is_identical_before_the_stop_line() -> None:
    """A mode-dependent open-road speed would fake the Green Wave advantage."""
    enabled, _ = _run(_engine(GreenWaveMode.ENABLED))
    disabled, _ = _run(_engine(GreenWaveMode.DISABLED))
    for seconds in range(1, 7):  # 6 s x 13 m/s = 78 m, still before the 90 m stop line
        assert _at(enabled, seconds).distance_travelled_m == pytest.approx(13.0 * seconds)
        assert (
            _at(disabled, seconds).distance_travelled_m
            == _at(enabled, seconds).distance_travelled_m
        )


@pytest.mark.parametrize("phase", [None, GREEN, YELLOW, RED])
def test_enabled_mode_keeps_the_minimum_dwell_whatever_the_phase(
    phase: SignalPhaseColor | None,
) -> None:
    states, _ = _run(_engine(GreenWaveMode.ENABLED, phase=phase))
    final = states[-1]
    assert final.arrived_at_s == pytest.approx(200 / 13 + 3)
    assert final.cautious_crossing_remaining_m == 0.0
    assert final.cautious_time_remaining_s == 0.0


@pytest.mark.parametrize("phase", [None, YELLOW, RED])
def test_disabled_red_or_unknown_movement_rolls_into_the_crossing(
    phase: SignalPhaseColor | None,
) -> None:
    """Yellow and an unknown movement take the cautious path; nothing dwells at the stop line."""
    states, _ = _run(_engine(GreenWaveMode.DISABLED, phase=phase))
    at_7 = _at(states, 7)
    speed = cautious_speed_mps(_LIMIT_MPS, _CROSSING_M, _CAUTIOUS_S)
    assert at_7.dwell_remaining_s == 0.0
    assert at_7.dwelling_intersection_id is None
    assert at_7.distance_travelled_m == pytest.approx(_STOP_M + speed * (7 - _REACH_S))
    assert at_7.cautious_crossing_remaining_m == pytest.approx(
        _STOP_M + _CROSSING_M - at_7.distance_travelled_m
    )
    assert at_7.cautious_time_remaining_s == pytest.approx(
        _CAUTIOUS_S * at_7.cautious_crossing_remaining_m / _CROSSING_M
    )


@pytest.mark.parametrize("phase", [None, YELLOW, RED])
def test_disabled_crossing_speed_is_positive_and_capped_every_tick(
    phase: SignalPhaseColor | None,
) -> None:
    states, ticks = _run(_engine(GreenWaveMode.DISABLED, phase=phase))
    crossing_end_s = _REACH_S + _crossing_s()
    for seconds in range(8, int(crossing_end_s) + 1):  # ticks wholly inside the crossing
        moved = (
            _at(states, seconds).distance_travelled_m
            - _at(states, seconds - 1).distance_travelled_m
        )
        assert 0 < moved <= _LIMIT_MPS
        assert ticks[seconds - 1].ambulance.speed_kmh > 0
        assert ticks[seconds - 1].ambulance.status is AmbulanceStatus.CROSSING_INTERSECTION
    assert ticks[int(crossing_end_s) + 1].ambulance.status is AmbulanceStatus.EN_ROUTE


@pytest.mark.parametrize("phase", [None, YELLOW, RED])
def test_disabled_cautious_crossing_adds_exactly_the_cautious_time(
    phase: SignalPhaseColor | None,
) -> None:
    states, ticks = _run(_engine(GreenWaveMode.DISABLED, phase=phase))
    expected = (200 - _CROSSING_M) / _AMBULANCE_MPS + _crossing_s()
    assert states[-1].arrived_at_s == pytest.approx(expected)
    assert ticks[-1].kpi_metrics.total_time_elapsed_sec == round(expected)


def test_disabled_green_movement_has_no_penalty() -> None:
    states, ticks = _run(_engine(GreenWaveMode.DISABLED, phase=GREEN))
    assert states[-1].arrived_at_s == pytest.approx(200 / 13)
    assert all(state.cautious_crossing_remaining_m == 0.0 for state in states)
    assert all(tick.ambulance.status is not AmbulanceStatus.CROSSING_INTERSECTION for tick in ticks)


def test_the_crossing_follows_each_edge_speed_limit_across_the_edge_end() -> None:
    """Segment time is d / v + remaining cautious time x d / remaining crossing distance."""
    states, _ = _run(_engine(GreenWaveMode.DISABLED, speeds_kmh=(36.0, 54.0)))
    first = 10.0 / 10.0 + _CAUTIOUS_S * 10.0 / 20.0  # [90, 100] at a 10 m/s limit
    second = 10.0 / 15.0 + (_CAUTIOUS_S / 2) * 10.0 / 10.0  # [100, 110] at a 15 m/s limit
    expected = _REACH_S + first + second + 90.0 / 19.5  # 54 km/h x 1.3
    assert states[-1].arrived_at_s == pytest.approx(expected)


def test_a_stop_line_inside_a_crossing_starts_a_fresh_penalty() -> None:
    states, _ = _run(_engine(GreenWaveMode.DISABLED, stop_lines=(_STOP_M, 100.0)))
    expected = (
        _REACH_S
        + 10.0 / _LIMIT_MPS
        + _CAUTIOUS_S * 10.0 / _CROSSING_M  # 90 -> 100, half of INT-1's budget
        + _crossing_s()  # INT-2 replaces it: 100 -> 120
        + 80.0 / _AMBULANCE_MPS
    )
    assert states[-1].arrived_at_s == pytest.approx(expected)


def test_motion_samples_the_route_movement_at_the_exact_stop_line_time() -> None:
    engine = _engine(GreenWaveMode.DISABLED)
    track = RouteTrack.from_route(engine.route, engine.settings)
    state = engine.initial_state()
    calls: list[tuple[str, float]] = []

    def color_at(intersection_id: str, at_s: float) -> SignalPhaseColor | None:
        calls.append((intersection_id, at_s))
        return GREEN

    for _ in range(8):
        state, _ = move_one_second(
            state,
            track,
            engine.route_model,
            engine.settings,
            GreenWaveMode.DISABLED,
            _DENSITY,
            color_at,
        )
    assert calls == [("INT-1", pytest.approx(_REACH_S))]


def test_arrival_tick_reports_the_distance_actually_driven() -> None:
    states, ticks = _run(_engine(GreenWaveMode.ENABLED))
    arrival = next(i for i, state in enumerate(states) if state.arrived)
    moved = states[arrival].distance_travelled_m - states[arrival - 1].distance_travelled_m
    assert moved > 0
    assert ticks[arrival].ambulance.status is AmbulanceStatus.ARRIVED
    assert ticks[arrival].ambulance.speed_kmh == pytest.approx(moved * 3.6)
    assert states[arrival].arrived_at_s == pytest.approx(200 / 13 + 3)
    assert ticks[arrival + 1].ambulance.speed_kmh == 0.0


def test_disabled_runs_never_activate_a_corridor() -> None:
    _, ticks = _run(_engine(GreenWaveMode.DISABLED, phase=RED))
    for tick in ticks:
        assert all(item.state is IntersectionState.NORMAL for item in tick.intersections)


def test_disabled_mode_is_deterministic() -> None:
    first, first_ticks = _run(_engine(GreenWaveMode.DISABLED, phase=RED))
    second, second_ticks = _run(_engine(GreenWaveMode.DISABLED, phase=RED))
    assert first == second
    assert first_ticks == second_ticks


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("standard_crossing_distance_m", 0),
        ("standard_crossing_distance_m", -1),
        ("standard_clearance_factor", -0.1),
        ("standard_crossing_distance_m", float("inf")),
        ("standard_clearance_factor", float("nan")),
    ],
)
def test_standard_crossing_settings_reject_invalid_values(field: str, value: float) -> None:
    with pytest.raises(ValidationError):
        SimulationSettings(**{field: value})
