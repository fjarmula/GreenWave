"""ER Green Wave enabled vs disabled motion on one controlled crossing.

The first 100 m edge is a 36 km/h road: the ambulance drives 13 m/s (x1.3) and the ordinary limit
is 10 m/s. INT-1's first stop line is at 90 m with a 20 s normal delay; at density 1.5 the disabled
cautious time is 30 s, spread over the 20 m controlled crossing [90, 110] that spans the edge end
at 100 m. Disabled red/yellow crossings roll; they never stop at the stop line.
"""

from dataclasses import replace
from datetime import UTC, datetime
from itertools import pairwise

import pytest
from pydantic import ValidationError
from tests.support.route_fixtures import route_edges

from greenwave.its import MockItsGateway
from greenwave.routing.estimates import Estimates
from greenwave.routing.network_index import SignalApproachRef
from greenwave.routing.planner import PlannedRoute, SnappedRouteEndpoint, StopLineEvent
from greenwave.schemas import (
    AmbulanceStatus,
    GreenWaveMode,
    IntersectionState,
    Position,
    SignalPhaseColor,
    SimulationTickEvent,
)
from greenwave.simulation.engine import SimulationEngine
from greenwave.simulation.motion import (
    cautious_speed_mps,
    greenwave_slowdown,
    move_one_second,
    standard_crossing,
)
from greenwave.simulation.route_model import RouteIntersection, RouteModel
from greenwave.simulation.route_track import RouteTrack
from greenwave.simulation.state import EngineState
from greenwave.simulation_settings import SimulationSettings

_NOW = datetime(2026, 10, 21, tzinfo=UTC)
_DENSITY = 1.5
_STOP_M, _DELAY_S, _CROSSING_M = 90.0, 20.0, 20.0
_AMBULANCE_MPS, _LIMIT_MPS = 13.0, 10.0
_FLOOR_STD_MPS = 10 / 3.6
# Every red, yellow or unknown case in these fixtures waits long enough (or uses D_u = 20 s x 1.5)
# to hit standard_max_red_loss_seconds; the crossing then extends to keep the 10 km/h floor.
_CAUTIOUS_S = 15.0
_STD_L = _CAUTIOUS_S / (1 / _FLOOR_STD_MPS - 1 / _LIMIT_MPS)
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
    settings: dict[str, float] | None = None,
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
        stop_lines=tuple(
            StopLineEvent(f"INT-{i}", "first", stop_m)
            for i, stop_m in enumerate(stop_lines, start=1)
        ),
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
        SimulationSettings(
            standard_crossing_distance_m=crossing_m, **{**overrides, **(settings or {})}
        ),
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


def _crossing_s(crossing_m: float = _STD_L) -> float:
    return crossing_m / _LIMIT_MPS + _CAUTIOUS_S


def test_cautious_speed_spreads_the_extra_time_over_the_remaining_distance() -> None:
    assert cautious_speed_mps(10.0, 20.0, 30.0) == pytest.approx(20.0 / 32.0)
    assert cautious_speed_mps(10.0, 20.0, 0.0) == pytest.approx(10.0)


def test_open_road_motion_is_identical_before_the_stop_line() -> None:
    """A mode-dependent open-road speed would fake the Green Wave advantage."""
    enabled, _ = _run(_engine(GreenWaveMode.ENABLED))
    disabled, _ = _run(_engine(GreenWaveMode.DISABLED))
    for seconds in range(1, 3):  # 2 s x 13 m/s = 26 m, before the 30 m Green Wave approach
        assert _at(enabled, seconds).distance_travelled_m == pytest.approx(13.0 * seconds)
        assert (
            _at(disabled, seconds).distance_travelled_m
            == _at(enabled, seconds).distance_travelled_m
        )


@pytest.mark.parametrize("phase", [None, GREEN, YELLOW, RED])
def test_enabled_mode_keeps_d_min_in_trip_time_whatever_the_phase(
    phase: SignalPhaseColor | None,
) -> None:
    states, _ = _run(_engine(GreenWaveMode.ENABLED, phase=phase))
    final = states[-1]
    assert final.arrived_at_s == pytest.approx(200 / 13 + 3)
    assert final.cautious_crossing_remaining_m == 0.0
    assert final.cautious_time_remaining_s == 0.0


def _moved_each_second(states: list[EngineState]) -> list[float]:
    """Distance driven in each whole second before arrival (index 0 is the first second)."""
    distances = [0.0] + [state.distance_travelled_m for state in states]
    arrival = next(i for i, state in enumerate(states) if state.arrived)
    return [distances[i + 1] - distances[i] for i in range(arrival)]


_FLOOR_MPS = 15 / 3.6


def test_enabled_vehicle_never_stops_at_a_cleared_light() -> None:
    states, _ = _run(_engine(GreenWaveMode.ENABLED, phase=GREEN))
    assert all(moved > 0 for moved in _moved_each_second(states))


def test_enabled_slowdown_respects_the_floor() -> None:
    states, ticks = _run(_engine(GreenWaveMode.ENABLED, phase=GREEN))
    assert all(moved >= _FLOOR_MPS - 1e-6 for moved in _moved_each_second(states))
    assert any(tick.ambulance.status is AmbulanceStatus.CROSSING_INTERSECTION for tick in ticks)


def test_close_junctions_share_the_gap_and_keep_trip_time() -> None:
    states, _ = _run(_engine(GreenWaveMode.ENABLED, stop_lines=(90.0, 110.0), phase=GREEN))
    assert states[-1].arrived_at_s == pytest.approx(200 / 13 + 6)
    assert all(moved >= _FLOOR_MPS - 1e-6 for moved in _moved_each_second(states))


def test_zero_window_spends_d_min_past_the_line() -> None:
    states, _ = _run(_engine(GreenWaveMode.ENABLED, stop_lines=(0.5,)))
    assert all(moved >= _FLOOR_MPS - 1e-6 for moved in _moved_each_second(states))
    assert states[-1].arrived_at_s == pytest.approx(200 / 13 + 3)


def test_safety_hold_still_waits_for_green() -> None:
    engine = _engine(
        GreenWaveMode.ENABLED,
        phase=RED,
        settings={"clearing_tti_seconds": 0, "priority_green_tti_seconds": 0},
    )
    states, _ = _run(engine)
    distances = [state.distance_travelled_m for state in states]
    assert any(before == after == pytest.approx(_STOP_M) for before, after in pairwise(distances))


def test_a_tight_hold_still_outlasts_the_rolling_slowdowns() -> None:
    # The contract floors a hold at 40 s, so drive slowly enough (1.3 m/s) that reaching each
    # line takes longer than that. The 1 s buffer is the tick in which passage is observed after
    # the line is crossed; without the D_min term the hold would still be the 40 s floor.
    engine = _engine(
        GreenWaveMode.ENABLED,
        stop_lines=(90.0, 150.0),
        speeds_kmh=(3.6, 3.6),
        phase=GREEN,
        settings={
            "its_hold_buffer_seconds": 1,
            "ambulance_min_speed_kmh": 0,
            "speed_floor_meters_per_second": 0,
        },
    )
    states, _ = _run(engine)
    assert states[-1].arrived
    assert not any(s.status == "EXPIRED" for s in engine.ledger.snapshots())


def test_slow_edge_below_floor_uses_window_only() -> None:
    engine = _engine(GreenWaveMode.ENABLED, speeds_kmh=(10.0, 10.0))
    speed = RouteTrack.from_route(engine.route, engine.settings).speed_mps(0)
    states, _ = _run(engine)
    assert states[-1].arrived_at_s == pytest.approx(200 / speed + 3)


def test_arrival_inside_a_slowdown_clears_the_crossing() -> None:
    states, _ = _run(_engine(GreenWaveMode.ENABLED, stop_lines=(195.0,)))
    final = states[-1]
    assert final.arrived
    assert final.arrived_at_s == pytest.approx(200 / 13 + 3)
    assert final.cautious_crossing_remaining_m == 0.0
    assert final.cautious_time_remaining_s == 0.0


def test_slowdown_near_the_destination_still_spends_every_d_min() -> None:
    # The second slowdown would run past the destination; it is cut there, so the
    # trip still takes T_greenwave (free time plus D_min per intersection).
    states, _ = _run(_engine(GreenWaveMode.ENABLED, stop_lines=(190.0, 199.5)))
    final = states[-1]
    assert final.arrived
    assert final.arrived_at_s == pytest.approx(200 / 13 + 2 * 3)
    assert final.cautious_crossing_remaining_m == 0.0
    assert final.cautious_time_remaining_s == 0.0


def test_greenwave_slowdown_length() -> None:
    settings = SimulationSettings()
    assert greenwave_slowdown(90.0, 30.0, 13.0, settings) == pytest.approx(60.0)
    assert greenwave_slowdown(90.0, 85.0, 13.0, settings) == pytest.approx(
        3 / (1 / _FLOOR_MPS - 1 / 13)
    )
    assert greenwave_slowdown(90.0, 85.0, 3.0, settings) == pytest.approx(5.0)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("greenwave_approach_distance_m", 0),
        ("greenwave_min_rolling_speed_kmh", 0),
        ("greenwave_approach_distance_m", float("inf")),
        ("greenwave_min_rolling_speed_kmh", float("nan")),
    ],
)
def test_greenwave_slowdown_settings_reject_invalid_values(field: str, value: float) -> None:
    with pytest.raises(ValidationError):
        SimulationSettings(**{field: value})


@pytest.mark.parametrize("phase", [None, YELLOW, RED])
def test_disabled_red_or_unknown_movement_rolls_into_the_crossing(
    phase: SignalPhaseColor | None,
) -> None:
    """Yellow and an unknown movement take the cautious path; nothing dwells at the stop line."""
    states, _ = _run(_engine(GreenWaveMode.DISABLED, phase=phase))
    at_7 = _at(states, 7)
    speed = cautious_speed_mps(_LIMIT_MPS, _STD_L, _CAUTIOUS_S)
    assert speed == pytest.approx(_FLOOR_STD_MPS)
    assert at_7.dwell_remaining_s == 0.0
    assert at_7.dwelling_intersection_id is None
    assert at_7.distance_travelled_m == pytest.approx(_STOP_M + speed * (7 - _REACH_S))
    assert at_7.cautious_crossing_remaining_m == pytest.approx(
        _STOP_M + _STD_L - at_7.distance_travelled_m
    )
    assert at_7.cautious_time_remaining_s == pytest.approx(
        _CAUTIOUS_S * at_7.cautious_crossing_remaining_m / _STD_L
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
    expected = (200 - _STD_L) / _AMBULANCE_MPS + _crossing_s()
    assert states[-1].arrived_at_s == pytest.approx(expected)
    assert ticks[-1].kpi_metrics.total_time_elapsed_sec == round(expected)


def test_standard_crossing_extends_to_respect_the_floor() -> None:
    length, extra = standard_crossing(100.0, 20.0, 10.0, 1.5, SimulationSettings())
    assert extra == 15.0  # min(1.0 x 100 x 1.5, 15)
    assert length == pytest.approx(15.0 / (1 / _FLOOR_STD_MPS - 1 / 10.0))
    assert cautious_speed_mps(10.0, length, extra) == pytest.approx(_FLOOR_STD_MPS)


def test_short_wait_scales_the_loss_below_the_cap() -> None:
    length, extra = standard_crossing(4.0, 20.0, 10.0, 1.5, SimulationSettings())
    assert extra == pytest.approx(6.0)
    assert length == 30.0  # L_c dominates


def test_unknown_movement_uses_the_intersection_delay() -> None:
    _, extra = standard_crossing(None, 4.0, 10.0, 1.0, SimulationSettings())
    assert extra == pytest.approx(4.0)


def test_limit_at_or_below_floor_adds_no_extra_time() -> None:
    settings = SimulationSettings()
    assert standard_crossing(100.0, 20.0, _FLOOR_STD_MPS, 1.0, settings) == (30.0, 0.0)
    assert standard_crossing(100.0, 20.0, 1.0, 1.0, settings) == (30.0, 0.0)


@pytest.mark.parametrize("phase", [None, YELLOW, RED])
def test_disabled_crossing_never_drops_below_the_floor(phase: SignalPhaseColor | None) -> None:
    states, _ = _run(_engine(GreenWaveMode.DISABLED, phase=phase))
    moved = _moved_each_second(states)
    assert min(moved) >= _FLOOR_STD_MPS - 1e-9


def test_a_crossing_from_an_edge_end_uses_the_limit_beyond_the_line() -> None:
    """A line at an edge end is crossed on the next edge; its slower limit sets the length."""
    engine = _engine(GreenWaveMode.DISABLED, stop_lines=(100.0,), speeds_kmh=(54.0, 36.0))
    states, _ = _run(engine)
    assert min(_moved_each_second(states)) >= _FLOOR_STD_MPS - 1e-9


def test_a_crossing_onto_a_slower_edge_keeps_the_floor() -> None:
    """Sized from the lowest limit it covers: 15 m/s at the line, 10 m/s past 100 m."""
    states, _ = _run(_engine(GreenWaveMode.DISABLED, speeds_kmh=(54.0, 36.0)))
    assert min(_moved_each_second(states)) >= _FLOOR_STD_MPS - 1e-9
    # The 10 m/s edge sets the length, so it is driven exactly at the floor.
    assert states[-1].arrived_at_s == pytest.approx(
        _STOP_M / 19.5
        + 10.0 / 15.0
        + (_STD_L - 10.0) / 10.0
        + _CAUTIOUS_S
        + (110.0 - _STD_L) / _AMBULANCE_MPS
    )


def test_disabled_green_movement_has_no_penalty() -> None:
    states, ticks = _run(_engine(GreenWaveMode.DISABLED, phase=GREEN))
    assert states[-1].arrived_at_s == pytest.approx(200 / 13)
    assert all(state.cautious_crossing_remaining_m == 0.0 for state in states)
    assert all(tick.ambulance.status is not AmbulanceStatus.CROSSING_INTERSECTION for tick in ticks)


def test_the_crossing_follows_each_edge_speed_limit_across_the_edge_end() -> None:
    """Segment time is d / v + remaining cautious time x d / remaining crossing distance.

    The crossing length is fixed at the line from the limit there (10 m/s).
    """
    states, _ = _run(_engine(GreenWaveMode.DISABLED, speeds_kmh=(36.0, 54.0)))
    first = 10.0 / 10.0 + _CAUTIOUS_S * 10.0 / _STD_L  # [90, 100] at a 10 m/s limit
    rest_m, rest_s = _STD_L - 10.0, _CAUTIOUS_S * (_STD_L - 10.0) / _STD_L
    second = rest_m / 15.0 + rest_s  # [100, 90 + L] at a 15 m/s limit
    expected = _REACH_S + first + second + (110.0 - _STD_L) / 19.5  # 54 km/h x 1.3
    assert states[-1].arrived_at_s == pytest.approx(expected)


def test_a_stop_line_inside_a_crossing_starts_a_fresh_penalty() -> None:
    states, _ = _run(_engine(GreenWaveMode.DISABLED, stop_lines=(_STOP_M, 100.0)))
    expected = (
        _REACH_S
        + 10.0 / _LIMIT_MPS
        + _CAUTIOUS_S * 10.0 / _STD_L  # 90 -> 100, part of INT-1's budget
        + _crossing_s()  # INT-2 replaces it with its own decision: 100 -> 100 + L
        + (100.0 - _STD_L) / _AMBULANCE_MPS
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
        ("standard_min_rolling_speed_kmh", 0),
        ("standard_min_rolling_speed_kmh", float("inf")),
        ("standard_max_red_loss_seconds", -1),
        ("standard_max_red_loss_seconds", float("nan")),
    ],
)
def test_standard_crossing_settings_reject_invalid_values(field: str, value: float) -> None:
    with pytest.raises(ValidationError):
        SimulationSettings(**{field: value})


def _two_line_engine(phase: SignalPhaseColor | None) -> SimulationEngine:
    """INT-1 with route stop lines at 90 m (entry) and 150 m (inside the junction)."""
    engine = _engine(GreenWaveMode.DISABLED, phase=phase)
    item = replace(
        engine.route_model.intersections[0], last_stop_line_m=150.0, stop_lines_m=(90.0, 150.0)
    )
    engine.route_model = replace(engine.route_model, intersections=(item,))
    return engine


@pytest.mark.parametrize("phase", [None, RED])
def test_every_red_route_stop_line_of_a_junction_starts_a_controlled_crossing(
    phase: SignalPhaseColor | None,
) -> None:
    """Driving full speed past a red line inside a junction would show the ambulance running red."""
    states, _ = _run(_two_line_engine(phase))
    expected = (
        _REACH_S
        + _crossing_s()  # 90 -> 90 + L
        + (60.0 - _STD_L) / _AMBULANCE_MPS  # open road up to 150
        # A fresh crossing at the line inside the junction, cut at the destination (200 m).
        + 50.0 / _LIMIT_MPS
        + _CAUTIOUS_S * 50.0 / _STD_L
    )
    assert states[-1].arrived_at_s == pytest.approx(expected)


def test_a_green_junction_adds_no_penalty_at_any_of_its_lines() -> None:
    states, _ = _run(_two_line_engine(GREEN))
    assert states[-1].arrived_at_s == pytest.approx(200 / 13)
