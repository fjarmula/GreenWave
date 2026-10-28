"""Route-order views of the intersection runtimes: time to each stop line and the hold there."""

from collections.abc import Iterator

from greenwave.schemas import IntersectionState
from greenwave.simulation.route_model import RouteIntersection, RouteModel
from greenwave.simulation.state import EngineState
from greenwave.simulation.state_machine import IntersectionRuntime

ACTIVE_STATES: frozenset[IntersectionState] = frozenset(
    {IntersectionState.CLEARING, IntersectionState.PRIORITY_GREEN}
)


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
