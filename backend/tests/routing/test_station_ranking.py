import logging

import pytest
from tests.support.route_fixtures import (
    PARK_CENTRE,
    branch_index,
    corridor_index,
    corridor_stations,
    park_index,
    park_stations,
    position_at,
    stations_frame,
)

from greenwave.its import MockItsGateway
from greenwave.routing.errors import DestinationOffNetwork, NoRoute, NoStationReachable
from greenwave.routing.estimates import estimate_times
from greenwave.routing.network_index import RoutingIndex
from greenwave.routing.planner import PlannedRoute, plan_route
from greenwave.routing.station_ranking import StationNode, build_station_nodes, rank_stations
from greenwave.schemas import Position, SimulationStartRequest, VehicleType
from greenwave.simulation.assembly import plan_simulation
from greenwave.simulation.route_model import build_route_model
from greenwave.simulation_settings import SimulationSettings

_X = 7_421_000.0
_Y = 5_541_000.0
SETTINGS = SimulationSettings()


def _corridor() -> tuple[RoutingIndex, tuple[StationNode, ...]]:
    index = corridor_index()
    return index, build_station_nodes(corridor_stations(), index)


def _brute_force_best(
    index: RoutingIndex,
    nodes: tuple[StationNode, ...],
    incident: Position,
    vehicle_type: VehicleType,
) -> str:
    best: tuple[float, str] | None = None
    for node in nodes:
        if node.station.vehicle_type != vehicle_type:
            continue
        try:
            route = plan_route(index, node.station.position, incident, SETTINGS)
        except NoRoute:
            continue
        model = build_route_model(route, index, SETTINGS, False)
        seconds = estimate_times(route, model, 1.0, SETTINGS).greenwave_seconds
        best = min(best or (seconds, node.station.station_id), (seconds, node.station.station_id))
    assert best is not None
    return best[1]


@pytest.mark.parametrize("incident_x", [_X + 1_350, _X + 1_850.02, _X + 1_950.02])
def test_winner_matches_bruteforce(incident_x: float) -> None:
    index, nodes = _corridor()
    incident = position_at(incident_x)

    ranking = rank_stations(index, nodes, incident, VehicleType.AMBULANCE, SETTINGS)

    expected = _brute_force_best(index, nodes, incident, VehicleType.AMBULANCE)
    assert ranking.candidates[0].station.station_id == expected


def test_candidates_sorted_and_capped_at_three() -> None:
    index, nodes = _corridor()

    ranking = rank_stations(
        index, nodes, position_at(_X + 1_950.02), VehicleType.AMBULANCE, SETTINGS
    )

    ids = [c.station.station_id for c in ranking.candidates]
    assert ids == ["STN-A-0004", "STN-A-0003", "STN-A-0002"]
    seconds = [c.greenwave_seconds for c in ranking.candidates]
    assert seconds == sorted(seconds)
    assert all(c.distance_m > 0 for c in ranking.candidates)


def test_displayed_time_matches_preflight() -> None:
    index, nodes = _corridor()
    incident = position_at(_X + 1_950.02)
    winner = rank_stations(index, nodes, incident, VehicleType.AMBULANCE, SETTINGS).candidates[0]
    request = SimulationStartRequest(
        simulation_id="SIM-rank",
        origin=winner.station.position,
        destination=incident,
        traffic_density_multiplier=2.0,
        enable_cascade_mode=True,
    )

    response = plan_simulation(index, request, SETTINGS, MockItsGateway()).response

    assert response.estimated_greenwave_time_sec == round(winner.greenwave_seconds)
    assert response.total_distance_m == pytest.approx(winner.distance_m)


def test_filters_by_vehicle_type() -> None:
    index, nodes = _corridor()

    ranking = rank_stations(
        index, nodes, position_at(_X + 1_950.02), VehicleType.FIRE_TRUCK, SETTINGS
    )

    assert [c.station.station_id for c in ranking.candidates] == ["STN-F-0001"]


def test_station_at_incident_reported_and_skipped() -> None:
    index, nodes = _corridor()

    ranking = rank_stations(
        index, nodes, position_at(_X + 1_850.02), VehicleType.AMBULANCE, SETTINGS
    )

    assert ranking.station_at_incident is not None
    assert ranking.station_at_incident.station_id == "STN-A-0004"
    assert "STN-A-0004" not in [c.station.station_id for c in ranking.candidates]
    assert ranking.candidates[0].station.station_id == "STN-A-0003"


def test_off_network_incident_raises() -> None:
    index, nodes = _corridor()

    with pytest.raises(DestinationOffNetwork):
        rank_stations(
            index, nodes, position_at(_X + 1_000, _Y + 5_000), VehicleType.AMBULANCE, SETTINGS
        )


def test_no_station_reachable_raises() -> None:
    index = corridor_index()
    nodes = build_station_nodes(stations_frame(("STN-A-0001", "AMBULANCE", _X + 5_000, _Y)), index)

    with pytest.raises(NoStationReachable):
        rank_stations(index, nodes, position_at(_X + 1_850.02), VehicleType.AMBULANCE, SETTINGS)


def test_no_station_of_type_raises() -> None:
    index, nodes = _corridor()

    with pytest.raises(NoStationReachable):
        rank_stations(index, nodes, position_at(_X + 1_850.02), VehicleType.POLICE_CAR, SETTINGS)


def test_deterministic_tie_break() -> None:
    index = branch_index()
    stations = stations_frame(
        ("STN-A-0002", "AMBULANCE", _X + 100, _Y + 50),
        ("STN-A-0001", "AMBULANCE", _X + 100, _Y - 50),
    )
    nodes = build_station_nodes(stations, index)

    ranking = rank_stations(index, nodes, position_at(_X + 200), VehicleType.AMBULANCE, SETTINGS)

    assert [c.station.station_id for c in ranking.candidates] == ["STN-A-0001", "STN-A-0002"]
    assert ranking.candidates[0].greenwave_seconds == ranking.candidates[1].greenwave_seconds


def test_shortlist_size_limits_full_estimates() -> None:
    index, nodes = _corridor()
    settings = SimulationSettings(dispatch_shortlist_size=1)

    ranking = rank_stations(
        index, nodes, position_at(_X + 1_950.02), VehicleType.AMBULANCE, settings
    )

    assert [c.station.station_id for c in ranking.candidates] == ["STN-A-0004"]


def test_unsnappable_station_skipped_with_warning(caplog: pytest.LogCaptureFixture) -> None:
    index = corridor_index()
    stations = stations_frame(
        ("STN-A-0001", "AMBULANCE", _X + 1_000, _Y),
        ("STN-A-0002", "AMBULANCE", _X + 1_000, _Y + 5_000),
    )

    with caplog.at_level(logging.WARNING):
        nodes = build_station_nodes(stations, index)

    assert [n.station.station_id for n in nodes] == ["STN-A-0001"]
    assert "STN-A-0002" in caplog.text


# --- Off-road incidents: drive + walk ---------------------------------------------------------

PARK = position_at(*PARK_CENTRE)


def _total(route: PlannedRoute) -> float:
    assert route.on_foot is not None
    model = build_route_model(route, park_index(), SETTINGS, False)
    return (
        estimate_times(route, model, 1.0, SETTINGS).greenwave_seconds
        + route.on_foot.on_foot_seconds
    )


def test_off_road_orders_by_total() -> None:
    index = park_index()
    ranking = rank_stations(
        index, build_station_nodes(park_stations(), index), PARK, VehicleType.AMBULANCE, SETTINGS
    )
    assert [c.station.station_id for c in ranking.candidates] == ["STN-A-0002", "STN-A-0001"]
    assert [c.on_foot.node_key for c in ranking.candidates if c.on_foot] == ["s-mid", "n-mid"]
    assert ranking.incident_snap.node_key == "s-mid"
    assert ranking.station_at_incident is None
    totals = [
        c.greenwave_seconds + c.on_foot.on_foot_seconds for c in ranking.candidates if c.on_foot
    ]
    assert totals == sorted(totals)


def test_off_road_matches_brute_force() -> None:
    index = park_index()
    nodes = build_station_nodes(park_stations(), index)
    ranking = rank_stations(index, nodes, PARK, VehicleType.AMBULANCE, SETTINGS)
    brute = min(
        nodes,
        key=lambda n: _total(plan_route(index, n.station.position, PARK, SETTINGS)),
    )
    assert ranking.candidates[0].station == brute.station


def test_unreachable_access_nodes_skip_the_station() -> None:
    index = park_index(trap=True)
    trapped = stations_frame(("STN-A-0003", "AMBULANCE", _X + 500, _Y - 900))
    stations = build_station_nodes(park_stations().vstack(trapped), index)
    ranking = rank_stations(index, stations, PARK, VehicleType.AMBULANCE, SETTINGS)
    assert "STN-A-0003" not in [c.station.station_id for c in ranking.candidates]
    assert len(ranking.candidates) == 2
    with pytest.raises(NoStationReachable):
        rank_stations(
            index, build_station_nodes(trapped, index), PARK, VehicleType.AMBULANCE, SETTINGS
        )
