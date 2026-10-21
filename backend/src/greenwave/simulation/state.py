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
    # Disabled mode: metres of the current controlled crossing still capped at the speed limit.
    speed_limited_remaining_m: float = 0.0
    # Shown vehicle lights of every route signal, in projection order; empty before the first tick.
    signal_heads: tuple[SignalHead, ...] = ()
