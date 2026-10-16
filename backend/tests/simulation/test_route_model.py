from tests.support.route_fixtures import corridor_index, position_at

from greenwave.routing.estimates import Estimates
from greenwave.routing.planner import plan_route
from greenwave.simulation.route_model import build_route_model, to_start_response
from greenwave.simulation_settings import SimulationSettings


def test_route_model_groups_multiple_approaches_and_uses_first_stop_line_for_cascade() -> None:
    """Every approach or a last line would duplicate delays or change cascade bounds."""
    settings = SimulationSettings()
    index = corridor_index()
    route = plan_route(index, position_at(7_422_000), position_at(7_422_850.02), settings)
    model = build_route_model(route, index, settings, cascade_enabled=True)

    actual = [
        (item.id, item.first_stop_line_m, item.last_stop_line_m, item.delay_seconds)
        for item in model.intersections
    ]
    assert actual == [
        ("INT-A", 100, 100, 10),
        ("INT-TWIN", 350, 600.01, 20),
        ("INT-C", 600.01, 600.01, 30),
        ("INT-B", 850.02, 850.02, 40),
    ]
    assert model.cascade_targets("INT-A") == ("INT-TWIN",)
    assert model.cascade_targets("INT-TWIN") == ()


def test_route_model_disables_cascade_without_changing_route_intersections() -> None:
    """A cascade toggle that drops route intersections loses required simulation telemetry."""
    settings = SimulationSettings()
    index = corridor_index()
    route = plan_route(index, position_at(7_422_000), position_at(7_422_850.02), settings)

    model = build_route_model(route, index, settings, cascade_enabled=False)

    assert [item.id for item in model.intersections] == ["INT-A", "INT-TWIN", "INT-C", "INT-B"]
    assert model.cascade_targets("INT-A") == ()


def test_start_response_uses_route_ordered_intersection_metadata_and_snaps() -> None:
    """Returning ETL order instead of route order misaligns frontend markers and telemetry."""
    settings = SimulationSettings()
    index = corridor_index()
    route = plan_route(index, position_at(7_422_000), position_at(7_422_850.02), settings)
    model = build_route_model(route, index, settings, cascade_enabled=True)

    response = to_start_response(
        simulation_id="route-model-test",
        route=route,
        route_model=model,
        estimates=Estimates(normal_seconds=185.002, greenwave_seconds=77.386153846),
        index=index,
    )

    assert response.intersections_on_route == ["INT-A", "INT-TWIN", "INT-C", "INT-B"]
    assert response.route_intersections[1].distance_along_route_m == 350
    assert response.route_intersections[1].position == position_at(7_422_350)
    assert response.origin_snapped.position == position_at(7_422_000)
