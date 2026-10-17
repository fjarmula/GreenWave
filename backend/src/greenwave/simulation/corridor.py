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


def advance_corridor(
    route_model: RouteModel, state: EngineState, settings: SimulationSettings
) -> CorridorAdvance:
    """Own-TTI pass in route order, then one cascade pass over each own entry's targets.

    ``entered_clearing`` lists own entries in route order followed by cascade entries in
    source/target order; that order is the ITS dispatch group order.
    """
    intersections = route_model.intersections
    advanced: list[IntersectionRuntime] = []
    own: list[str] = []
    for item, runtime in route_runtimes(route_model, state):
        updated, transition = _advance_one(item, runtime, state, False, settings)
        advanced.append(updated)
        if transition is Transition.CLEARING:
            own.append(item.id)

    entered = list(own)
    positions = {item.id: index for index, item in enumerate(intersections)}
    for source in own:
        for target_id in route_model.cascade_targets(source):
            index = positions[target_id]
            updated, transition = _advance_one(
                intersections[index], advanced[index], state, True, settings
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
) -> tuple[IntersectionRuntime, Transition | None]:
    return advance_intersection(
        runtime,
        time_to_intersection(item.first_stop_line_m, runtime, state),
        item.last_stop_line_m - state.distance_travelled_m,
        float(state.simulated_time_s),
        cascade_trigger,
        settings,
    )
