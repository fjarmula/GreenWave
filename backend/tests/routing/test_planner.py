import pytest
from tests.support.route_fixtures import corridor_index, position_at

from greenwave.routing.errors import DestinationOffNetwork, NoRoute, OriginOffNetwork
from greenwave.routing.planner import plan_route
from greenwave.simulation_settings import SimulationSettings


def test_planner_chooses_fastest_path_not_shortest_length() -> None:
    """Replacing ambulance-time weighting with length weighting selects the slow direct edge."""
    route = plan_route(
        corridor_index(),
        position_at(7_421_000),
        position_at(7_421_100),
        SimulationSettings(),
    )

    assert route.edge_ids == ("fast-a", "fast-b")
    assert route.total_distance_m == pytest.approx(120)


def test_planner_rejects_disconnected_and_off_network_endpoints() -> None:
    """A planner that invents connectivity or accepts remote positions hides routing failures."""
    index = corridor_index()
    with pytest.raises(NoRoute):
        plan_route(index, position_at(7_426_000), position_at(7_421_000), SimulationSettings())
    with pytest.raises(OriginOffNetwork):
        plan_route(index, position_at(7_450_000), position_at(7_421_000), SimulationSettings())
    with pytest.raises(DestinationOffNetwork):
        plan_route(index, position_at(7_421_000), position_at(7_450_000), SimulationSettings())


def test_planner_rejects_a_zero_edge_route() -> None:
    """Returning an empty route for identical endpoints leaves the simulation without kinematics."""
    origin = position_at(7_421_000)
    with pytest.raises(NoRoute, match="same node"):
        plan_route(corridor_index(), origin, origin, SimulationSettings())


def test_planner_builds_contiguous_polyline_and_ordered_stop_lines() -> None:
    """Dropping edge joints or sorting stops by id gives an incorrect visual/engine route."""
    route = plan_route(
        corridor_index(),
        position_at(7_422_000),
        position_at(7_422_850.02),
        SimulationSettings(),
    )

    assert len(route.polyline_wgs84) == len(set(route.polyline_wgs84))
    origin = position_at(7_422_000)
    assert route.polyline_wgs84[0] == pytest.approx((origin.lng, origin.lat))
    assert route.stop_lines == tuple(
        sorted(route.stop_lines, key=lambda stop: stop.distance_along_route_m)
    )
    assert [stop.intersection_id for stop in route.stop_lines] == [
        "INT-A",
        "INT-TWIN",
        "INT-TWIN",
        "INT-C",
        "INT-B",
    ]
