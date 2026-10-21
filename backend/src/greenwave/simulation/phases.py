"""Deterministic simulated signal phases for the map's high-zoom detail.

An explanatory abstraction, not lane-level signalling or real Kraków timings: each intersection's
signals alternate in two movement groups (by signal-key order), each green, then yellow, then
all-red. Every signal also gets a pedestrian indication for the crossing over the arm it controls,
green only while the other group has green. Priority states override only that pattern.
"""

from greenwave.routing.network_index import SignalApproachRef
from greenwave.schemas import (
    IntersectionState,
    Position,
    SignalMovementKind,
    SignalPhaseColor,
    SignalPhaseIndicator,
)
from greenwave.simulation.corridor import route_runtimes
from greenwave.simulation.route_model import RouteIntersection, RouteModel
from greenwave.simulation.state import EngineState
from greenwave.simulation_settings import SimulationSettings

_GROUPS = 2
GREEN, YELLOW, RED = SignalPhaseColor.GREEN, SignalPhaseColor.YELLOW, SignalPhaseColor.RED


def project_signal_phases(
    route_model: RouteModel, state: EngineState, settings: SimulationSettings
) -> list[SignalPhaseIndicator]:
    """Vehicle and pedestrian indications of every route intersection with known signals.

    ``CLEARING`` ends conflicting vehicle green with yellow and stops pedestrians; the route
    approach keeps its cycle colour. ``PRIORITY_GREEN`` gives the route approach green and holds
    everything else red. ``NORMAL`` and ``RECOVERY`` follow the cycle.
    """
    indicators: list[SignalPhaseIndicator] = []
    for item, runtime in route_runtimes(route_model, state):
        for position, signal in enumerate(item.signals):
            vehicle, pedestrian = _cycle_colors(
                position % _GROUPS, state.simulated_time_s, settings
            )
            on_route = not set(signal.controlled_edge_ids).isdisjoint(item.approach_edge_ids)
            if runtime.state is IntersectionState.PRIORITY_GREEN:
                vehicle, pedestrian = (GREEN if on_route else RED), RED
            elif runtime.state is IntersectionState.CLEARING:
                if not on_route and vehicle is not RED:
                    vehicle = YELLOW
                pedestrian = RED
            indicators.append(_indicator(item, signal, SignalMovementKind.VEHICLE, vehicle))
            indicators.append(_indicator(item, signal, SignalMovementKind.PEDESTRIAN, pedestrian))
    return indicators


def _cycle_colors(
    group: int, now_s: float, settings: SimulationSettings
) -> tuple[SignalPhaseColor, SignalPhaseColor]:
    """(vehicle, pedestrian) colours of ``group`` at ``now_s`` in the normal two-group cycle."""
    green, yellow = settings.signal_green_seconds, settings.signal_yellow_seconds
    slot = green + yellow + settings.signal_all_red_seconds
    phase = now_s % (slot * _GROUPS)
    active = int(phase // slot)
    within = phase - active * slot
    if group != active:
        return RED, GREEN if within < green else RED
    return (GREEN if within < green else YELLOW if within < green + yellow else RED), RED


def _indicator(
    item: RouteIntersection,
    signal: SignalApproachRef,
    kind: SignalMovementKind,
    color: SignalPhaseColor,
) -> SignalPhaseIndicator:
    return SignalPhaseIndicator(
        intersection_id=item.id,
        signal_key=signal.signal_key,
        kind=kind,
        color=color,
        position=Position(lat=signal.lat, lng=signal.lon),
        accessible_label=(
            f"Simulated {kind.lower()} signal {signal.signal_key} at {item.id}: {color.lower()}"
        ),
    )
