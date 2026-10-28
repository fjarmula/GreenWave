"""The per-intersection runtime state the simulated ITS controller advances each second."""

from dataclasses import dataclass

from greenwave.schemas import IntersectionState


@dataclass(frozen=True)
class IntersectionRuntime:
    """The mutable-in-time portion of an intersection's simulation state."""

    state: IntersectionState = IntersectionState.NORMAL
    is_cascade: bool = False
    recovery_started_at_s: float | None = None
    passed: bool = False
