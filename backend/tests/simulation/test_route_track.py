from itertools import accumulate

import pytest
from tests.support.route_fixtures import RoadAttributes, route_edges

from greenwave.routing.edge_times import ambulance_speed_kmh
from greenwave.routing.planner import PlannedRoute, SnappedRouteEndpoint
from greenwave.schemas import Position
from greenwave.simulation.route_track import RouteTrack
from greenwave.simulation_settings import SimulationSettings


def _route(
    lengths: tuple[float, ...],
    speeds: tuple[float, ...] | None = None,
    road_attributes: RoadAttributes | None = None,
) -> PlannedRoute:
    starts = (0.0, *accumulate(lengths))[:-1]
    edge_ids = tuple(f"e{i}" for i in range(len(lengths)))
    return PlannedRoute(
        edge_ids=edge_ids,
        edge_lengths_m=lengths,
        edges=route_edges(
            edge_ids, lengths, speeds or tuple(36.0 for _ in lengths), road_attributes
        ),
        cumulative_m=tuple(starts),
        total_distance_m=sum(lengths),
        polyline_wgs84=[(19.0, 50.0), (19.1, 50.0)],
        origin_snap=SnappedRouteEndpoint("origin", Position(lat=50.0, lng=19.0), 0),
        destination_snap=SnappedRouteEndpoint("destination", Position(lat=50.0, lng=19.1), 0),
        stop_lines=(),
    )


def _linear_edge_at(route: PlannedRoute, distance: float) -> int:
    """The engine's original linear lookup, kept as the oracle."""
    return next(
        (
            i
            for i, start in enumerate(route.cumulative_m)
            if distance < start + route.edge_lengths_m[i]
        ),
        len(route.edge_lengths_m) - 1,
    )


@pytest.mark.parametrize("distance", [0.0, 9.999, 10.0, 10.0001, 15.0, 34.999, 35.0, 50.0])
def test_edge_at_matches_linear_scan_on_boundaries(distance: float) -> None:
    route = _route((10.0, 0.0, 5.0, 20.0))
    track = RouteTrack.from_route(route, SimulationSettings())

    assert track.edge_at(distance) == _linear_edge_at(route, distance)


def test_position_at_clamps_to_ends() -> None:
    track = RouteTrack.from_route(_route((100.0,)), SimulationSettings())

    assert track.position_at(-1.0) == Position(lat=50.0, lng=19.0)
    assert track.position_at(101.0) == Position(lat=50.0, lng=19.1)


def test_speed_mps_applies_ambulance_speed() -> None:
    settings = SimulationSettings()
    track = RouteTrack.from_route(_route((100.0, 100.0), (36.0, 50.0)), settings)

    assert track.speed_mps(1) == ambulance_speed_kmh(50.0, settings) / 3.6


def test_edge_end_is_start_plus_length() -> None:
    track = RouteTrack.from_route(_route((10.0, 5.0)), SimulationSettings())

    assert track.edge_end_m(1) == 15.0
    assert track.total_distance_m == 15.0


def test_route_track_speed_includes_calming_seconds() -> None:
    settings = SimulationSettings(ambulance_calming_seconds=5.0)
    route = _route((100.0, 100.0), road_attributes={"e0": {"calming_count": 2}})

    track = RouteTrack.from_route(route, settings)

    assert track.speed_mps(0) == pytest.approx(100.0 / (100.0 / 13.0 + 10.0))
    assert track.speed_mps(1) == pytest.approx(13.0)
