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
