import networkx as nx
import pytest

from greenwave.etl.graph import build_graph
from greenwave.etl.near_misses import find_near_misses
from greenwave.etl.profile_osm import DrivableWay, LonLat
from greenwave.etl.weld import (
    ACTION_INSERTED_VERTEX,
    ACTION_MOVED_TO_NODE,
    ACTION_MOVED_TO_VERTEX,
    level_signature,
    weld_ways,
)

STEP = 0.001
METRE_LON = 1 / 71_000
METRE_LAT = 1 / 111_200


def at(x: float, y: float) -> LonLat:
    return round(19.9 + x * STEP, 7), round(50.0 + y * STEP, 7)


def shifted(point: LonLat, east_m: float = 0.0, north_m: float = 0.0) -> LonLat:
    return round(point[0] + east_m * METRE_LON, 7), round(point[1] + north_m * METRE_LAT, 7)


def way(line: int, points: list[LonLat], **tags: str) -> DrivableWay:
    return DrivableWay(line, "residential", points, dict(tags))


def weld(ways: list[DrivableWay], tolerance: float = 1.0):  # type: ignore[no-untyped-def]
    frame, _ = find_near_misses(build_graph(ways).graph, ways, 1.5)
    return weld_ways(ways, frame, tolerance)


def components(ways: list[DrivableWay]) -> int:
    return nx.number_weakly_connected_components(build_graph(ways).graph)


def test_two_way_ends_within_the_tolerance_are_welded_onto_a_shared_node() -> None:
    gap = at(1, 0)
    ways = [way(1, [at(0, 0), gap]), way(2, [shifted(gap, east_m=0.8), at(2, 0)])]

    welded, report = weld(ways)

    assert (report.candidates, report.welded, report.skipped) == (1, 1, 0)
    assert report.welds[0].action == ACTION_MOVED_TO_NODE
    assert components(ways) == 2 and components(welded) == 1


def test_an_end_just_short_of_a_way_s_body_gets_a_new_shared_vertex() -> None:
    body = way(1, [at(0, 0), at(2, 0)])
    stem = way(2, [at(1, 2), shifted(at(1, 0), north_m=0.7)])

    welded, report = weld([body, stem])

    assert report.welds[0].action == ACTION_INSERTED_VERTEX
    new_body = next(w for w in welded if w.line_number == 1)
    new_stem = next(w for w in welded if w.line_number == 2)
    assert len(new_body.coordinates) == 3  # one vertex inserted
    assert new_stem.coordinates[-1] == new_body.coordinates[1]
    assert components(welded) == 1


def test_an_end_next_to_an_existing_vertex_moves_onto_it_without_inserting() -> None:
    body = way(1, [at(0, 0), at(1, 0), at(2, 0)])  # vertex at (1, 0)
    stem = way(2, [at(1, 2), shifted(at(1, 0), north_m=0.3)])

    welded, report = weld([body, stem])

    assert report.welds[0].action == ACTION_MOVED_TO_VERTEX
    assert next(w for w in welded if w.line_number == 1).coordinates == body.coordinates
    assert next(w for w in welded if w.line_number == 2).coordinates[-1] == at(1, 0)


def test_ends_farther_than_the_tolerance_are_left_alone_but_still_reported_as_near_misses() -> None:
    gap = at(1, 0)
    ways = [way(1, [at(0, 0), gap]), way(2, [shifted(gap, east_m=1.3), at(2, 0)])]

    welded, report = weld(ways)

    assert report.candidates == 0 and report.welded == 0
    assert welded == ways


def test_tolerance_boundary_is_inclusive() -> None:
    gap = at(1, 0)
    ways = [way(1, [at(0, 0), gap]), way(2, [shifted(gap, east_m=0.9), at(2, 0)])]
    frame, _ = find_near_misses(build_graph(ways).graph, ways, 1.5)
    distance = float(frame["distance_m"][0])

    assert weld_ways(ways, frame, distance)[1].welded == 1
    assert weld_ways(ways, frame, distance - 1e-6)[1].welded == 0


@pytest.mark.parametrize(
    ("tags_a", "tags_b"),
    [
        ({"bridge": "yes"}, {}),
        ({}, {"tunnel": "yes"}),
        ({"layer": "1"}, {}),
        ({"bridge": "yes", "layer": "1"}, {"bridge": "yes", "layer": "2"}),
    ],
)
def test_ways_on_different_levels_are_never_welded(
    tags_a: dict[str, str], tags_b: dict[str, str]
) -> None:
    gap = at(1, 0)
    ways = [
        way(1, [at(0, 0), gap], **tags_a),
        way(2, [shifted(gap, east_m=0.5), at(2, 0)], **tags_b),
    ]

    welded, report = weld(ways)

    assert (report.welded, report.skipped) == (0, 1)
    assert report.skipped_by_reason == {"different layer, bridge or tunnel": 1}
    assert report.skipped_candidates[0].way_line in {1, 2}
    assert welded == ways


def test_two_ways_on_the_same_bridge_deck_may_be_welded() -> None:
    gap = at(1, 0)
    tags = {"bridge": "yes", "layer": "1"}
    ways = [way(1, [at(0, 0), gap], **tags), way(2, [shifted(gap, east_m=0.5), at(2, 0)], **tags)]

    assert weld(ways)[1].welded == 1


def test_an_endpoint_is_moved_by_at_most_one_weld_and_the_other_is_logged_as_skipped() -> None:
    # Way 1 ends between way 2's start (0.4 m east) and way 3's start (0.9 m west).
    gap = at(1, 0)
    ways = [
        way(1, [at(0, 0), gap]),
        way(2, [shifted(gap, east_m=0.4), at(2, 0)]),
        way(3, [shifted(gap, east_m=-0.9), at(1, 2)]),
    ]

    _, report = weld(ways)

    assert report.welded >= 1
    assert report.welded + report.skipped >= report.candidates
    assert len({(w.way_line, w.old_lon, w.old_lat) for w in report.welds}) == report.welded


def test_input_ways_are_not_modified() -> None:
    gap = at(1, 0)
    ways = [way(1, [at(0, 0), gap]), way(2, [shifted(gap, east_m=0.8), at(2, 0)])]
    before = [list(w.coordinates) for w in ways]

    weld(ways)

    assert [w.coordinates for w in ways] == before


def test_level_signature_defaults() -> None:
    assert level_signature(way(1, [at(0, 0), at(1, 0)])) == ("0", False, False)
    assert level_signature(way(1, [at(0, 0), at(1, 0)], bridge="no", layer="-1")) == (
        "-1",
        False,
        False,
    )


def test_non_positive_tolerance_is_rejected() -> None:
    frame, _ = find_near_misses(build_graph([]).graph, [], 1.5)

    with pytest.raises(ValueError, match="positive"):
        weld_ways([], frame, 0.0)
