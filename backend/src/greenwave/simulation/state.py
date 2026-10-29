"""Immutable per-second engine state."""

from dataclasses import dataclass

from greenwave.schemas import SignalPhaseColor
from greenwave.simulation.state_machine import IntersectionRuntime


@dataclass(frozen=True, slots=True)
class SignalHead:
    """The vehicle light a viewer last saw for one simulated signal, and since when."""

    color: SignalPhaseColor
    since_s: float


@dataclass(frozen=True, slots=True)
class EngineState:
    """``dwelling_intersection_id`` marks an enabled-mode safety hold at a first stop line.

    ``dwell_remaining_s`` is only a degenerate enabled-mode fallback (no room to roll ``D_min``);
    disabled mode never dwells.
    """

    simulated_time_s: int
    distance_travelled_m: float
    current_edge_index: int
    dwell_remaining_s: float
    dwelling_intersection_id: str | None
    v_avg_meters_per_second: float
    intersection_runtimes: tuple[IntersectionRuntime, ...]
    tick: int
    message_sequence: int
    arrived: bool
    completed: bool
    arrived_at_s: float | None = None
    # Metres of the current controlled crossing (disabled) or D_min slowdown (enabled) still to
    # drive, and the extra seconds still to spread over them (simulation/motion.py).
    cautious_crossing_remaining_m: float = 0.0
    cautious_time_remaining_s: float = 0.0
    # Shown vehicle lights of every route signal, in projection order; empty before the first tick.
    signal_heads: tuple[SignalHead, ...] = ()
    # Enabled mode: the intersection whose D_min slowdown has started, so it starts only once.
    slowdown_intersection_id: str | None = None
    # Whether the current crossing includes a standard-traffic crossing, which rolls at no more
    # than the ordinary limit (always so with ER Green Wave disabled).
    crossing_is_standard: bool = False
    # Enabled mode: intersections whose priority request failed; they are crossed by standard
    # rules (CrossingStrategy.STANDARD_FALLBACK) for the rest of the run.
    fallback_intersection_ids: frozenset[str] = frozenset()


def initial_engine_state(intersection_count: int, v_avg_meters_per_second: float) -> EngineState:
    """The state at t = 0: at the origin, every intersection NORMAL and not passed."""
    return EngineState(
        simulated_time_s=0,
        distance_travelled_m=0.0,
        current_edge_index=0,
        dwell_remaining_s=0.0,
        dwelling_intersection_id=None,
        v_avg_meters_per_second=v_avg_meters_per_second,
        intersection_runtimes=tuple(IntersectionRuntime() for _ in range(intersection_count)),
        tick=0,
        message_sequence=0,
        arrived=False,
        completed=False,
    )
