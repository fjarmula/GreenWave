"""ER Green Wave enabled vs disabled motion on one controlled crossing.

Both 100 m edges are 36 km/h roads: the ambulance drives 13 m/s (x1.3) and the ordinary limit is
10 m/s. INT-1's first stop line is at 90 m with a 20 s normal delay; at density 1.5 the disabled
clearance is 30 s, and the 20 m controlled crossing [90, 110] spans the edge end at 100 m.
"""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError
from tests.support.route_fixtures import route_edges

from greenwave.its import MockItsGateway
from greenwave.routing.estimates import Estimates
from greenwave.routing.planner import PlannedRoute, SnappedRouteEndpoint
from greenwave.schemas import AmbulanceStatus, GreenWaveMode, Position, SimulationTickEvent
from greenwave.simulation.engine import SimulationEngine
from greenwave.simulation.route_model import RouteIntersection, RouteModel
from greenwave.simulation.state import EngineState
from greenwave.simulation_settings import SimulationSettings

_NOW = datetime(2026, 10, 21, tzinfo=UTC)
_DENSITY = 1.5
_STOP_M, _DELAY_S, _CROSSING_M = 90.0, 20.0, 20.0
_AMBULANCE_MPS, _LIMIT_MPS = 13.0, 10.0
_CLEARANCE_S = _DELAY_S * _DENSITY
_DWELL_END_S = _STOP_M / _AMBULANCE_MPS + _CLEARANCE_S


def _engine(
    mode: GreenWaveMode, crossing_m: float = _CROSSING_M, stop_lines: tuple[float, ...] = (_STOP_M,)
) -> SimulationEngine:
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
        intersections=tuple(
            RouteIntersection(f"INT-{i}", stop_m, stop_m, _DELAY_S)
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
        SimulationSettings(standard_crossing_distance_m=crossing_m),
        MockItsGateway(),
        green_wave_mode=mode,
    )


def _run(engine: SimulationEngine) -> tuple[list[EngineState], list[SimulationTickEvent]]:
    """Every state after each step (index t-1 is the state at t s), and every tick."""
    state, states, ticks = engine.initial_state(), [], []
    while not state.completed:
        state, events = engine.step(state, _NOW)
        states.append(state)
        ticks.extend(event for event in events if isinstance(event, SimulationTickEvent))
    return states, ticks


def _at(states: list[EngineState], seconds: int) -> EngineState:
    return states[seconds - 1]


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


def test_enabled_mode_keeps_the_minimum_dwell() -> None:
    states, _ = _run(_engine(GreenWaveMode.ENABLED))
    final = states[-1]
    assert final.arrived_at_s == pytest.approx(200 / 13 + 3)
    assert final.speed_limited_remaining_m == 0.0


def test_disabled_mode_waits_the_density_scaled_clearance() -> None:
    states, _ = _run(_engine(GreenWaveMode.DISABLED))
    assert _at(states, 7).distance_travelled_m == _STOP_M
    assert _at(states, 7).dwell_remaining_s == pytest.approx(_CLEARANCE_S - (7 - 90 / 13))
    assert _at(states, 36).distance_travelled_m == _STOP_M  # dwell ends at ~36.92 s


def test_disabled_crossing_is_speed_limited_across_the_edge_end_then_resumes() -> None:
    """The cap must follow the crossing over the edge boundary and stop exactly at its end."""
    states, _ = _run(_engine(GreenWaveMode.DISABLED))
    assert _at(states, 37).distance_travelled_m == pytest.approx(
        _STOP_M + _LIMIT_MPS * (37 - _DWELL_END_S)
    )
    assert _at(states, 38).distance_travelled_m == pytest.approx(
        _STOP_M + _LIMIT_MPS * (38 - _DWELL_END_S)
    )
    assert _at(states, 38).current_edge_index == 1  # past 100 m, still at the limit
    crossing_end_s = _DWELL_END_S + _CROSSING_M / _LIMIT_MPS
    assert _at(states, 39).distance_travelled_m == pytest.approx(
        _STOP_M + _CROSSING_M + _AMBULANCE_MPS * (39 - crossing_end_s)
    )
    assert _at(states, 39).speed_limited_remaining_m == 0.0
    assert _at(states, 40).distance_travelled_m - _at(states, 39).distance_travelled_m == (
        pytest.approx(_AMBULANCE_MPS)
    )


def test_disabled_arrival_and_kpi_reflect_the_actual_motion() -> None:
    states, ticks = _run(_engine(GreenWaveMode.DISABLED))
    expected = (200 - _CROSSING_M) / _AMBULANCE_MPS + _CLEARANCE_S + _CROSSING_M / _LIMIT_MPS
    assert states[-1].arrived_at_s == pytest.approx(expected)
    assert ticks[-1].kpi_metrics.total_time_elapsed_sec == round(expected)


def test_disabled_status_reports_the_whole_crossing() -> None:
    _, ticks = _run(_engine(GreenWaveMode.DISABLED))
    statuses = {seconds: ticks[seconds - 1].ambulance.status for seconds in (6, 20, 38, 40)}
    assert statuses == {
        6: AmbulanceStatus.EN_ROUTE,
        20: AmbulanceStatus.CROSSING_INTERSECTION,
        38: AmbulanceStatus.CROSSING_INTERSECTION,
        40: AmbulanceStatus.EN_ROUTE,
    }
    assert ticks[37].ambulance.speed_kmh == pytest.approx(_LIMIT_MPS * 3.6)


def test_a_zero_crossing_distance_only_adds_the_clearance() -> None:
    states, _ = _run(_engine(GreenWaveMode.DISABLED, crossing_m=0.0))
    assert states[-1].arrived_at_s == pytest.approx(200 / 13 + _CLEARANCE_S)


def test_a_stop_line_inside_a_crossing_starts_its_own_clearance_and_crossing() -> None:
    states, _ = _run(_engine(GreenWaveMode.DISABLED, stop_lines=(_STOP_M, 100.0)))
    expected = (
        _STOP_M / _AMBULANCE_MPS
        + _CLEARANCE_S
        + 10.0 / _LIMIT_MPS  # 90 -> 100 capped, then INT-2 clears again
        + _CLEARANCE_S
        + _CROSSING_M / _LIMIT_MPS  # 100 -> 120 capped
        + 80.0 / _AMBULANCE_MPS
    )
    assert states[-1].arrived_at_s == pytest.approx(expected)


def test_disabled_mode_is_deterministic() -> None:
    first, first_ticks = _run(_engine(GreenWaveMode.DISABLED))
    second, second_ticks = _run(_engine(GreenWaveMode.DISABLED))
    assert first == second
    assert first_ticks == second_ticks


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("standard_crossing_distance_m", -1),
        ("standard_clearance_factor", -0.1),
        ("standard_crossing_distance_m", float("inf")),
        ("standard_clearance_factor", float("nan")),
    ],
)
def test_standard_crossing_settings_reject_invalid_values(field: str, value: float) -> None:
    with pytest.raises(ValidationError):
        SimulationSettings(**{field: value})
