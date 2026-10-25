"""The pre-run standard estimate is a dry run of disabled motion (spec D4)."""

import pytest
from tests.simulation.test_motion_modes import (
    _DENSITY,
    GREEN,
    RED,
    YELLOW,
    _engine,
    _run,
    _two_line_engine,
)

from greenwave.schemas import GreenWaveMode, SignalPhaseColor
from greenwave.simulation.standard_estimate import standard_run_seconds


@pytest.mark.parametrize("phase", [None, GREEN, YELLOW, RED])
def test_standard_estimate_equals_the_disabled_engine_run(phase: SignalPhaseColor | None) -> None:
    engine = _engine(GreenWaveMode.DISABLED, phase=phase)
    states, _ = _run(engine)

    assert (
        standard_run_seconds(engine.route, engine.route_model, _DENSITY, engine.settings)
        == states[-1].arrived_at_s
    )


def test_standard_estimate_matches_a_two_line_junction_run() -> None:
    engine = _two_line_engine(RED)
    states, _ = _run(engine)

    assert (
        standard_run_seconds(engine.route, engine.route_model, _DENSITY, engine.settings)
        == states[-1].arrived_at_s
    )


def test_standard_estimate_without_junctions_is_open_road_time() -> None:
    engine = _engine(GreenWaveMode.DISABLED, stop_lines=())

    assert standard_run_seconds(
        engine.route, engine.route_model, _DENSITY, engine.settings
    ) == pytest.approx(200 / 13)


def test_standard_estimate_works_with_a_zero_speed_floor() -> None:
    """``speed_floor_meters_per_second`` only floors the smoothed speed; 0 is a valid setting."""
    settings = {"speed_floor_meters_per_second": 0.0}
    engine = _engine(GreenWaveMode.DISABLED, phase=RED, settings=settings)
    states, _ = _run(engine)

    assert (
        standard_run_seconds(engine.route, engine.route_model, _DENSITY, engine.settings)
        == states[-1].arrived_at_s
    )
