"""Independent consistency check between route cascades and ETL neighbour candidates."""

from dataclasses import dataclass

from greenwave.routing.network_index import RoutingIndex
from greenwave.routing.planner import PlannedRoute, StopLineEvent
from greenwave.simulation.route_model import RouteModel

_DISTANCE_TOLERANCE_M = 0.01


@dataclass(frozen=True, slots=True)
class CascadeMismatch:
    source_id: str
    target_id: str
    source_edge_id: str
    target_edge_id: str
    along_route_m: float
    candidate_m: float | None


def find_cascade_mismatches(
    route: PlannedRoute, route_model: RouteModel, index: RoutingIndex
) -> tuple[CascadeMismatch, ...]:
    """Return cascade pairs absent from, or longer in, the independent candidate table."""
    first_stop_line: dict[str, StopLineEvent] = {}
    for stop_line in route.stop_lines:
        first_stop_line.setdefault(stop_line.intersection_id, stop_line)

    mismatches: list[CascadeMismatch] = []
    for source in route_model.intersections:
        source_stop = first_stop_line[source.id]
        for target_id in route_model.cascade_targets(source.id):
            target_stop = first_stop_line[target_id]
            along_route_m = target_stop.distance_along_route_m - source_stop.distance_along_route_m
            candidate_m = index.neighbour_candidate(source_stop.edge_id, target_stop.edge_id)
            if candidate_m is None or candidate_m > along_route_m + _DISTANCE_TOLERANCE_M:
                mismatches.append(
                    CascadeMismatch(
                        source_id=source.id,
                        target_id=target_id,
                        source_edge_id=source_stop.edge_id,
                        target_edge_id=target_stop.edge_id,
                        along_route_m=along_route_m,
                        candidate_m=candidate_m,
                    )
                )
    return tuple(mismatches)
