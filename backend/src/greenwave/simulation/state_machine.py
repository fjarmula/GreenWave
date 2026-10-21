"""Pure state transitions for a route intersection."""

from dataclasses import dataclass
from enum import StrEnum

from greenwave.schemas import IntersectionState
from greenwave.simulation_settings import SimulationSettings


class Transition(StrEnum):
    """The state entered by one call to :func:`advance_intersection`."""

    CLEARING = "CLEARING"
    PRIORITY_GREEN = "PRIORITY_GREEN"
    RECOVERY = "RECOVERY"
    NORMAL = "NORMAL"


@dataclass(frozen=True)
class IntersectionRuntime:
    """The mutable-in-time portion of an intersection's simulation state."""

    state: IntersectionState = IntersectionState.NORMAL
    is_cascade: bool = False
    recovery_started_at_s: float | None = None
    passed: bool = False


def advance_intersection(
    runtime: IntersectionRuntime,
    tti_s: float | None,
    remaining_to_last_m: float,
    now_s: float,
    cascade_trigger: bool,
    settings: SimulationSettings,
    priority_held: bool = False,
) -> tuple[IntersectionRuntime, Transition | None]:
    """Advance one intersection without reading a clock or performing I/O.

    Passing from ``NORMAL`` or ``CLEARING`` is deliberately permitted.  A one-second
    vehicle step can cross a closely-spaced stop line before its clearing threshold is
    observed; recovering directly prevents such an intersection getting stuck active.
    ``priority_held`` (the vehicle is stopped at the last stop line, or the map is still animating
    it across) means it has not passed yet: the intersection keeps, and may still gain, priority.
    """
    if runtime.state is IntersectionState.RECOVERY:
        recovery_started = runtime.recovery_started_at_s
        if (
            recovery_started is not None
            and now_s - recovery_started >= settings.recovery_hold_seconds
        ):
            return (
                IntersectionRuntime(
                    state=IntersectionState.NORMAL,
                    is_cascade=runtime.is_cascade,
                    recovery_started_at_s=recovery_started,
                    passed=True,
                ),
                Transition.NORMAL,
            )
        return runtime, None

    if runtime.passed:
        return runtime, None

    if remaining_to_last_m <= 0.0 and not priority_held:
        return (
            IntersectionRuntime(
                state=IntersectionState.RECOVERY,
                is_cascade=runtime.is_cascade,
                recovery_started_at_s=now_s,
                passed=True,
            ),
            Transition.RECOVERY,
        )

    if runtime.state is IntersectionState.NORMAL:
        if tti_s is not None and tti_s <= settings.clearing_tti_seconds:
            return (
                IntersectionRuntime(state=IntersectionState.CLEARING, is_cascade=False),
                Transition.CLEARING,
            )
        if cascade_trigger:
            return (
                IntersectionRuntime(state=IntersectionState.CLEARING, is_cascade=True),
                Transition.CLEARING,
            )
        return runtime, None

    if (
        runtime.state is IntersectionState.CLEARING
        and tti_s is not None
        and tti_s <= settings.priority_green_tti_seconds
    ):
        return (
            IntersectionRuntime(
                state=IntersectionState.PRIORITY_GREEN, is_cascade=runtime.is_cascade
            ),
            Transition.PRIORITY_GREEN,
        )
    return runtime, None
