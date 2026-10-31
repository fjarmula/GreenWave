"""Common rolling delay survives ordinary decisions, adjacent windows and fallback."""

from dataclasses import replace

import pytest
from tests.simulation.test_motion_modes import GREEN, _engine, _run, _two_line_engine
from tests.simulation.test_priority_fallback import _with_scenario

from greenwave.schemas import GreenWaveMode, ItsScenario, SignalPhaseColor
from greenwave.simulation.motion import move_one_second
from greenwave.simulation.route_track import RouteTrack


@pytest.mark.parametrize(
    "lines", [(0.0,), (90.0,), (0.5,), (200.0,), (90.0, 110.0), (190.0, 199.5)]
)
def test_standard_green_spends_one_common_delay_per_intersection(lines: tuple[float, ...]) -> None:
    engine = _engine(GreenWaveMode.DISABLED, stop_lines=lines, phase=GREEN)
    state = engine.initial_state()
    track = RouteTrack.from_route(engine.route, engine.settings)
    for _ in range(100):
        state, _ = move_one_second(
            state,
            track,
            engine.route_model,
            engine.settings,
            GreenWaveMode.DISABLED,
            1.5,
            lambda _id, _t: GREEN,
        )
        if state.arrived:
            break
    assert state.arrived_at_s == pytest.approx(200 / 13 + 3 * len(lines))


def test_multiple_green_lines_of_one_intersection_share_one_delay() -> None:
    engine = _two_line_engine(GREEN)
    states, _ = _run(engine)
    assert states[-1].arrived_at_s == pytest.approx(200 / 13 + 3)


@pytest.mark.parametrize("scenario", [ItsScenario.REJECTED, ItsScenario.NO_FEEDBACK])
def test_fallback_during_or_before_slowdown_keeps_exactly_one_common_delay(
    scenario: ItsScenario,
) -> None:
    engine = _with_scenario(_engine(GreenWaveMode.ENABLED, phase=GREEN), scenario)
    states, ticks = _run(engine)
    assert states[-1].fallback_intersection_ids == {"INT-1"}
    assert states[-1].arrived_at_s == pytest.approx(200 / 13 + 3)
    assert ticks[-1].kpi_metrics.current_time_saved_sec == 0


def test_common_delay_is_configurable_in_standard_mode() -> None:
    engine = _engine(
        GreenWaveMode.DISABLED, phase=GREEN, settings={"min_intersection_delay_seconds": 5}
    )
    states, _ = _run(engine)
    assert states[-1].arrived_at_s == pytest.approx(200 / 13 + 5)


def test_standard_profile_and_engine_match_after_common_delay() -> None:
    engine = _engine(GreenWaveMode.DISABLED, phase=GREEN)
    states, _ = _run(engine)
    assert engine.standard_profile.total_seconds == pytest.approx(200 / 13 + 3)
    assert states[-1].arrived_at_s == engine.standard_profile.total_seconds


def test_fallback_at_an_already_started_window_does_not_restart_delay() -> None:
    engine = _engine(GreenWaveMode.DISABLED, phase=GREEN)
    state = engine.initial_state()
    track = RouteTrack.from_route(engine.route, engine.settings)
    for tick in range(100):
        if tick == 4:
            state = replace(state, fallback_intersection_ids=frozenset({"INT-1"}))
        state, _ = move_one_second(
            state,
            track,
            engine.route_model,
            engine.settings,
            GreenWaveMode.ENABLED,
            1.5,
            lambda _id, _t: GREEN,
        )
        if state.arrived:
            break
    assert state.arrived_at_s == pytest.approx(200 / 13 + 3)


def test_standard_route_starting_at_red_line_still_decides() -> None:
    engine = _engine(GreenWaveMode.DISABLED, stop_lines=(0.0,))
    states, _ = _run(engine)
    # Unknown movement at the origin still incurs cautious crossing in addition to common delay.
    assert states[-1].arrived_at_s > 200 / 13 + 3 + 15


@pytest.mark.parametrize("phase", [GREEN, None])
def test_live_and_final_savings_use_the_corrected_same_route_standard_profile(
    phase: SignalPhaseColor | None,
) -> None:
    engine = _engine(GreenWaveMode.ENABLED, phase=phase)
    states, ticks = _run(engine)
    for state, tick in zip(states, ticks, strict=True):
        elapsed = state.arrived_at_s if state.arrived_at_s is not None else state.simulated_time_s
        expected = round(engine.standard_profile.seconds_at(state.distance_travelled_m)) - round(
            elapsed
        )
        assert tick.kpi_metrics.current_time_saved_sec == expected
    standard, _ = _run(_engine(GreenWaveMode.DISABLED, phase=phase))
    assert ticks[-1].kpi_metrics.current_time_saved_sec == (
        round(standard[-1].arrived_at_s) - round(states[-1].arrived_at_s)
    )
