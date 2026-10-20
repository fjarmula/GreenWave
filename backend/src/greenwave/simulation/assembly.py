"""Turn a start request into a ready engine and its start response."""

import logging
from collections.abc import Callable
from dataclasses import dataclass

from greenwave.its import ItsGateway
from greenwave.routing.estimates import estimate_times
from greenwave.routing.network_index import RoutingIndex
from greenwave.routing.planner import plan_route
from greenwave.schemas import SimulationStartRequest, SimulationStartResponse
from greenwave.simulation.cascade_check import find_cascade_mismatches
from greenwave.simulation.engine import SimulationEngine
from greenwave.simulation.route_model import build_route_model, to_start_response
from greenwave.simulation_settings import SimulationSettings

logger = logging.getLogger("greenwave.simulation.cascade_check")


@dataclass(frozen=True, slots=True)
class PlannedSimulation:
    engine: SimulationEngine
    response: SimulationStartResponse


SimulationPlanner = Callable[
    [RoutingIndex, SimulationStartRequest, SimulationSettings, ItsGateway], PlannedSimulation
]


def plan_simulation(
    index: RoutingIndex,
    request: SimulationStartRequest,
    settings: SimulationSettings,
    gateway: ItsGateway,
) -> PlannedSimulation:
    """Route, model, estimate and configure; raises the routing errors of :func:`plan_route`."""
    route = plan_route(index, request.origin, request.destination, settings)
    route_model = build_route_model(route, index, settings, request.enable_cascade_mode)
    for mismatch in find_cascade_mismatches(route, route_model, index):
        logger.warning(
            "cascade candidate mismatch source_id=%s target_id=%s source_edge_id=%s "
            "target_edge_id=%s along_route_m=%s candidate_m=%s",
            mismatch.source_id,
            mismatch.target_id,
            mismatch.source_edge_id,
            mismatch.target_edge_id,
            mismatch.along_route_m,
            mismatch.candidate_m,
        )
    density = request.traffic_density_multiplier
    estimates = estimate_times(route, route_model, density, settings)
    engine = SimulationEngine(
        request.simulation_id,
        route,
        route_model,
        estimates,
        density,
        settings,
        gateway,
        request.vehicle_type,
    )
    response = to_start_response(request.simulation_id, route, route_model, estimates, index)
    return PlannedSimulation(engine, response)
