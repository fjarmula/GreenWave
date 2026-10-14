import networkx as nx
import pytest

from greenwave.etl.connectivity import analyse_connectivity
from greenwave.etl.graph import build_graph
from greenwave.etl.profile_osm import DrivableWay, LonLat

STEP = 0.001


def at(x: int, y: int) -> LonLat:
    return round(19.9 + x * STEP, 7), round(50.0 + y * STEP, 7)


def way(line: int, points: list[LonLat], **tags: str) -> DrivableWay:
    return DrivableWay(line, "residential", points, dict(tags))


def test_islands_and_largest_strong_component_are_reported() -> None:
    main = [
        way(1, [at(0, 0), at(1, 0), at(2, 0)], name="Glowna"),
        way(2, [at(1, 0), at(1, 1)]),
    ]
    island = [way(3, [at(10, 10), at(11, 10)], name="Wyspa")]

    graph = build_graph(main + island).graph
    report = analyse_connectivity(graph)

    assert report.weak_components == 2
    assert report.island_count == 1
    assert report.islands_listed[0].top_streets == ["Wyspa"]
    assert report.largest_weak_nodes == 4
    assert report.largest_strong_nodes == 4
    total = report.road_length_km
    assert report.largest_strong_share_of_road_length == pytest.approx(
        1 - report.island_road_length_km / total
    )


def test_one_way_dead_end_is_a_trap_fragment_not_an_island() -> None:
    # A two-way road with a one-way spur: traffic can enter the spur's end but never leave it.
    graph = build_graph(
        [
            way(1, [at(0, 0), at(1, 0), at(2, 0)]),
            way(2, [at(1, 0), at(1, 1)], oneway="yes", name="Slepa"),
        ]
    ).graph

    report = analyse_connectivity(graph)

    assert report.island_count == 0
    assert report.largest_strong_nodes == 3
    assert report.one_way_trap_fragments == 1
    assert report.one_way_trap_fragments_listed[0].top_streets == ["Slepa"]
    assert nx.number_strongly_connected_components(graph) == 2


def test_empty_graph_is_an_error() -> None:
    with pytest.raises(ValueError, match="empty"):
        analyse_connectivity(nx.MultiDiGraph())
