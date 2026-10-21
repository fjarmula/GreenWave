"""Deterministic simulated signal phases for the map's high-zoom detail.

An explanatory abstraction, not lane-level signalling or real Kraków timings: each intersection's
signals alternate in two movement groups (by signal-key order), each green, then yellow, then
all-red. Every signal also gets a pedestrian indication for the crossing over the arm it controls,
green only while the other group has green. Priority states override only that pattern.

Each vehicle light then changes only GREEN -> YELLOW -> RED -> GREEN: yellow lasts the configured
interval, and a light turns green only once every light not also turning green is red. So a
priority override never shows an impossible jump.
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
from greenwave.simulation.state import EngineState, SignalHead
from greenwave.simulation_settings import SimulationSettings

_GROUPS = 2
GREEN, YELLOW, RED = SignalPhaseColor.GREEN, SignalPhaseColor.YELLOW, SignalPhaseColor.RED


def project_signal_phases(
    route_model: RouteModel, state: EngineState, settings: SimulationSettings
) -> list[SignalPhaseIndicator]:
    """The indications :func:`advance_signal_phases` shows for ``state``."""
    return advance_signal_phases(route_model, state, settings)[1]


def advance_signal_phases(
    route_model: RouteModel, state: EngineState, settings: SimulationSettings
) -> tuple[tuple[SignalHead, ...], list[SignalPhaseIndicator]]:
    """Shown vehicle lights and the indications of every route intersection with known signals.

    Targets: ``CLEARING`` sends conflicting vehicles and all pedestrians to red; the route approach
    keeps its cycle colour. ``PRIORITY_GREEN`` targets the route approach green and everything else
    red. ``NORMAL`` and ``RECOVERY`` follow the cycle. ``state.signal_heads`` (what was shown last)
    then limits each vehicle light to legal changes; without it the targets are shown directly.
    """
    now = float(state.simulated_time_s)
    previous = state.signal_heads
    heads: list[SignalHead] = []
    indicators: list[SignalPhaseIndicator] = []
    for item, runtime in route_runtimes(route_model, state):
        targets: list[tuple[SignalPhaseColor, SignalPhaseColor]] = []
        for position, signal in enumerate(item.signals):
            vehicle, pedestrian = _cycle_colors(position % _GROUPS, now, settings)
            on_route = not set(signal.controlled_edge_ids).isdisjoint(item.approach_edge_ids)
            if runtime.state is IntersectionState.PRIORITY_GREEN:
                vehicle, pedestrian = (GREEN if on_route else RED), RED
            elif runtime.state is IntersectionState.CLEARING:
                vehicle, pedestrian = (vehicle if on_route else RED), RED
            targets.append((vehicle, pedestrian))
        prior = previous[len(heads) : len(heads) + len(item.signals)] if previous else ()
        shown = [
            _shown(
                prior[i] if prior else None,
                vehicle,
                now,
                settings,
                # Green only once every light not also turning green has stopped.
                may_turn_green=all(
                    other.color is RED
                    for j, other in enumerate(prior)
                    if j != i and targets[j][0] is not GREEN
                ),
            )
            for i, (vehicle, _) in enumerate(targets)
        ]
        heads.extend(shown)
        for signal, head, (_, pedestrian) in zip(item.signals, shown, targets, strict=True):
            # Walkers never get green beside a vehicle light that is still showing go or clear.
            walk = pedestrian if head.color is RED else RED
            indicators.append(_indicator(item, signal, SignalMovementKind.VEHICLE, head.color))
            indicators.append(_indicator(item, signal, SignalMovementKind.PEDESTRIAN, walk))
    return tuple(heads), indicators


def _shown(
    prior: SignalHead | None,
    target: SignalPhaseColor,
    now: float,
    settings: SimulationSettings,
    may_turn_green: bool,
) -> SignalHead:
    """The next shown vehicle light: GREEN -> YELLOW -> RED -> GREEN only."""
    if prior is None:
        return SignalHead(target, now)
    if prior.color is GREEN:
        return prior if target is GREEN else SignalHead(YELLOW, now)
    if prior.color is YELLOW:
        if now - prior.since_s >= settings.signal_yellow_seconds:
            return SignalHead(RED, now)
        return prior
    return SignalHead(GREEN, now) if target is GREEN and may_turn_green else prior


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
