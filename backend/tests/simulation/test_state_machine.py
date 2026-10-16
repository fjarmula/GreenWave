from dataclasses import replace

import pytest

from greenwave.schemas import IntersectionState
from greenwave.simulation.state_machine import (
    IntersectionRuntime,
    Transition,
    advance_intersection,
)
from greenwave.simulation_settings import SimulationSettings


@pytest.fixture
def settings() -> SimulationSettings:
    return SimulationSettings()


def advance(
    runtime: IntersectionRuntime,
    *,
    tti: float | None = 100.0,
    remaining: float = 1.0,
    now: float = 0.0,
    cascade: bool = False,
    settings: SimulationSettings,
) -> tuple[IntersectionRuntime, Transition | None]:
    return advance_intersection(runtime, tti, remaining, now, cascade, settings)


def test_own_tti_clears_at_boundary(settings: SimulationSettings) -> None:
    runtime, transition = advance(IntersectionRuntime(), tti=40.0, settings=settings)

    assert runtime.state is IntersectionState.CLEARING
    assert runtime.is_cascade is False
    assert transition is Transition.CLEARING


def test_normal_does_not_clear_above_boundary(settings: SimulationSettings) -> None:
    runtime, transition = advance(IntersectionRuntime(), tti=40.01, settings=settings)

    assert runtime == IntersectionRuntime()
    assert transition is None


def test_clearing_promotes_at_priority_boundary(settings: SimulationSettings) -> None:
    runtime, transition = advance(
        IntersectionRuntime(state=IntersectionState.CLEARING), tti=25.0, settings=settings
    )

    assert runtime.state is IntersectionState.PRIORITY_GREEN
    assert transition is Transition.PRIORITY_GREEN


def test_clearing_does_not_promote_above_priority_boundary(settings: SimulationSettings) -> None:
    runtime, transition = advance(
        IntersectionRuntime(state=IntersectionState.CLEARING), tti=25.01, settings=settings
    )

    assert runtime.state is IntersectionState.CLEARING
    assert transition is None


def test_cascade_marks_runtime_and_flag_survives_later_states(settings: SimulationSettings) -> None:
    runtime, transition = advance(IntersectionRuntime(), cascade=True, settings=settings)
    assert runtime.state is IntersectionState.CLEARING
    assert runtime.is_cascade is True
    assert transition is Transition.CLEARING

    runtime, _ = advance(runtime, tti=25.0, settings=settings)
    assert runtime.state is IntersectionState.PRIORITY_GREEN
    assert runtime.is_cascade is True


@pytest.mark.parametrize(
    "state",
    [IntersectionState.NORMAL, IntersectionState.CLEARING, IntersectionState.PRIORITY_GREEN],
)
def test_passing_transitions_any_pre_recovery_state_to_recovery(
    state: IntersectionState, settings: SimulationSettings
) -> None:
    runtime, transition = advance(
        IntersectionRuntime(state=state), remaining=0.0, now=7.0, settings=settings
    )

    assert runtime.state is IntersectionState.RECOVERY
    assert runtime.recovery_started_at_s == 7.0
    assert runtime.passed is True
    assert transition is Transition.RECOVERY


def test_recovery_returns_to_normal_at_exact_hold_boundary(settings: SimulationSettings) -> None:
    recovering = IntersectionRuntime(
        state=IntersectionState.RECOVERY, passed=True, recovery_started_at_s=7.0
    )
    runtime, transition = advance(recovering, now=22.0, settings=settings)

    assert runtime.state is IntersectionState.NORMAL
    assert runtime.passed is True
    assert transition is Transition.NORMAL


def test_passed_normal_never_reenters_clearing(settings: SimulationSettings) -> None:
    passed_normal = replace(IntersectionRuntime(passed=True), state=IntersectionState.NORMAL)
    runtime, transition = advance(passed_normal, tti=0.0, cascade=True, settings=settings)

    assert runtime == passed_normal
    assert transition is None
