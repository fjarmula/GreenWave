import pytest

from greenwave.etl.graph import build_graph
from greenwave.etl.near_misses import KIND_END_TO_NODE, KIND_END_TO_SEGMENT, find_near_misses
from greenwave.etl.profile_osm import DrivableWay, LonLat

STEP = 0.001
METRE_LON = 1 / 71_000  # about one metre of longitude at 50 degrees north
METRE_LAT = 1 / 111_200


def at(x: float, y: float) -> LonLat:
    return round(19.9 + x * STEP, 7), round(50.0 + y * STEP, 7)


def shifted(point: LonLat, east_m: float = 0.0, north_m: float = 0.0) -> LonLat:
    return round(point[0] + east_m * METRE_LON, 7), round(point[1] + north_m * METRE_LAT, 7)


def way(line: int, points: list[LonLat], **tags: str) -> DrivableWay:
    return DrivableWay(line, "residential", points, dict(tags))


def run(ways: list[DrivableWay], tolerance: float = 1.5):  # type: ignore[no-untyped-def]
    return find_near_misses(build_graph(ways).graph, ways, tolerance)


def test_two_way_ends_a_metre_apart_without_a_shared_vertex_are_reported_once() -> None:
    gap_start = at(1, 0)
    ways = [
        way(1, [at(0, 0), gap_start], name="Lewa"),
        way(2, [shifted(gap_start, east_m=1.0), at(2, 0)], name="Prawa"),
    ]

    frame, report = run(ways)

    assert report.near_misses == 1
    row = frame.to_dicts()[0]
    assert row["kind"] == KIND_END_TO_NODE
    assert row["distance_m"] == pytest.approx(1.0, abs=0.1)
    assert {row["way_line"], row["other_way_line"]} == {1, 2}
    assert {row["street"], row["other_street"]} == {"Lewa", "Prawa"}


def test_end_just_short_of_another_way_s_body_is_a_segment_near_miss() -> None:
    body = way(1, [at(0, 0), at(2, 0)])
    stem_end = shifted(at(1, 0), north_m=1.0)
    stem = way(2, [at(1, 2), stem_end])

    frame, report = run([body, stem])

    assert report.by_kind == {KIND_END_TO_SEGMENT: 1}
    assert frame["distance_m"][0] == pytest.approx(1.0, abs=0.1)


def test_tolerance_boundary_is_inclusive() -> None:
    gap_start = at(1, 0)
    ways = [
        way(1, [at(0, 0), gap_start]),
        way(2, [shifted(gap_start, east_m=1.0), at(2, 0)]),
    ]
    frame, _ = run(ways, tolerance=5.0)
    distance = float(frame["distance_m"][0])

    assert run(ways, tolerance=distance)[0].height == 1
    assert run(ways, tolerance=distance - 1e-6)[0].height == 0


def test_ways_that_share_a_vertex_are_not_reported() -> None:
    joint = at(1, 0)
    frame, report = run([way(1, [at(0, 0), joint]), way(2, [joint, at(2, 0)])])

    assert frame.height == 0 and report.near_misses == 0


def test_ends_farther_apart_than_the_tolerance_are_not_reported() -> None:
    gap_start = at(1, 0)
    ways = [
        way(1, [at(0, 0), gap_start]),
        way(2, [shifted(gap_start, east_m=3.0), at(2, 0)]),
    ]

    assert run(ways)[0].height == 0


def test_a_way_is_not_a_near_miss_of_itself() -> None:
    start = at(0, 0)
    loop = way(1, [start, at(1, 0), at(1, 1), shifted(start, east_m=1.0)])

    assert run([loop])[0].height == 0


def test_non_positive_tolerance_is_rejected() -> None:
    with pytest.raises(ValueError, match="positive"):
        find_near_misses(build_graph([]).graph, [], 0.0)
