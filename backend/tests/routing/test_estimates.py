import pytest
from tests.support.route_fixtures import corridor_index, position_at

from greenwave.routing.estimates import estimate_times
from greenwave.routing.planner import plan_route
from greenwave.simulation.route_model import build_route_model
from greenwave.simulation_settings import SimulationSettings


@pytest.mark.parametrize("multiplier", [1.0, 3.0])
def test_estimates_apply_route_delays_once_per_unique_intersection(multiplier: float) -> None:
    """Summing approach delays would charge INT-TWIN twice and inflate both travel estimates."""
    settings = SimulationSettings()
    index = corridor_index()
    route = plan_route(index, position_at(7_422_000), position_at(7_422_850.02), settings)
    model = build_route_model(route, index, settings, cascade_enabled=True)

    estimates = estimate_times(route, model, multiplier, settings)

    assert estimates.normal_seconds == pytest.approx(85.002 * multiplier + 100)
    assert estimates.greenwave_seconds == pytest.approx(850.02 / 13 + 12)
