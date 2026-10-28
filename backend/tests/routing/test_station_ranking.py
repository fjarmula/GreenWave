import logging

import polars as pl
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

from greenwave.dataset.errors import MalformedArtifactError
from greenwave.its import MockItsGateway
from greenwave.routing.access import walk_between
from greenwave.routing.errors import DestinationOffNetwork, NoRoute, NoStationReachable
from greenwave.routing.estimates import estimate_times
from greenwave.routing.network_index import RoutingIndex
from greenwave.routing.planner import PlannedRoute, plan_route, snap_endpoint
from greenwave.routing.station_ranking import StationNode, build_station_nodes, rank_stations
from greenwave.schemas import GreenWaveMode, Position, SimulationStartRequest, VehicleType
from greenwave.simulation.assembly import plan_simulation
from greenwave.simulation.route_model import build_route_model
from greenwave.simulation.standard_estimate import standard_run_seconds
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
    incident_node = snap_endpoint(index, incident, origin=False).node_key
    for node in nodes:
        if node.station.vehicle_type != vehicle_type:
            continue
        if node.node_key == incident_node:  # on site: the walk alone (ADR 0012)
            seconds = walk_between(node.station.position, incident, SETTINGS)[1]
            best = min(
                best or (seconds, node.station.station_id), (seconds, node.station.station_id)
            )
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


def test_displayed_standard_time_matches_the_standard_run() -> None:
    index, nodes = _corridor()
    incident = position_at(_X + 1_950.02)
    winner = rank_stations(
        index, nodes, incident, VehicleType.AMBULANCE, SETTINGS, traffic_density_multiplier=2.0
    ).candidates[0]
    request = SimulationStartRequest(
        simulation_id="SIM-rank-standard",
        origin=winner.station.position,
        destination=incident,
        traffic_density_multiplier=2.0,
        enable_cascade_mode=False,
        green_wave_mode=GreenWaveMode.DISABLED,
    )

    response = plan_simulation(index, request, SETTINGS, MockItsGateway()).response

    assert response.estimated_standard_time_sec == round(winner.standard_seconds)


def test_ranking_density_changes_only_the_standard_time() -> None:
    index, nodes = _corridor()
    incident = position_at(_X + 1_950.02)
    # Uncapped red-light loss, so the density reaches the standard time on this corridor.
    settings = SimulationSettings(standard_max_red_loss_seconds=600)

    light, heavy = (
        rank_stations(
            index, nodes, incident, VehicleType.AMBULANCE, settings, traffic_density_multiplier=d
        ).candidates
        for d in (1.0, 3.0)
    )

    assert [c.station for c in light] == [c.station for c in heavy]
    assert [c.greenwave_seconds for c in light] == [c.greenwave_seconds for c in heavy]
    for light_c, heavy_c in zip(light, heavy, strict=True):
        route = plan_route(index, light_c.station.position, incident, settings)
        model = build_route_model(route, index, settings, False)
        assert light_c.standard_seconds == standard_run_seconds(route, model, 1.0, settings)
        assert heavy_c.standard_seconds == standard_run_seconds(route, model, 3.0, settings)
    assert any(h.standard_seconds > c.standard_seconds for c, h in zip(light, heavy, strict=True))


def test_total_seconds_for_adds_the_walk_to_each_mode_drive() -> None:
    index, nodes = _corridor()
    candidate = rank_stations(
        index, nodes, position_at(_X + 1_950.02), VehicleType.AMBULANCE, SETTINGS
    ).candidates[0]

    assert candidate.total_seconds_for(GreenWaveMode.ENABLED) == candidate.greenwave_seconds
    assert candidate.total_seconds_for(GreenWaveMode.DISABLED) == candidate.standard_seconds


def test_filters_by_vehicle_type() -> None:
    index, nodes = _corridor()

    ranking = rank_stations(
        index, nodes, position_at(_X + 1_950.02), VehicleType.FIRE_TRUCK, SETTINGS
    )

    assert [c.station.station_id for c in ranking.candidates] == ["STN-F-0001"]


def test_station_on_the_incident_node_is_an_on_site_candidate() -> None:
    index, nodes = _corridor()

    ranking = rank_stations(
        index, nodes, position_at(_X + 1_850.02, _Y + 20), VehicleType.AMBULANCE, SETTINGS
    )

    first = ranking.candidates[0]
    assert first.on_site and first.station.station_id == "STN-A-0004"
    assert first.greenwave_seconds == first.standard_seconds == first.distance_m == 0.0
    assert first.walk_m == pytest.approx(20 * 1.3, rel=1e-6)
    assert first.total_seconds == pytest.approx(20 * 1.3 / 1.4, rel=1e-6)
    assert not any(c.on_site for c in ranking.candidates[1:])
    assert ranking.incident_snap.node_key == "corridor-4"


def test_incident_on_the_station_point_walks_zero_metres() -> None:
    index, nodes = _corridor()

    first = rank_stations(
        index, nodes, position_at(_X + 1_850.02), VehicleType.AMBULANCE, SETTINGS
    ).candidates[0]

    assert first.on_site and first.station.station_id == "STN-A-0004"
    assert first.walk_m == 0.0 and first.total_seconds == 0.0


def test_two_on_site_stations_tie_break_by_id() -> None:
    index = corridor_index()
    nodes = build_station_nodes(
        stations_frame(
            ("STN-A-0009", "AMBULANCE", _X + 1_850.02, _Y),
            ("STN-A-0004", "AMBULANCE", _X + 1_850.02, _Y),
            ("STN-A-0003", "AMBULANCE", _X + 1_600.01, _Y),
        ),
        index,
    )

    ranking = rank_stations(
        index, nodes, position_at(_X + 1_850.02), VehicleType.AMBULANCE, SETTINGS
    )

    assert [(c.station.station_id, c.on_site) for c in ranking.candidates] == [
        ("STN-A-0004", True),
        ("STN-A-0009", True),
        ("STN-A-0003", False),
    ]


def test_off_road_only_access_is_the_station_node() -> None:
    # 200 m south of the park centre: only s-mid (200 m) is within walking reach.
    index = park_index()
    stations = park_stations().vstack(stations_frame(("STN-A-0009", "AMBULANCE", _X + 500, _Y)))
    nodes = build_station_nodes(stations, index)

    ranking = rank_stations(
        index, nodes, position_at(_X + 500, _Y + 200), VehicleType.AMBULANCE, SETTINGS
    )

    first = ranking.candidates[0]
    assert first.on_site and first.station.station_id == "STN-A-0009"
    assert first.total_seconds == pytest.approx(200 * 1.3 / 1.4, rel=1e-6)
    assert all(not c.on_site for c in ranking.candidates[1:])


def test_off_road_prefers_driving_when_faster() -> None:
    # 600 m north of s-mid (walk 557 s) but 300 m south of n-mid, reached by road from s-mid.
    index = park_index()
    stations = stations_frame(("STN-A-0009", "AMBULANCE", _X + 500, _Y))
    nodes = build_station_nodes(stations, index)

    ranking = rank_stations(
        index, nodes, position_at(_X + 500, _Y + 600), VehicleType.AMBULANCE, SETTINGS
    )

    [only] = ranking.candidates
    assert not only.on_site and only.on_foot is not None
    assert only.total_seconds < 600 * 1.3 / 1.4


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


def test_fastest_of_a_set_joins_the_shortlist() -> None:
    index, nodes = _corridor()
    settings = SimulationSettings(dispatch_shortlist_size=1)

    ranking = rank_stations(
        index,
        nodes,
        position_at(_X + 1_950.02),
        VehicleType.AMBULANCE,
        settings,
        include_fastest_of=frozenset({"STN-A-0001", "STN-A-0002"}),
    )

    # The shortlist is STN-A-0004 plus the faster of the two, not both.
    assert [c.station.station_id for c in ranking.candidates] == ["STN-A-0004", "STN-A-0002"]


def test_max_candidates_lifts_the_cap() -> None:
    index, nodes = _corridor()

    ranking = rank_stations(
        index, nodes, position_at(_X + 1_950.02), VehicleType.AMBULANCE, SETTINGS, max_candidates=10
    )

    assert [c.station.station_id for c in ranking.candidates] == [
        "STN-A-0004", "STN-A-0003", "STN-A-0002", "STN-A-0001"
    ]  # fmt: skip


def test_off_network_prm_base_fails_startup() -> None:
    stations = stations_frame(("STN-A-0001", "AMBULANCE", _X + 1_000, _Y + 50_000)).with_columns(
        pl.lit("prm_base").alias("source_kind")
    )

    with pytest.raises(MalformedArtifactError, match="STN-A-0001"):
        build_station_nodes(stations, corridor_index())
