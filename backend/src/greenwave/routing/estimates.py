"""Pure normal-traffic and priority-corridor travel-time estimates."""

from dataclasses import dataclass
from typing import TYPE_CHECKING

from greenwave.routing.edge_times import ambulance_edge_seconds, normal_edge_seconds
from greenwave.routing.planner import PlannedRoute
from greenwave.simulation_settings import SimulationSettings

if TYPE_CHECKING:
    from greenwave.simulation.route_model import RouteModel


@dataclass(frozen=True, slots=True)
class Estimates:
    """Unrounded route duration estimates in seconds."""

    normal_seconds: float
    greenwave_seconds: float


def estimate_times(
    route: PlannedRoute,
    route_model: "RouteModel",
    multiplier: float,
    settings: SimulationSettings,
) -> Estimates:
    """Estimate normal and priority travel times for the exact already-selected route."""
    normal_motion = sum(normal_edge_seconds(edge, multiplier, settings) for edge in route.edges)
    greenwave_motion = sum(ambulance_edge_seconds(edge, settings) for edge in route.edges)
    return Estimates(
        normal_seconds=normal_motion
        + sum(intersection.delay_seconds for intersection in route_model.intersections),
        greenwave_seconds=greenwave_motion
        + len(route_model.intersections) * settings.min_intersection_delay_seconds,
    )
