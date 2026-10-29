"""Savings compare priority with the ambulance run without priority, on the same route."""

import pytest
from tests.simulation.test_motion_modes import GREEN, RED, _engine, _run

from greenwave.schemas import GreenWaveMode, SignalPhaseColor


@pytest.mark.parametrize("phase", [None, GREEN, RED])
def test_standard_run_never_claims_savings(phase: SignalPhaseColor | None) -> None:
    _, ticks = _run(_engine(GreenWaveMode.DISABLED, phase=phase))
    assert all(tick.kpi_metrics.current_time_saved_sec == 0 for tick in ticks)


@pytest.mark.parametrize("phase", [None, GREEN, RED])
def test_priority_saving_is_the_difference_from_the_standard_run(
    phase: SignalPhaseColor | None,
) -> None:
    standard, _ = _run(_engine(GreenWaveMode.DISABLED, phase=phase))
    priority, ticks = _run(_engine(GreenWaveMode.ENABLED, phase=phase))
    assert standard[-1].arrived_at_s is not None
    assert priority[-1].arrived_at_s is not None
    expected = round(standard[-1].arrived_at_s) - round(priority[-1].arrived_at_s)
    assert ticks[-1].kpi_metrics.current_time_saved_sec == expected
    # Recovery cannot change trip savings after arrival.
    assert all(
        tick.kpi_metrics.current_time_saved_sec == expected
        for state, tick in zip(priority, ticks, strict=True)
        if state.arrived
    )


def test_live_standard_profile_matches_the_standard_vehicle_positions() -> None:
    """The live KPI follows the crossing's time loss, rather than a fraction of total savings."""
    engine = _engine(GreenWaveMode.DISABLED, phase=RED)
    states, _ = _run(engine)
    for state in states:
        elapsed = state.arrived_at_s if state.arrived_at_s is not None else state.simulated_time_s
        assert engine.standard_profile.seconds_at(state.distance_travelled_m) == pytest.approx(
            elapsed
        )
