from pathlib import Path

import networkx as nx
import pytest

from greenwave.etl.graph import build_graph, node_key
from greenwave.etl.graph_io import read_graph, write_graph
from greenwave.etl.profile_osm import DrivableWay, LonLat

LON0, LAT0 = 19.9, 50.0
STEP = 0.001  # ~111 m of latitude, ~71 m of longitude


def at(x: int, y: int) -> LonLat:
    """Grid point: x steps east, y steps north of the origin (exact 7-decimal values)."""
    return round(LON0 + x * STEP, 7), round(LAT0 + y * STEP, 7)


def way(
    line_number: int, points: list[LonLat], highway: str = "residential", **tags: str
) -> DrivableWay:
    return DrivableWay(line_number, highway, points, dict(tags))


def key(x: int, y: int) -> str:
    return node_key(*at(x, y))


def test_t_junction_splits_the_through_way_at_the_shared_vertex() -> None:
    main = way(1, [at(0, 0), at(1, 0), at(2, 0)])
    stem = way(2, [at(1, 0), at(1, 1)])

    build = build_graph([main, stem])

    graph = build.graph
    assert set(graph.nodes) == {key(0, 0), key(1, 0), key(2, 0), key(1, 1)}
    assert graph.number_of_edges() == 6  # three two-way segments
    assert graph.out_degree(key(1, 0)) == 3
    assert {
        data["segment_index"] for *_, data in graph.edges(data=True) if data["source_line"] == 1
    } == {0, 1}
    assert build.report.split_vertices == 1


def test_two_way_segment_has_one_reverse_twin() -> None:
    graph = build_graph([way(1, [at(0, 0), at(1, 0)])]).graph

    edges = {data["edge_id"]: data for *_, data in graph.edges(data=True)}

    assert set(edges) == {"W1.0+", "W1.0-"}
    assert edges["W1.0+"]["reverse_twin"] is False
    assert edges["W1.0-"]["reverse_twin"] is True
    assert graph.has_edge(key(0, 0), key(1, 0)) and graph.has_edge(key(1, 0), key(0, 0))


@pytest.mark.parametrize(
    ("tags", "forward_edge", "reverse_edge"),
    [
        ({"oneway": "yes"}, True, False),
        ({"oneway": "-1"}, False, True),
        ({"oneway": "no"}, True, True),
        ({}, True, True),
    ],
)
def test_oneway_directions(tags: dict[str, str], forward_edge: bool, reverse_edge: bool) -> None:
    graph = build_graph([way(1, [at(0, 0), at(1, 0)], **tags)]).graph

    assert graph.has_edge(key(0, 0), key(1, 0)) is forward_edge
    assert graph.has_edge(key(1, 0), key(0, 0)) is reverse_edge


def test_backward_oneway_edge_geometry_runs_in_travel_direction() -> None:
    graph = build_graph([way(1, [at(0, 0), at(1, 0)], oneway="-1")]).graph

    ((u, v, data),) = graph.edges(data=True)

    assert (u, v) == (key(1, 0), key(0, 0))
    assert data["edge_id"] == "W1.0-"
    assert data["geometry"].coords[0] == pytest.approx(
        (graph.nodes[u]["x_m"], graph.nodes[u]["y_m"])
    )


@pytest.mark.parametrize(
    ("oneway", "count_field", "samples_field"),
    [
        ("reversible", "reversible_ways_excluded", "reversible_way_samples"),
        ("sometimes", "unrecognised_oneway_ways_excluded", "unrecognised_oneway_samples"),
    ],
)
def test_ways_with_an_unusable_oneway_are_excluded_and_reported_not_guessed(
    oneway: str, count_field: str, samples_field: str
) -> None:
    build = build_graph([way(7, [at(0, 0), at(1, 0)], oneway=oneway)])

    assert build.graph.number_of_edges() == 0
    assert getattr(build.report, count_field) == 1
    assert getattr(build.report, samples_field)[0].source_line == 7


def test_roundabout_is_directed_and_entered_from_its_arms() -> None:
    ring = way(
        1,
        [at(0, 0), at(1, 0), at(1, 1), at(0, 1), at(0, 0)],
        highway="primary",
        junction="roundabout",
    )
    arm = way(2, [at(1, 0), at(2, 0)], highway="primary")

    graph = build_graph([ring, arm]).graph

    # Cut at the closed way's start/end (0,0) and where the arm meets it (1,0): two ring edges.
    ring_edges = [d for *_, d in graph.edges(data=True) if d["source_line"] == 1]
    assert len(ring_edges) == 2
    assert all(d["oneway_source"] == "implied_junction" for d in ring_edges)
    # Travelling the ring is one-way: (0,0)->(1,0) is the short side, and getting from (1,0)
    # back to (0,0) means going round the other three sides.
    short_side = graph.edges[key(0, 0), key(1, 0), "W1.0+"]["length_m"]
    around = nx.shortest_path_length(graph, key(1, 0), key(0, 0), weight="length_m")
    assert around > 2.5 * short_side
    assert not graph.has_edge(key(1, 0), key(0, 0), "W1.0-")
    # The arm is two-way, so it both feeds the ring and receives traffic from it.
    assert nx.has_path(graph, key(2, 0), key(0, 0))
    assert nx.has_path(graph, key(0, 0), key(2, 0))


def test_bridge_crossing_without_a_shared_vertex_stays_unconnected() -> None:
    horizontal = way(1, [at(0, 0), at(2, 0)], highway="primary")
    vertical = way(2, [at(1, -1), at(1, 1)], highway="primary")  # crosses at (1, 0), no vertex

    graph = build_graph([horizontal, vertical]).graph

    assert graph.number_of_nodes() == 4
    assert nx.number_weakly_connected_components(graph) == 2


def test_consecutive_duplicate_coordinates_are_removed_and_counted() -> None:
    noisy = way(1, [at(0, 0), at(0, 0), at(1, 0), at(1, 0), at(1, 0)])

    build = build_graph([noisy])

    assert build.report.duplicate_consecutive_vertices_removed == 3
    assert build.graph.number_of_nodes() == 2
    assert all(d["length_m"] > 0 for *_, d in build.graph.edges(data=True))


def test_way_that_collapses_to_one_point_is_dropped_and_counted() -> None:
    build = build_graph([way(1, [at(0, 0), at(0, 0)])])

    assert build.report.ways_collapsed_to_a_point == 1
    assert build.graph.number_of_edges() == 0


def test_duplicate_ways_give_parallel_edges_with_distinct_ids() -> None:
    build = build_graph([way(1, [at(0, 0), at(1, 0)]), way(2, [at(0, 0), at(1, 0)])])

    assert build.graph.number_of_edges() == 4
    assert build.report.node_pairs_with_parallel_edges == 2
    assert len({d["edge_id"] for *_, d in build.graph.edges(data=True)}) == 4


def test_edge_ids_are_stable_across_builds() -> None:
    ways = [way(1, [at(0, 0), at(1, 0), at(2, 0)]), way(2, [at(1, 0), at(1, 1)], oneway="yes")]

    first = sorted(d["edge_id"] for *_, d in build_graph(ways).graph.edges(data=True))
    second = sorted(d["edge_id"] for *_, d in build_graph(ways).graph.edges(data=True))

    assert first == second
    assert "W2.0+" in first and "W2.0-" not in first


def test_length_is_in_metres_in_the_projected_crs() -> None:
    graph = build_graph([way(1, [at(0, 0), at(0, 1)])]).graph

    lengths = [d["length_m"] for *_, d in graph.edges(data=True)]

    assert lengths == [pytest.approx(111.2, rel=0.01)] * 2


def test_speed_comes_from_osm_or_a_class_default_with_its_source() -> None:
    graph = build_graph(
        [
            way(1, [at(0, 0), at(1, 0)], maxspeed="40", lanes="2"),
            way(2, [at(0, 1), at(1, 1)], highway="residential"),
        ]
    ).graph

    by_line = {d["source_line"]: d for *_, d in graph.edges(data=True)}

    assert (by_line[1]["speed_kmh"], by_line[1]["speed_source"], by_line[1]["lanes"]) == (
        40,
        "osm_maxspeed",
        2,
    )
    assert (by_line[2]["speed_kmh"], by_line[2]["speed_source"]) == (30, "class_default")


def test_driveways_are_not_routable() -> None:
    build = build_graph([way(1, [at(0, 0), at(1, 0)], highway="service", service="driveway")])

    assert build.report.routable_ways == 0
    assert build.graph.number_of_nodes() == 0


def test_loop_way_touching_itself_is_split_at_the_revisited_vertex() -> None:
    # A "6" shape: the way returns to an interior vertex it already visited.
    loop = way(1, [at(0, 0), at(1, 0), at(1, 1), at(0, 1), at(1, 0), at(2, 0)])

    graph = build_graph([loop]).graph

    assert graph.out_degree(key(1, 0)) >= 3


def test_graph_roundtrips_through_parquet(tmp_path: Path) -> None:
    original = build_graph(
        [
            way(1, [at(0, 0), at(1, 0), at(2, 0)], name="Testowa", lanes="2"),
            way(2, [at(1, 0), at(1, 1)], oneway="yes", maxspeed="30"),
        ]
    ).graph

    write_graph(original, tmp_path)
    restored = read_graph(tmp_path)

    assert set(restored.nodes) == set(original.nodes)
    assert restored.nodes[key(1, 0)] == original.nodes[key(1, 0)]
    assert {d["base_edge_id"] for *_, d in restored.edges(data=True)} == {
        d["edge_id"] for *_, d in original.edges(data=True)
    }
    assert {e for *_, e in restored.edges(keys=True)} == {e for *_, e in original.edges(keys=True)}
    for u, v, edge_id, data in original.edges(keys=True, data=True):
        other = restored.edges[u, v, edge_id]
        assert other["length_m"] == data["length_m"]
        assert other["name"] == data["name"] and other["lanes"] == data["lanes"]
        assert other["geometry"].equals(data["geometry"])
