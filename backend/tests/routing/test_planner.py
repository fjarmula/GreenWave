import pytest
from tests.support.route_fixtures import (
    PARK_CENTRE,
    branch_index,
    corridor_index,
    neutral_settings,
    park_index,
    position_at,
)

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


def test_planner_prefers_bus_lane_branch_when_boosted() -> None:
    origin, destination = position_at(7_421_000), position_at(7_421_200)
    neutral = plan_route(branch_index(), origin, destination, neutral_settings())
    other = "south" if neutral.edge_ids[0].startswith("north") else "north"
    bus_lanes = {f"{other}-a": {"bus_lane": True}, f"{other}-b": {"bus_lane": True}}

    unboosted = plan_route(branch_index(bus_lanes), origin, destination, neutral_settings())
    boosted = plan_route(
        branch_index(bus_lanes),
        origin,
        destination,
        neutral_settings(ambulance_bus_lane_factor=1.5),
    )

    assert unboosted.edge_ids == neutral.edge_ids
    assert boosted.edge_ids == (f"{other}-a", f"{other}-b")
    assert [edge.edge_id for edge in boosted.edges] == list(boosted.edge_ids)
    assert all(edge.bus_lane for edge in boosted.edges)


# --- Off-road destinations: on-foot access ----------------------------------------------------

_X, _Y = 7_421_000.0, 5_541_000.0
DEPOT_W = position_at(_X - 3_000, _Y + 900)
DEPOT_E = position_at(_X + 2_000, _Y)


def test_off_road_destination_picks_fastest_total_not_nearest() -> None:
    route = plan_route(park_index(), DEPOT_W, position_at(*PARK_CENTRE), SimulationSettings())
    assert route.destination_snap.node_key == "n-mid"
    assert route.on_foot is not None
    assert route.on_foot.node_key == "n-mid"
    assert route.on_foot.straight_m == pytest.approx(500, abs=1e-3)
    assert route.destination_snap.snap_distance_m == pytest.approx(500, abs=1e-3)


def test_off_road_destination_from_the_other_depot() -> None:
    route = plan_route(park_index(), DEPOT_E, position_at(*PARK_CENTRE), SimulationSettings())
    assert route.destination_snap.node_key == "s-mid"
    assert route.on_foot is not None
    assert route.on_foot.straight_m == pytest.approx(400, abs=1e-3)


def test_origin_on_an_access_node_uses_another() -> None:
    route = plan_route(
        park_index(),
        position_at(_X + 500, _Y + 900),
        position_at(*PARK_CENTRE),
        SimulationSettings(),
    )
    assert route.origin_snap.node_key == "n-mid"
    assert route.destination_snap.node_key == "s-mid"
    assert route.edge_ids


def test_on_road_destination_has_no_on_foot_leg() -> None:
    route = plan_route(
        corridor_index(), position_at(7_421_000), position_at(7_421_100), SimulationSettings()
    )
    assert route.on_foot is None


def test_off_road_origin_still_rejected() -> None:
    with pytest.raises(OriginOffNetwork):
        plan_route(park_index(), position_at(*PARK_CENTRE), DEPOT_E, SimulationSettings())
