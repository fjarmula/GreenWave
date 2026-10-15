import networkx as nx
import numpy as np
import polars as pl
import pytest

from greenwave.etl.geo import project_points
from greenwave.etl.graph import build_graph, node_key
from greenwave.etl.neighbours import (
    ApproachEdge,
    approach_edges,
    find_neighbours,
    neighbour_frame,
    neighbours_report,
)
from greenwave.etl.network import SignalPoint, attach_signals
from greenwave.etl.profile_osm import DrivableWay, LonLat

STEP = 0.001  # about 71 m east-west


def at(x: float, y: float) -> LonLat:
    return round(19.9 + x * STEP, 7), round(50.0 + y * STEP, 7)


def way(line: int, points: list[LonLat], highway: str = "residential", **tags: str) -> DrivableWay:
    return DrivableWay(line, highway, points, dict(tags))


def signal(point: LonLat, key: str) -> SignalPoint:
    x, y = project_points(np.array([point[0]]), np.array([point[1]]))[0]
    return SignalPoint(
        key, "traffic_signals", point[0], point[1], float(x), float(y), None, 35.0, None
    )


def scenario(  # type: ignore[no-untyped-def]
    ways: list[DrivableWay],
    signals: list[SignalPoint],
    intersection_of: dict[str, str] | None = None,
):
    """Attach the signals and return (graph, one ApproachEdge per controlled edge)."""
    attached = attach_signals(build_graph(ways).graph, signals, 30.0)
    ids = intersection_of or {}
    approaches = [
        ApproachEdge(
            a.signal.node_key, ids.get(a.signal.node_key, f"INT-{a.signal.node_key}"), edge
        )
        for a in attached.attachments
        for edge in sorted(a.controlled_edge_ids)
    ]
    return attached.graph, approaches


def pair_set(search) -> set[tuple[str, str, str, str]]:  # type: ignore[no-untyped-def]
    return {
        (p.source.signal_key, p.source.edge_id, p.target.signal_key, p.target.edge_id)
        for p in search.pairs
    }


def straight_road(**tags: str) -> list[DrivableWay]:
    # Signals will sit on the interior vertices at x=0 and x=3 (about 214 m apart).
    return [way(1, [at(-1, 0), at(0, 0), at(3, 0), at(4, 0)], **tags)]


S1, S2 = signal(at(0, 0), "S1"), signal(at(3, 0), "S2")


def test_threshold_boundary_below_at_and_above() -> None:
    graph, approaches = scenario(straight_road(), [S1, S2])
    distance = next(
        p.distance_m
        for p in find_neighbours(graph, approaches, 1000.0).pairs
        if (p.source.signal_key, p.target.signal_key) == ("S1", "S2")
    )

    above = find_neighbours(graph, approaches, distance + 1e-6)
    at_limit = find_neighbours(graph, approaches, distance)
    below = find_neighbours(graph, approaches, distance - 1e-6)

    assert ("S1", "S2") in {(a, c) for a, _, c, _ in pair_set(above)}
    assert ("S1", "S2") in {(a, c) for a, _, c, _ in pair_set(at_limit)}  # inclusive
    assert ("S1", "S2") not in {(a, c) for a, _, c, _ in pair_set(below)}
    assert distance == pytest.approx(214.5, rel=0.02)


def test_pairs_follow_the_direction_of_travel_on_a_two_way_road() -> None:
    graph, approaches = scenario(straight_road(), [S1, S2])

    pairs = pair_set(find_neighbours(graph, approaches, 300.0))

    # S1 eastbound (arriving from the west) -> S2 eastbound; S2 westbound -> S1 westbound.
    assert ("S1", "W1.0+~0", "S2", "W1.0+~1") in pairs
    assert ("S2", "W1.0-~0", "S1", "W1.0-~1") in pairs
    # The opposing approach is not a neighbour: that would need a U-turn.
    assert not any(
        a == "S1" and c == "S2" and b.endswith("+~0") and d.endswith("-~0") for a, b, c, d in pairs
    )
    assert len(pairs) == 2


def test_one_way_road_gives_asymmetric_pairs() -> None:
    graph, approaches = scenario(straight_road(oneway="yes"), [S1, S2])

    search = find_neighbours(graph, approaches, 300.0)

    assert {(p.source.signal_key, p.target.signal_key) for p in search.pairs} == {("S1", "S2")}
    report = neighbours_report(search, approaches, {}, 300.0, False, 0)
    assert report.intersection_pairs == 1 and report.intersection_pairs_one_way_only == 1
    assert report.intersection_pairs_with_reverse == 0


def test_two_way_road_has_pairs_in_both_directions_at_intersection_level() -> None:
    graph, approaches = scenario(straight_road(), [S1, S2])
    search = find_neighbours(graph, approaches, 300.0)

    report = neighbours_report(search, approaches, {}, 300.0, False, 0)

    assert report.intersection_pairs == 2 and report.intersection_pairs_with_reverse == 2
    assert report.intersection_pairs_one_way_only == 0


def test_every_approach_of_an_intersection_with_several_approaches_gets_its_own_pairs() -> None:
    # A signal on the crossing node J controls all four arriving edges; one signal down each
    # of the east and west arms.
    junction = at(0, 0)
    ways = [
        way(1, [at(-3, 0), at(-2, 0), junction, at(2, 0), at(3, 0)], name="Glowna"),
        way(2, [at(0, -2), junction, at(0, 2)], name="Poprzeczna"),
    ]
    center, east, west = signal(junction, "J"), signal(at(2, 0), "E"), signal(at(-2, 0), "W")

    graph, approaches = scenario(ways, [center, east, west])
    j_edges = sorted(a.edge_id for a in approaches if a.signal_key == "J")
    pairs = pair_set(find_neighbours(graph, approaches, 400.0))

    assert len(j_edges) == 4  # one approach edge per arriving direction
    east_eastbound = next(
        a.edge_id for a in approaches if a.signal_key == "E" and a.edge_id.startswith("W1.1+")
    )
    to_east = {src for s, src, t, tgt in pairs if s == "J" and t == "E" and tgt == east_eastbound}
    # Reaching E's eastbound approach: from J's west, south and north arrivals; not from its east
    # arrival (that would need a U-turn).
    assert len(to_east) == 3
    to_west = {src for s, src, t, _ in pairs if s == "J" and t == "W"}
    assert len(to_west) == 3
    # Coming back: E's westbound approach continues into J and is a pair to J's east arrival.
    assert any(s == "E" and t == "J" for s, _, t, _ in pairs)


def test_no_pair_is_made_inside_one_intersection() -> None:
    graph, approaches = scenario(
        straight_road(), [S1, S2], intersection_of={"S1": "INT-A", "S2": "INT-A"}
    )

    search = find_neighbours(graph, approaches, 1000.0)

    assert search.pairs == []
    assert search.same_intersection_skipped >= 2


def test_a_third_signal_pairs_with_each_member_of_a_merged_intersection() -> None:
    ways = [way(1, [at(-1, 0), at(0, 0), at(1, 0), at(4, 0), at(5, 0)])]
    first, second, far = signal(at(0, 0), "A1"), signal(at(1, 0), "A2"), signal(at(4, 0), "B")

    graph, approaches = scenario(
        ways, [first, second, far], {"A1": "INT-A", "A2": "INT-A", "B": "INT-B"}
    )
    pairs = {(s, t) for s, _, t, _ in pair_set(find_neighbours(graph, approaches, 400.0))}

    assert ("A1", "A2") not in pairs and ("A2", "A1") not in pairs
    assert {("A1", "B"), ("A2", "B"), ("B", "A1"), ("B", "A2")} <= pairs


def test_u_turns_are_off_by_default_and_counted_when_allowed() -> None:
    graph, approaches = scenario(straight_road(), [S1, S2])

    without = find_neighbours(graph, approaches, 1000.0, allow_u_turns=False)
    with_u_turns = find_neighbours(graph, approaches, 1000.0, allow_u_turns=True)

    assert len(with_u_turns.pairs) > len(without.pairs)
    report = neighbours_report(without, approaches, {}, 1000.0, False, len(with_u_turns.pairs))
    assert report.pairs_if_u_turns_were_allowed == len(with_u_turns.pairs)
    assert report.pairs_if_u_turns_were_not_allowed == len(without.pairs)


def test_path_edges_are_connected_end_with_the_target_and_add_up_to_the_distance() -> None:
    ways = [way(1, [at(-1, 0), at(0, 0), at(1, 0), at(2, 0), at(3, 0), at(4, 0)])]
    graph, approaches = scenario(
        ways, [signal(at(0, 0), "A"), signal(at(3, 0), "B"), signal(at(2, 0), "M")]
    )

    search = find_neighbours(graph, approaches, 400.0)

    pair = next(
        p
        for p in search.pairs
        if (p.source.signal_key, p.target.signal_key) == ("A", "B")
        and p.target.edge_id.startswith("W1.0+")
    )
    edges = {d["edge_id"]: (u, v, d["length_m"]) for u, v, d in graph.edges(data=True)}
    assert pair.path_edge_ids[-1] == pair.target.edge_id
    start = edges[pair.source.edge_id][1]
    cursor = start
    for edge_id in pair.path_edge_ids:
        tail, head, _ = edges[edge_id]
        assert tail == cursor
        cursor = head
    assert sum(edges[e][2] for e in pair.path_edge_ids) == pytest.approx(pair.distance_m)
    assert len(pair.path_edge_ids) == 2  # A to the signal M, then M to B


def test_a_missing_edge_and_a_bad_threshold_are_errors() -> None:
    graph, approaches = scenario(straight_road(), [S1, S2])

    with pytest.raises(ValueError, match="positive"):
        find_neighbours(graph, approaches, 0.0)
    with pytest.raises(KeyError, match="not in the graph"):
        find_neighbours(graph, [ApproachEdge("X", "INT-X", "W999.0+")], 100.0)


def test_approach_edges_skip_unattached_signals_and_sort_the_edges() -> None:
    frame = pl.DataFrame(
        {
            "signal_key": ["B", "A", "C"],
            "intersection_id": ["INT-2", "INT-1", None],
            "controlled_edge_ids": [["e2", "e1"], ["e3"], []],
        },
        schema={
            "signal_key": pl.String,
            "intersection_id": pl.String,
            "controlled_edge_ids": pl.List(pl.String),
        },
    )

    assert approach_edges(frame) == [
        ApproachEdge("A", "INT-1", "e3"),
        ApproachEdge("B", "INT-2", "e1"),
        ApproachEdge("B", "INT-2", "e2"),
    ]


def test_frame_roundtrip_report_histogram_and_determinism(tmp_path) -> None:  # type: ignore[no-untyped-def]
    graph, approaches = scenario(straight_road(), [S1, S2])
    first = find_neighbours(graph, approaches, 300.0)
    second = find_neighbours(graph, list(reversed(approaches)), 300.0)

    frame = neighbour_frame(first.pairs)
    frame.write_parquet(tmp_path / "n.parquet")
    report = neighbours_report(
        first, approaches, {"INT-S1": "signalised_junction"}, 300.0, False, 0
    )

    assert pl.read_parquet(tmp_path / "n.parquet").equals(frame)
    assert neighbour_frame(second.pairs).equals(frame)
    assert sum(report.distance_histogram_m.values()) == report.pairs == frame.height
    assert report.distance_percentiles_m["max"] == frame["distance_m"].max()
    # The two approaches that face away from the other signal have nothing ahead of them.
    assert report.approaches_without_neighbours == 2
    assert report.candidate_set_only.startswith("Candidate set only")
    assert nx.is_directed(graph)
    assert node_key(*at(0, 0)) in graph
