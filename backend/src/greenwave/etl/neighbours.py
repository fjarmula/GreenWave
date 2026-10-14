"""T5: candidate neighbour pairs between signal approaches along the road, in travel direction.

An *approach* here is a (signal, controlled edge) pair; its stop line is at the end of the
controlled edge. A pair (A -> B) means: a vehicle that has just crossed A's stop line can reach B's
stop line by driving forward along the directed edges, and the shortest such drive is at most the
cascade threshold. The distance runs from A's stop line to B's stop line.

THIS TABLE IS ONLY A CANDIDATE SET. The distance is the shortest path, but the simulation must use
the along-route distance on the route actually driven, and must not read this distance as the
distance between two signals on its route.

The graph has no turn restrictions, so a path may reverse straight back along the edge it arrived
on (a U-turn) only when ``allow_u_turns`` is set; by default it may not, because U-turns would make
the opposing approach of the next signal look like a neighbour.
"""

import heapq
from collections import Counter, defaultdict
from dataclasses import dataclass

import networkx as nx
import numpy as np
import polars as pl
from pydantic import BaseModel

from greenwave.etl.config import CASCADE_ALLOW_U_TURNS, CASCADE_THRESHOLD_METERS

_DISTANCE_BINS = (25.0, 50.0, 100.0, 150.0, 200.0, 250.0)


@dataclass(frozen=True, slots=True)
class ApproachEdge:
    signal_key: str
    intersection_id: str
    edge_id: str


@dataclass(frozen=True, slots=True)
class NeighbourPair:
    source: ApproachEdge
    target: ApproachEdge
    distance_m: float
    path_edge_ids: tuple[
        str, ...
    ]  # edges driven after the source stop line, ending with the target's


@dataclass(frozen=True, slots=True)
class _EdgeInfo:
    tail: str
    head: str
    length_m: float
    source_line: int
    segment_index: int


@dataclass(slots=True)
class NeighbourSearch:
    pairs: list[NeighbourPair]
    same_intersection_skipped: int


def approach_edges(approaches: pl.DataFrame) -> list[ApproachEdge]:
    """One entry per (signal, controlled edge) of every attached signal, in a stable order."""
    rows = approaches.filter(pl.col("intersection_id").is_not_null()).sort("signal_key")
    return [
        ApproachEdge(row["signal_key"], row["intersection_id"], edge_id)
        for row in rows.iter_rows(named=True)
        for edge_id in sorted(row["controlled_edge_ids"])
    ]


def _edge_table(graph: nx.MultiDiGraph) -> dict[str, _EdgeInfo]:
    return {
        data["edge_id"]: _EdgeInfo(
            u, v, data["length_m"], data["source_line"], data["segment_index"]
        )
        for u, v, data in graph.edges(data=True)
    }


def _is_u_turn(previous: _EdgeInfo, following: _EdgeInfo) -> bool:
    """True when ``following`` is the opposite direction of the very same road segment."""
    return (
        following.tail == previous.head
        and following.head == previous.tail
        and following.source_line == previous.source_line
        and following.segment_index == previous.segment_index
    )


def _shortest_drives(
    source_edge_id: str,
    edges: dict[str, _EdgeInfo],
    outgoing: dict[str, list[str]],
    threshold_meters: float,
    allow_u_turns: bool,
) -> tuple[dict[str, float], dict[str, str]]:
    """Shortest drive after the stop line at the end of ``source_edge_id``, per arrival edge.

    Returns the distance to the end of every reachable edge (within the threshold) and, for each,
    the edge driven just before it. Edge-based Dijkstra, so the no-U-turn rule is exact.
    """
    best: dict[str, float] = {}
    previous: dict[str, str] = {}
    heap: list[tuple[float, str]] = []

    def relax(from_edge_id: str, from_distance: float) -> None:
        info = edges[from_edge_id]
        for next_id in outgoing.get(info.head, []):
            following = edges[next_id]
            if not allow_u_turns and _is_u_turn(info, following):
                continue
            distance = from_distance + following.length_m
            if distance <= threshold_meters and distance < best.get(next_id, float("inf")):
                best[next_id] = distance
                previous[next_id] = from_edge_id
                heapq.heappush(heap, (distance, next_id))

    relax(source_edge_id, 0.0)
    settled: set[str] = set()
    while heap:
        distance, edge_id = heapq.heappop(heap)
        if edge_id in settled or distance > best[edge_id]:
            continue
        settled.add(edge_id)
        relax(edge_id, distance)
    return best, previous


def find_neighbours(
    graph: nx.MultiDiGraph,
    approaches: list[ApproachEdge],
    threshold_meters: float = CASCADE_THRESHOLD_METERS,
    allow_u_turns: bool = CASCADE_ALLOW_U_TURNS,
) -> NeighbourSearch:
    """Directed pairs (A -> B) in different intersections with distance <= the threshold."""
    if threshold_meters <= 0:
        raise ValueError("cascade threshold must be positive (metres)")
    edges = _edge_table(graph)
    outgoing: dict[str, list[str]] = defaultdict(list)
    for edge_id, info in edges.items():
        outgoing[info.tail].append(edge_id)
    for node in outgoing:
        outgoing[node].sort()
    targets_on: dict[str, list[ApproachEdge]] = defaultdict(list)
    for approach in approaches:
        if approach.edge_id not in edges:
            raise KeyError(f"approach edge {approach.edge_id!r} is not in the graph")
        targets_on[approach.edge_id].append(approach)

    pairs: list[NeighbourPair] = []
    skipped = 0
    for source in approaches:
        best, previous = _shortest_drives(
            source.edge_id, edges, outgoing, threshold_meters, allow_u_turns
        )
        for edge_id, distance in best.items():
            for target in targets_on.get(edge_id, []):
                if target.intersection_id == source.intersection_id:
                    skipped += 1
                    continue
                path = [edge_id]
                while previous[path[-1]] != source.edge_id:
                    path.append(previous[path[-1]])
                pairs.append(NeighbourPair(source, target, distance, tuple(reversed(path))))

    pairs.sort(
        key=lambda p: (
            p.source.signal_key,
            p.source.edge_id,
            p.distance_m,
            p.target.signal_key,
            p.target.edge_id,
        )
    )
    return NeighbourSearch(pairs, skipped)


def neighbour_frame(pairs: list[NeighbourPair]) -> pl.DataFrame:
    return pl.DataFrame(
        [
            {
                "from_signal_key": p.source.signal_key,
                "from_approach_edge_id": p.source.edge_id,
                "from_intersection_id": p.source.intersection_id,
                "to_signal_key": p.target.signal_key,
                "to_approach_edge_id": p.target.edge_id,
                "to_intersection_id": p.target.intersection_id,
                "distance_m": p.distance_m,
                "path_edge_ids": list(p.path_edge_ids),
                "path_edge_count": len(p.path_edge_ids),
            }
            for p in pairs
        ],
        schema={
            "from_signal_key": pl.String,
            "from_approach_edge_id": pl.String,
            "from_intersection_id": pl.String,
            "to_signal_key": pl.String,
            "to_approach_edge_id": pl.String,
            "to_intersection_id": pl.String,
            "distance_m": pl.Float64,
            "path_edge_ids": pl.List(pl.String),
            "path_edge_count": pl.Int64,
        },
    )


class NeighboursReport(BaseModel):
    threshold_m: float
    allow_u_turns: bool
    candidate_set_only: str
    approach_edges: int
    approach_edges_by_intersection_kind: dict[str, int]
    pairs: int
    pairs_by_target_kind: dict[str, int]
    same_intersection_candidates_skipped: int
    distance_percentiles_m: dict[str, float]
    distance_histogram_m: dict[str, int]
    neighbours_per_approach: dict[str, int]
    approaches_without_neighbours: int
    intersection_pairs: int
    intersection_pairs_with_reverse: int
    intersection_pairs_one_way_only: int
    intersections_without_outgoing_pairs: int
    pairs_if_u_turns_were_allowed: int
    pairs_if_u_turns_were_not_allowed: int


def neighbours_report(
    search: NeighbourSearch,
    approaches: list[ApproachEdge],
    kind_of_intersection: dict[str, str],
    threshold_meters: float,
    allow_u_turns: bool,
    pairs_with_other_u_turn_setting: int,
) -> NeighboursReport:
    pairs = search.pairs
    distances = np.array([p.distance_m for p in pairs])
    histogram: dict[str, int] = {}
    lower = 0.0
    for upper in _DISTANCE_BINS:
        histogram[f"{lower:g}-{upper:g}"] = int(((distances > lower) & (distances <= upper)).sum())
        lower = upper
    histogram[f">{lower:g}"] = int((distances > lower).sum())

    per_source = Counter((p.source.signal_key, p.source.edge_id) for p in pairs)
    degree = Counter(
        str(per_source.get((a.signal_key, a.edge_id), 0))
        if per_source.get((a.signal_key, a.edge_id), 0) < 10
        else "10+"
        for a in approaches
    )
    directed = {(p.source.intersection_id, p.target.intersection_id) for p in pairs}
    with_reverse = sum((b, a) in directed for a, b in directed)
    intersections = {a.intersection_id for a in approaches}
    with_outgoing = {a for a, _ in directed}
    return NeighboursReport(
        threshold_m=threshold_meters,
        allow_u_turns=allow_u_turns,
        candidate_set_only=(
            "Candidate set only: the distance is the shortest path from one stop line to the next. "
            "The simulation must use the along-route distance on the route actually driven."
        ),
        approach_edges=len(approaches),
        approach_edges_by_intersection_kind=dict(
            Counter(kind_of_intersection.get(a.intersection_id, "unknown") for a in approaches)
        ),
        pairs=len(pairs),
        pairs_by_target_kind=dict(
            Counter(kind_of_intersection.get(p.target.intersection_id, "unknown") for p in pairs)
        ),
        same_intersection_candidates_skipped=search.same_intersection_skipped,
        distance_percentiles_m=(
            {f"p{q}": float(np.percentile(distances, q)) for q in (10, 25, 50, 75, 90)}
            | {
                "min": float(distances.min()),
                "max": float(distances.max()),
                "mean": float(distances.mean()),
            }
            if len(distances)
            else {}
        ),
        distance_histogram_m=histogram,
        neighbours_per_approach=dict(sorted(degree.items(), key=lambda kv: int(kv[0].rstrip("+")))),
        approaches_without_neighbours=sum(
            per_source.get((a.signal_key, a.edge_id), 0) == 0 for a in approaches
        ),
        intersection_pairs=len(directed),
        intersection_pairs_with_reverse=with_reverse,
        intersection_pairs_one_way_only=len(directed) - with_reverse,
        intersections_without_outgoing_pairs=len(intersections - with_outgoing),
        pairs_if_u_turns_were_allowed=(
            len(pairs) if allow_u_turns else pairs_with_other_u_turn_setting
        ),
        pairs_if_u_turns_were_not_allowed=(
            pairs_with_other_u_turn_setting if allow_u_turns else len(pairs)
        ),
    )
