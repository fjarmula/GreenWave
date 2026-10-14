import json

from greenwave.etl.graph import build_graph
from greenwave.etl.profile_osm import DrivableWay, LonLat
from greenwave.etl.route_checks import run_route_checks

STEP = 0.001


def at(x: int, y: int) -> LonLat:
    return round(19.9 + x * STEP, 7), round(50.0 + y * STEP, 7)


def way(line: int, points: list[LonLat], **tags: str) -> DrivableWay:
    return DrivableWay(line, "residential", points, dict(tags))


def _fixture() -> tuple[list[DrivableWay], tuple[tuple[str, str], ...]]:
    # Two named rondos joined by a bent road; the second leg makes the route a detour.
    ring_a = way(
        1,
        [at(0, 0), at(0, 1), at(1, 1), at(1, 0), at(0, 0)],
        name="Rondo Mogilskie",
        junction="roundabout",
    )
    ring_b = way(
        2,
        [at(6, 0), at(6, 1), at(7, 1), at(7, 0), at(6, 0)],
        name="Rondo Grunwaldzkie",
        junction="roundabout",
    )
    road = way(3, [at(1, 0), at(3, 0), at(3, 3), at(6, 0)])
    return [ring_a, ring_b, road], (("Rondo Mogilskie", "Rondo Grunwaldzkie"),)


def test_route_is_found_measured_against_straight_line_and_written_as_geojson() -> None:
    ways, pairs = _fixture()
    graph = build_graph(ways).graph

    result = run_route_checks(graph, ways, pairs)

    (check,) = result.checks
    assert check.route_found
    assert check.route_length_km is not None and check.straight_line_km is not None
    assert check.detour_ratio is not None and check.detour_ratio > 1.0
    assert check.origin_snap_m is not None and check.origin_snap_m < 150
    kinds = [f["properties"]["kind"] for f in result.geojson["features"]]  # type: ignore[index]
    assert kinds == ["route", "start", "end"]
    route = result.geojson["features"][0]["geometry"]  # type: ignore[index]
    assert route["type"] == "LineString"
    lon, lat = route["coordinates"][0]
    assert 19.8 < lon < 20.0 and 49.9 < lat < 50.1  # WGS84, not metric coordinates
    json.dumps(result.geojson)


def test_unlocatable_place_is_reported_not_guessed() -> None:
    ways, _ = _fixture()
    graph = build_graph(ways).graph

    result = run_route_checks(graph, ways, (("Rondo Mogilskie", "Rondo Hipokratesa"),))

    (check,) = result.checks
    assert not check.route_found
    assert check.note == "place could not be located from street names"
    assert result.geojson["features"] == []


def test_detour_range_flags_a_route_outside_the_window() -> None:
    ways, pairs = _fixture()
    graph = build_graph(ways).graph

    (check,) = run_route_checks(graph, ways, pairs, detour_range=(1.0, 1.0001)).checks

    assert check.within_expected_range is False


def test_share_of_length_on_default_speed_counts_only_class_defaults() -> None:
    ways, pairs = _fixture()
    ways[2] = way(3, [at(1, 0), at(3, 0), at(3, 3), at(6, 0)], maxspeed="40")  # the connecting road
    graph = build_graph(ways).graph

    (with_limit,) = run_route_checks(graph, ways, pairs).checks
    ways_default, pairs_default = _fixture()
    (without_limit,) = run_route_checks(
        build_graph(ways_default).graph, ways_default, pairs_default
    ).checks

    assert without_limit.share_of_length_on_default_speed == 1.0
    assert with_limit.share_of_length_on_default_speed is not None
    assert with_limit.share_of_length_on_default_speed < 0.5  # only the ring pieces are defaults
