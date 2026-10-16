"""Pure normal-traffic and priority-corridor travel-time estimates."""

from dataclasses import dataclass
from typing import TYPE_CHECKING

from greenwave.routing.planner import PlannedRoute, ambulance_speed_kmh
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
    normal_motion = sum(
        length_m * multiplier / (speed_kmh / 3.6)
        for length_m, speed_kmh in zip(route.edge_lengths_m, route.edge_speeds_kmh, strict=True)
    )
    greenwave_motion = sum(
        length_m / (ambulance_speed_kmh(speed_kmh, settings) / 3.6)
        for length_m, speed_kmh in zip(route.edge_lengths_m, route.edge_speeds_kmh, strict=True)
    )
    return Estimates(
        normal_seconds=normal_motion
        + sum(intersection.delay_seconds for intersection in route_model.intersections),
        greenwave_seconds=greenwave_motion
        + len(route_model.intersections) * settings.min_intersection_delay_seconds,
    )
