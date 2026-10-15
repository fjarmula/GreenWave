import networkx as nx
import numpy as np
import pytest

from greenwave.etl.geo import project_points
from greenwave.etl.graph import build_graph, node_key
from greenwave.etl.network import (
    DIRECTION_ALL_INCOMING,
    DIRECTION_BOTH,
    DIRECTION_UNRESOLVED,
    SNAP_GRAPH_NODE,
    SNAP_INTERIOR_VERTEX,
    SNAP_OFFSET,
    SNAP_UNSNAPPED,
    SignalPoint,
    attach_signals,
)
from greenwave.etl.profile_osm import DrivableWay, LonLat

STEP = 0.001


def at(x: float, y: float) -> LonLat:
    return round(19.9 + x * STEP, 7), round(50.0 + y * STEP, 7)


def way(line: int, points: list[LonLat], **tags: str) -> DrivableWay:
    return DrivableWay(line, "residential", points, dict(tags))


def signal(
    lon_lat: LonLat,
    key: str = "OSM-L1",
    direction: str | None = None,
    node_type: str = "traffic_signals",
) -> SignalPoint:
    x, y = project_points(np.array([lon_lat[0]]), np.array([lon_lat[1]]))[0]
    return SignalPoint(
        key, node_type, lon_lat[0], lon_lat[1], float(x), float(y), direction, 35.0, None
    )


def straight_road(**tags: str) -> nx.MultiDiGraph:
    # one way with an interior vertex at (1, 0): not a graph node until a signal needs it
    return build_graph([way(1, [at(0, 0), at(1, 0), at(2, 0)], **tags)]).graph


def test_signal_on_interior_vertex_splits_the_edge_and_controls_both_arrivals() -> None:
    base = straight_road()

    result = attach_signals(base, [signal(at(1, 0))])

    (attachment,) = result.attachments
    node = node_key(*at(1, 0))
    assert attachment.snap_kind == SNAP_INTERIOR_VERTEX
    assert attachment.graph_node == node
    assert attachment.direction_resolved == DIRECTION_BOTH
    assert attachment.controlled_edge_ids == ["W1.0+~0", "W1.0-~0"]
    graph = result.graph
    assert graph.number_of_nodes() == 3 and graph.number_of_edges() == 4
    assert graph.has_edge(node_key(*at(0, 0)), node, key="W1.0+~0")
    assert graph.has_edge(node_key(*at(2, 0)), node, key="W1.0-~0")
    assert (result.edges_split, result.nodes_added) == (1, 1)
    assert base.number_of_nodes() == 2  # the input graph is not modified


@pytest.mark.parametrize(
    ("direction", "expected"),
    [("forward", ["W1.0+~0"]), ("backward", ["W1.0-~0"]), ("both", ["W1.0+~0", "W1.0-~0"])],
)
def test_direction_tag_picks_the_arriving_edge(direction: str, expected: list[str]) -> None:
    result = attach_signals(straight_road(), [signal(at(1, 0), direction=direction)])

    assert result.attachments[0].controlled_edge_ids == expected


@pytest.mark.parametrize(
    ("road_tags", "direction", "issue_contains"),
    [
        ({"oneway": "yes"}, "backward", "one-way"),  # no edge arrives travelling backward
        ({}, "sideways", "unrecognised"),
    ],
)
def test_a_direction_that_cannot_be_resolved_is_reported_not_guessed(
    road_tags: dict[str, str], direction: str, issue_contains: str
) -> None:
    result = attach_signals(straight_road(**road_tags), [signal(at(1, 0), direction=direction)])

    attachment = result.attachments[0]
    assert attachment.direction_resolved == DIRECTION_UNRESOLVED
    assert attachment.controlled_edge_ids == []
    assert attachment.issue is not None and issue_contains in attachment.issue


def test_signal_near_an_edge_is_snapped_onto_it() -> None:
    result = attach_signals(straight_road(), [signal(at(1, 0.1))])  # ~11 m north of the road

    attachment = result.attachments[0]
    assert attachment.snap_kind == SNAP_OFFSET
    assert attachment.snap_distance_m == pytest.approx(11.1, rel=0.02)
    assert attachment.graph_node == "snap:OSM-L1"
    node = result.graph.nodes["snap:OSM-L1"]
    assert node["lat"] == pytest.approx(50.0, abs=1e-6)
    assert node["lon"] == pytest.approx(at(1, 0)[0], abs=1e-5)


def test_signal_beyond_tolerance_is_unsnapped_and_the_graph_is_unchanged() -> None:
    base = straight_road()

    result = attach_signals(base, [signal(at(1, 1))], tolerance_meters=30.0)  # ~111 m away

    attachment = result.attachments[0]
    assert attachment.snap_kind == SNAP_UNSNAPPED
    assert attachment.graph_node is None
    assert result.graph.number_of_edges() == base.number_of_edges()
    assert (result.edges_split, result.nodes_added) == (0, 0)


def test_tolerance_boundary_uses_the_measured_distance() -> None:
    probe = attach_signals(straight_road(), [signal(at(1, 0.1))])
    distance = probe.attachments[0].snap_distance_m
    assert distance is not None

    at_limit = attach_signals(straight_road(), [signal(at(1, 0.1))], tolerance_meters=distance)
    below = attach_signals(straight_road(), [signal(at(1, 0.1))], tolerance_meters=distance - 1e-6)

    assert at_limit.attachments[0].snap_kind == SNAP_OFFSET
    assert below.attachments[0].snap_kind == SNAP_UNSNAPPED


def test_negative_tolerance_is_rejected() -> None:
    with pytest.raises(ValueError, match="negative"):
        attach_signals(straight_road(), [], tolerance_meters=-1.0)


def test_signal_on_a_junction_node_controls_every_arriving_edge() -> None:
    junction = at(1, 0)
    graph = build_graph(
        [
            way(1, [at(0, 0), junction, at(2, 0)]),
            way(2, [junction, at(1, 1)]),
        ]
    ).graph

    result = attach_signals(graph, [signal(junction, direction="forward")])

    attachment = result.attachments[0]
    assert attachment.snap_kind == SNAP_GRAPH_NODE
    assert attachment.direction_resolved == DIRECTION_ALL_INCOMING
    assert len(attachment.controlled_edge_ids) == 3  # the direction tag cannot pick one
    assert result.graph.number_of_edges() == graph.number_of_edges()


def test_two_signals_on_one_edge_make_three_pieces_in_order_and_keep_total_length() -> None:
    base = build_graph([way(1, [at(0, 0), at(1, 0), at(2, 0), at(3, 0)])]).graph
    original_length = sum(d["length_m"] for *_, d in base.edges(data=True) if not d["reverse_twin"])

    result = attach_signals(
        base, [signal(at(2, 0), "OSM-L9"), signal(at(1, 0), "OSM-L8")], tolerance_meters=5.0
    )

    graph = result.graph
    forward = sorted(
        (d["edge_id"], d["length_m"])
        for *_, d in graph.edges(data=True)
        if d["edge_id"].startswith("W1.0+")
    )
    assert [edge_id for edge_id, _ in forward] == ["W1.0+~0", "W1.0+~1", "W1.0+~2"]
    assert sum(length for _, length in forward) == pytest.approx(original_length, rel=1e-6)
    assert graph.number_of_edges() == 6
    assert {a.signal.node_key: a.controlled_edge_ids for a in result.attachments} == {
        "OSM-L8": ["W1.0+~0", "W1.0-~1"],
        "OSM-L9": ["W1.0+~1", "W1.0-~0"],
    }
    assert all(d["base_edge_id"] in {"W1.0+", "W1.0-"} for *_, d in graph.edges(data=True))


def test_signals_at_the_same_position_share_one_node() -> None:
    result = attach_signals(
        straight_road(),
        [signal(at(1, 0), "OSM-L1"), signal(at(1, 0), "OSM-L2", direction="forward")],
    )

    first, second = result.attachments
    assert first.graph_node == second.graph_node
    assert result.nodes_added == 1
    assert result.graph.number_of_edges() == 4


def test_signal_within_the_minimum_piece_of_an_end_uses_that_end_node() -> None:
    start = at(0, 0)
    near_start = (start[0], round(start[1] + 0.0000002, 7))  # ~2 cm north of the way's start

    result = attach_signals(straight_road(), [signal(near_start)])

    attachment = result.attachments[0]
    assert attachment.graph_node == node_key(*start)
    assert result.nodes_added == 0 and result.edges_split == 0
    assert attachment.direction_resolved == DIRECTION_ALL_INCOMING


def test_split_pieces_keep_the_edge_attributes() -> None:
    result = attach_signals(straight_road(maxspeed="40", name="Testowa"), [signal(at(1, 0))])

    for *_, data in result.graph.edges(data=True):
        assert data["name"] == "Testowa"
        assert (data["speed_kmh"], data["speed_source"]) == (40, "osm_maxspeed")
        assert data["geometry"].length == pytest.approx(data["length_m"])
