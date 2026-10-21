"""Deterministic simulated signal phases: one programme for motion and the map's high-zoom detail.

An explanatory abstraction, not lane-level signalling or real Kraków timings: each intersection's
signals alternate in two movement groups, each green, then yellow, then all-red. A signal's group
is its controlled approach identity (sorted controlled-edge ids); the sorted groups take the two
cycle slots by ordinal modulo two. ``traffic_signals`` nodes show a vehicle and a pedestrian
indication, ``pedestrian_crossing`` nodes a pedestrian one only; a pedestrian indication is for the
crossing over the arm its node controls, green only while the other slot has green. Priority
states override only that pattern, and only for vehicle lights on the route approach.

:func:`phase_decisions` is that programme. Motion samples the route movement from it at the exact
time it reaches a stop line; telemetry projects it at the completed tick. Only the shown vehicle
lights are then held to GREEN -> YELLOW -> RED -> GREEN: yellow lasts the configured interval, and
a light turns green only once every light not also turning green is red. Shown lights never feed
back into the programme.
"""

from collections.abc import Sequence
from dataclasses import dataclass

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
from greenwave.simulation.state_machine import IntersectionRuntime
from greenwave.simulation_settings import SimulationSettings

_GROUPS = 2
GREEN, YELLOW, RED = SignalPhaseColor.GREEN, SignalPhaseColor.YELLOW, SignalPhaseColor.RED
VEHICLE, PEDESTRIAN = SignalMovementKind.VEHICLE, SignalMovementKind.PEDESTRIAN
# Most restrictive first: several route lights on one approach permit only what all permit.
_RESTRICTIVENESS = {RED: 0, YELLOW: 1, GREEN: 2}


@dataclass(frozen=True, slots=True)
class PhaseDecision:
    """The programme's colour for one supported simulated movement of one signal node."""

    intersection_id: str
    signal_key: str
    kind: SignalMovementKind
    movement_color: SignalPhaseColor
    position: Position
    slot: int


def phase_decisions(
    route_model: RouteModel, state: EngineState, settings: SimulationSettings, at_s: float
) -> tuple[PhaseDecision, ...]:
    """Every supported movement of every route intersection at ``at_s``, in projection order."""
    return tuple(
        decision
        for item, runtime in route_runtimes(route_model, state)
        for decision in _intersection_decisions(item, runtime, settings, at_s)
    )


def route_movement_color_at(
    route_model: RouteModel,
    state: EngineState,
    intersection_id: str,
    at_s: float,
    settings: SimulationSettings,
) -> SignalPhaseColor | None:
    """The route vehicle movement's programme colour; ``None`` without a supported route signal."""
    for item, runtime in route_runtimes(route_model, state):
        if item.id == intersection_id:
            colors = [
                decision.movement_color
                for decision in _intersection_decisions(item, runtime, settings, at_s)
                if decision.kind is VEHICLE and decision.signal_key in item.route_signal_keys
            ]
            return min(colors, key=_RESTRICTIVENESS.__getitem__) if colors else None
    return None


def project_signal_phases(
    route_model: RouteModel, state: EngineState, settings: SimulationSettings
) -> list[SignalPhaseIndicator]:
    """The indications :func:`advance_signal_phases` shows for ``state``."""
    return advance_signal_phases(route_model, state, settings)[1]


def advance_signal_phases(
    route_model: RouteModel, state: EngineState, settings: SimulationSettings
) -> tuple[tuple[SignalHead, ...], list[SignalPhaseIndicator]]:
    """Shown vehicle lights and the indications of every route intersection with known signals.

    Targets come from :func:`phase_decisions` at ``state.simulated_time_s``: ``CLEARING`` sends
    conflicting vehicles and all pedestrians to red while the route approach keeps its cycle
    colour; ``PRIORITY_GREEN`` targets the route approach green and everything else red.
    ``state.signal_heads`` (vehicle lights shown last) then limits each vehicle light to legal
    changes; without it the targets are shown directly.
    """
    now = float(state.simulated_time_s)
    previous = state.signal_heads
    heads: list[SignalHead] = []
    indicators: list[SignalPhaseIndicator] = []
    for item, runtime in route_runtimes(route_model, state):
        decisions = _intersection_decisions(item, runtime, settings, now)
        vehicles = [decision for decision in decisions if decision.kind is VEHICLE]
        prior = previous[len(heads) : len(heads) + len(vehicles)] if previous else ()
        shown = [
            _shown(
                prior[i] if prior else None,
                vehicle.movement_color,
                now,
                settings,
                # Green only once every light not also turning green has stopped.
                may_turn_green=all(
                    other.color is RED
                    for j, other in enumerate(prior)
                    if j != i and vehicles[j].movement_color is not GREEN
                ),
            )
            for i, vehicle in enumerate(vehicles)
        ]
        heads.extend(shown)
        shown_by_key = {
            vehicle.signal_key: head.color for vehicle, head in zip(vehicles, shown, strict=True)
        }
        for decision in decisions:
            if decision.kind is VEHICLE:
                color = shown_by_key[decision.signal_key]
            else:
                # Walkers never get green beside a vehicle light of their arm that still shows
                # go or clear.
                clear = all(
                    shown_by_key[vehicle.signal_key] is RED
                    for vehicle in vehicles
                    if vehicle.slot == decision.slot
                )
                color = decision.movement_color if clear else RED
            indicators.append(_indicator(item, decision, color))
    return tuple(heads), indicators


def movement_slots(signals: Sequence[SignalApproachRef]) -> dict[str, int]:
    """Normal-cycle slot of each signal key: its movement group's sorted ordinal modulo two.

    Signals controlling the same approach edges share a group, so they always agree; a signal
    controlling no edge has no group and no slot. Independent of the order of ``signals``.
    """
    groups = sorted({group for signal in signals if (group := signal.movement_group)})
    ordinal = {group: index % _GROUPS for index, group in enumerate(groups)}
    return {
        signal.signal_key: ordinal[group]
        for signal in signals
        if (group := signal.movement_group) is not None
    }


def _intersection_decisions(
    item: RouteIntersection,
    runtime: IntersectionRuntime,
    settings: SimulationSettings,
    at_s: float,
) -> list[PhaseDecision]:
    slots = movement_slots(item.signals)
    decisions: list[PhaseDecision] = []
    for signal in item.signals:
        slot = slots.get(signal.signal_key)
        if slot is None:
            continue
        vehicle, pedestrian = _cycle_colors(slot, at_s, settings)
        on_route = signal.signal_key in item.route_signal_keys
        if runtime.state is IntersectionState.PRIORITY_GREEN:
            vehicle, pedestrian = (GREEN if on_route else RED), RED
        elif runtime.state is IntersectionState.CLEARING:
            vehicle, pedestrian = (vehicle if on_route else RED), RED
        colors = {VEHICLE: vehicle, PEDESTRIAN: pedestrian}
        decisions.extend(
            PhaseDecision(
                intersection_id=item.id,
                signal_key=signal.signal_key,
                kind=kind,
                movement_color=colors[kind],
                position=Position(lat=signal.lat, lng=signal.lon),
                slot=slot,
            )
            for kind in signal.movement_kinds
        )
    return decisions


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
    item: RouteIntersection, decision: PhaseDecision, color: SignalPhaseColor
) -> SignalPhaseIndicator:
    return SignalPhaseIndicator(
        intersection_id=item.id,
        signal_key=decision.signal_key,
        kind=decision.kind,
        color=color,
        position=decision.position,
        accessible_label=(
            f"Simulated {decision.kind.lower()} signal {decision.signal_key} at {item.id}: "
            f"{color.lower()}"
        ),
    )
