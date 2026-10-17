from tests.support.route_fixtures import corridor_index, position_at

from greenwave.its import MockItsGateway
from greenwave.routing.estimates import estimate_times
from greenwave.routing.planner import plan_route
from greenwave.schemas import SimulationStartRequest
from greenwave.simulation.assembly import plan_simulation
from greenwave.simulation.engine import SimulationEngine
from greenwave.simulation.route_model import build_route_model, to_start_response
from greenwave.simulation_settings import SimulationSettings

_X = 7_421_000.0


def test_plan_simulation_matches_start_response_of_parts() -> None:
    settings, index, gateway = SimulationSettings(), corridor_index(), MockItsGateway()
    request = SimulationStartRequest.model_validate(
        {
            "simulation_id": "SIM-plan",
            "origin": position_at(_X + 1_000).model_dump(),
            "destination": position_at(_X + 1_850.02).model_dump(),
            "traffic_density_multiplier": 1.5,
            "enable_cascade_mode": True,
        }
    )

    planned = plan_simulation(index, request, settings, gateway)

    route = plan_route(index, request.origin, request.destination, settings)
    model = build_route_model(route, index, settings, True)
    estimates = estimate_times(route, model, 1.5, settings)
    engine = SimulationEngine("SIM-plan", route, model, estimates, 1.5, settings, gateway)
    assert planned.response == to_start_response("SIM-plan", route, model, estimates, index)
    assert planned.engine.initial_state() == engine.initial_state()
