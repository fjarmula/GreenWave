"""Advance every route intersection one simulated second, including one-hop cascade (D16)."""

from collections.abc import Iterator
from dataclasses import dataclass

from greenwave.schemas import IntersectionState
from greenwave.simulation.route_model import RouteIntersection, RouteModel
from greenwave.simulation.state import EngineState
from greenwave.simulation.state_machine import IntersectionRuntime, Transition, advance_intersection
from greenwave.simulation_settings import SimulationSettings

ACTIVE_STATES: frozenset[IntersectionState] = frozenset(
    {IntersectionState.CLEARING, IntersectionState.PRIORITY_GREEN}
)


@dataclass(frozen=True, slots=True)
class CorridorAdvance:
    runtimes: tuple[IntersectionRuntime, ...]
    entered_clearing: tuple[str, ...]


def route_runtimes(
    route_model: RouteModel, state: EngineState
) -> Iterator[tuple[RouteIntersection, IntersectionRuntime]]:
    """Each route intersection with its runtime, in route order."""
    return zip(route_model.intersections, state.intersection_runtimes, strict=True)


def time_to_intersection(
    stop_line_m: float, runtime: IntersectionRuntime, state: EngineState
) -> float | None:
    """Seconds until ``stop_line_m`` at the smoothed speed; ``None`` once passed."""
    if runtime.passed:
        return None
    return max(0.0, stop_line_m - state.distance_travelled_m) / state.v_avg_meters_per_second


def holding_priority(
    item: RouteIntersection, state: EngineState, released_before_m: float | None
) -> bool:
    """Whether ``item`` must not count as passed yet, although its last stop line is reached.

    The vehicle may be stopped there (dwelling or held for green; several intersections may share
    the line, so any wait there counts), or have crossed it during the interval the map is still
    animating (at or after ``released_before_m``). A destination on the last stop line holds only
    while the interval that brought the vehicle onto it is shown; then nothing is left to cross.
    """
    waiting = (
        not state.arrived
        and state.dwelling_intersection_id is not None
        and state.distance_travelled_m == item.last_stop_line_m
    )
    if waiting or released_before_m is None:
        return waiting
    if state.arrived and state.distance_travelled_m <= item.last_stop_line_m:
        return item.last_stop_line_m > released_before_m
    return item.last_stop_line_m >= released_before_m


def advance_corridor(
    route_model: RouteModel,
    state: EngineState,
    settings: SimulationSettings,
    priority_enabled: bool = True,
    released_before_m: float | None = None,
) -> CorridorAdvance:
    """Own-TTI pass in route order, then one cascade pass over each own entry's targets.

    ``entered_clearing`` lists own entries in route order followed by cascade entries in
    source/target order; that order is the ITS dispatch group order. Without priority (ER Green
    Wave disabled) intersections stay ``NORMAL`` and are only marked passed, so nothing clears,
    cascades or dispatches.
    """
    if not priority_enabled:
        return CorridorAdvance(
            tuple(
                IntersectionRuntime(passed=True)
                if not runtime.passed
                and item.last_stop_line_m <= state.distance_travelled_m
                and not holding_priority(item, state, released_before_m)
                else runtime
                for item, runtime in route_runtimes(route_model, state)
            ),
            (),
        )
    intersections = route_model.intersections
    advanced: list[IntersectionRuntime] = []
    own: list[str] = []
    for item, runtime in route_runtimes(route_model, state):
        updated, transition = _advance_one(item, runtime, state, False, settings, released_before_m)
        advanced.append(updated)
        if transition is Transition.CLEARING:
            own.append(item.id)

    entered = list(own)
    positions = {item.id: index for index, item in enumerate(intersections)}
    for source in own:
        for target_id in route_model.cascade_targets(source):
            index = positions[target_id]
            updated, transition = _advance_one(
                intersections[index], advanced[index], state, True, settings, released_before_m
            )
            advanced[index] = updated
            if transition is Transition.CLEARING:
                entered.append(target_id)
    return CorridorAdvance(tuple(advanced), tuple(entered))


def _advance_one(
    item: RouteIntersection,
    runtime: IntersectionRuntime,
    state: EngineState,
    cascade_trigger: bool,
    settings: SimulationSettings,
    released_before_m: float | None,
) -> tuple[IntersectionRuntime, Transition | None]:
    return advance_intersection(
        runtime,
        time_to_intersection(item.first_stop_line_m, runtime, state),
        item.last_stop_line_m - state.distance_travelled_m,
        float(state.simulated_time_s),
        cascade_trigger,
        settings,
        priority_held=holding_priority(item, state, released_before_m),
    )
