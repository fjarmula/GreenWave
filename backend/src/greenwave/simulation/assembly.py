"""Turn a start request into a ready engine and its start response."""

from collections.abc import Callable
from dataclasses import dataclass

from greenwave.its import ItsGateway
from greenwave.routing.estimates import estimate_times
from greenwave.routing.network_index import RoutingIndex
from greenwave.routing.planner import plan_route
from greenwave.schemas import SimulationStartRequest, SimulationStartResponse
from greenwave.simulation.engine import SimulationEngine
from greenwave.simulation.route_model import build_route_model, to_start_response
from greenwave.simulation_settings import SimulationSettings


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
    density = request.traffic_density_multiplier
    estimates = estimate_times(route, route_model, density, settings)
    engine = SimulationEngine(
        request.simulation_id, route, route_model, estimates, density, settings, gateway
    )
    response = to_start_response(request.simulation_id, route, route_model, estimates, index)
    return PlannedSimulation(engine, response)
