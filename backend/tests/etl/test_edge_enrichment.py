import networkx as nx
import numpy as np
import pytest
import shapely

from greenwave.etl.edge_enrichment import annotate_calming, annotate_tram_tracks


def _graph(*edges: tuple[str, list[tuple[float, float]]]) -> nx.MultiDiGraph:
    """Edges in metres: (edge_id, coordinates); nodes are the end coordinates."""
    graph: nx.MultiDiGraph = nx.MultiDiGraph()
    for edge_id, coordinates in edges:
        geometry = shapely.LineString(coordinates)
        graph.add_edge(
            coordinates[0],
            coordinates[-1],
            key=edge_id,
            edge_id=edge_id,
            geometry=geometry,
            length_m=geometry.length,
        )
    return graph


def _by_id(graph: nx.MultiDiGraph, attribute: str) -> dict[str, object]:
    return {data["edge_id"]: data[attribute] for *_, data in graph.edges(data=True)}


def _points(*xy: tuple[float, float]) -> np.ndarray:
    return np.array(xy, dtype=np.float64).reshape(-1, 2)


def test_calming_point_counted_once_across_split_pieces() -> None:
    # A two-way road split at (100, 0): pieces ~0 and ~1 in each direction.
    graph = _graph(
        ("A~0+", [(0, 0), (100, 0)]),
        ("A~1+", [(100, 0), (200, 0)]),
        ("A~1-", [(200, 0), (100, 0)]),
        ("A~0-", [(100, 0), (0, 0)]),
    )

    stats = annotate_calming(graph, _points((100.2, 0)))

    assert _by_id(graph, "calming_count") == {"A~0+": 1, "A~1+": 0, "A~1-": 1, "A~0-": 0}
    assert (stats.points_total, stats.points_on_edges, stats.points_off_network) == (1, 1, 0)


def test_calming_point_counts_on_both_directions_of_two_way_road() -> None:
    graph = _graph(
        ("W+", [(0, 0), (50, 0), (100, 0)]),
        ("W-", [(100, 0), (50, 0), (0, 0)]),
    )

    annotate_calming(graph, _points((50, 0.3)))

    assert _by_id(graph, "calming_count") == {"W+": 1, "W-": 1}


def test_calming_point_between_vertices_is_not_on_the_edge() -> None:
    graph = _graph(("W+", [(0, 0), (100, 0)]))

    stats = annotate_calming(graph, _points((50, 0)))

    assert _by_id(graph, "calming_count") == {"W+": 0}
    assert stats.points_off_network == 1


def test_calming_point_far_from_roads_reported_off_network() -> None:
    graph = _graph(("W+", [(0, 0), (50, 0), (100, 0)]))

    stats = annotate_calming(graph, _points((50, 0), (50, 40)))

    assert _by_id(graph, "calming_count") == {"W+": 1}
    assert (stats.points_total, stats.points_on_edges, stats.points_off_network) == (2, 1, 1)


def test_calming_without_points_sets_zero_everywhere() -> None:
    graph = _graph(("W+", [(0, 0), (100, 0)]))

    stats = annotate_calming(graph, _points())

    assert _by_id(graph, "calming_count") == {"W+": 0}
    assert stats.points_total == 0


def test_tram_line_parallel_within_threshold_marks_edge() -> None:
    graph = _graph(("W+", [(0, 0), (100, 0)]), ("V+", [(0, 50), (100, 50)]))

    stats = annotate_tram_tracks(
        graph, [np.array([(-10.0, 3.0), (110.0, 3.0)])], match_m=6.0, min_share=0.5
    )

    assert _by_id(graph, "tram_track") == {"W+": True, "V+": False}
    assert stats.edges_marked == 1
    assert stats.km_marked == pytest.approx(0.1)
    assert (stats.match_m, stats.min_share) == (6.0, 0.5)


def test_tram_line_crossing_perpendicular_does_not_mark_edge() -> None:
    graph = _graph(("W+", [(0, 0), (100, 0)]))

    annotate_tram_tracks(
        graph, [np.array([(50.0, -50.0), (50.0, 50.0)])], match_m=6.0, min_share=0.5
    )

    assert _by_id(graph, "tram_track") == {"W+": False}


def test_tram_threshold_boundary_inclusive() -> None:
    graph = _graph(("W+", [(0, 0), (100, 0)]))

    annotate_tram_tracks(
        graph, [np.array([(-10.0, 6.0), (110.0, 6.0)])], match_m=6.0, min_share=0.5
    )

    assert _by_id(graph, "tram_track") == {"W+": True}


def test_tram_partial_overlap_uses_the_share_threshold() -> None:
    graph = _graph(("W+", [(0, 0), (100, 0)]), ("V+", [(0, 50), (100, 50)]))

    annotate_tram_tracks(
        graph,
        [np.array([(0.0, 2.0), (50.0, 2.0)]), np.array([(0.0, 52.0), (40.0, 52.0)])],
        match_m=6.0,
        min_share=0.5,
    )

    # W+: 50 m + 6 m buffer cap = 56% within; V+: 46%.
    assert _by_id(graph, "tram_track") == {"W+": True, "V+": False}
