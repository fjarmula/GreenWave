"""T4: junction nodes, nearest-junction assignment, rings, intersections, names and ids."""

import heapq
from collections import Counter, defaultdict
from dataclasses import dataclass, field

import networkx as nx

from greenwave.etl.config import (
    IMPLIED_ONEWAY_JUNCTION_VALUES,
    INTERSECTION_ID_PREFIX,
    JUNCTION_MIN_DISTINCT_NEIGHBOURS,
)
from greenwave.etl.overrides import OverrideFile
from greenwave.etl.street_names import normalise_street_name

Adjacency = dict[str, list[tuple[str, float]]]

KIND_SIGNALISED_JUNCTION = "signalised_junction"
KIND_PEDESTRIAN_CROSSING = "pedestrian_crossing"
KIND_MIDBLOCK_SIGNAL = "midblock_signal"

# Lower is more important; used to order street names in an intersection name.
_HIGHWAY_RANK = {
    "motorway": 0, "motorway_link": 0, "trunk": 1, "trunk_link": 1, "primary": 2,
    "primary_link": 2, "secondary": 3, "secondary_link": 3, "tertiary": 4, "tertiary_link": 4,
    "unclassified": 5, "residential": 6, "living_street": 7, "service": 8,
}  # fmt: skip
_MAX_NAME_COMPONENTS = 3


def undirected_adjacency(graph: nx.MultiDiGraph) -> Adjacency:
    """Neighbours with the shortest edge length between each pair, ignoring direction."""
    best: dict[tuple[str, str], float] = {}
    for u, v, data in graph.edges(data=True):
        if u == v:
            continue
        pair = (u, v) if u < v else (v, u)
        best[pair] = min(best.get(pair, float("inf")), data["length_m"])
    adjacency: Adjacency = defaultdict(list)
    for (a, b), length in best.items():
        adjacency[a].append((b, length))
        adjacency[b].append((a, length))
    return dict(adjacency)


def find_junction_nodes(
    adjacency: Adjacency, min_neighbours: int = JUNCTION_MIN_DISTINCT_NEIGHBOURS
) -> set[str]:
    return {node for node, neighbours in adjacency.items() if len(neighbours) >= min_neighbours}


def nearest_junctions(adjacency: Adjacency, junctions: set[str]) -> dict[str, tuple[str, float]]:
    """For every node, the nearest junction along the road (undirected) and the distance in metres.

    One multi-source Dijkstra; ties go to the junction with the smaller node key.
    """
    best: dict[str, tuple[float, str]] = {}
    heap: list[tuple[float, str, str]] = [(0.0, j, j) for j in sorted(junctions)]
    heapq.heapify(heap)
    while heap:
        distance, source, node = heapq.heappop(heap)
        if node in best and best[node] <= (distance, source):
            continue
        best[node] = (distance, source)
        for neighbour, length in adjacency.get(node, []):
            candidate = (distance + length, source)
            if neighbour not in best or candidate < best[neighbour]:
                heapq.heappush(heap, (distance + length, source, neighbour))
    return {node: (source, distance) for node, (distance, source) in best.items()}


def nearest_of(adjacency: Adjacency, start: str, targets: set[str]) -> tuple[str, float] | None:
    """Nearest member of ``targets`` from ``start`` along the road, or None if unreachable."""
    heap = [(0.0, start)]
    settled: dict[str, float] = {}
    while heap:
        distance, node = heapq.heappop(heap)
        if node in settled:
            continue
        settled[node] = distance
        if node in targets:
            return node, distance
        for neighbour, length in adjacency.get(node, []):
            if neighbour not in settled:
                heapq.heappush(heap, (distance + length, neighbour))
    return None


@dataclass(slots=True)
class Ring:
    ring_id: int
    source: str  # "junction_tag" or "override"
    name: str | None
    edge_ids: set[str]
    nodes: set[str]
    arm_base_edge_ids: set[str] = field(default_factory=set)
    internal_base_edge_ids: set[str] = field(default_factory=set)
    internal_edge_ids: set[str] = field(default_factory=set)  # current ids of the internal edges
    verified: bool | None = None


def tagged_rings(graph: nx.MultiDiGraph) -> list[Ring]:
    """Rings from ``junction=roundabout|circular`` edges joined at shared nodes."""
    ring_edges = [
        (u, v, key, data)
        for u, v, key, data in graph.edges(keys=True, data=True)
        if data["junction"] in IMPLIED_ONEWAY_JUNCTION_VALUES
    ]
    undirected = nx.Graph()
    for u, v, _, _ in ring_edges:
        undirected.add_edge(u, v)
    rings: list[Ring] = []
    for nodes in nx.connected_components(undirected):
        edges = [(k, d) for u, v, k, d in ring_edges if u in nodes]
        names = Counter(d["name"] for _, d in edges if d["name"])
        rings.append(
            Ring(
                0,
                "junction_tag",
                names.most_common(1)[0][0] if names else None,
                {k for k, _ in edges},
                set(nodes),
            )
        )
    rings.sort(key=lambda ring: min(ring.edge_ids))
    return rings


def override_rings(
    graph: nx.MultiDiGraph, overrides: OverrideFile, existing: list[Ring]
) -> tuple[list[Ring], list[str]]:
    """Rings from the override file. Returns the rings and a list of problems found."""
    base_ids: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    for u, v, key, data in graph.edges(keys=True, data=True):
        base_ids[data["base_edge_id"]].append((u, v, key))
    taken = set().union(*(ring.nodes for ring in existing)) if existing else set()
    rings: list[Ring] = []
    problems: list[str] = []
    for entry in overrides.entries:
        listed = entry.ring_edge_ids + entry.entry_arm_edge_ids + entry.internal_edge_ids
        missing = [e for e in listed if e not in base_ids]
        if missing:
            problems.append(f"{entry.name}: unknown edge ids {missing[:5]}; entry skipped")
            continue
        if not entry.ring_edge_ids:
            problems.append(f"{entry.name}: no ring edges listed; entry skipped")
            continue
        edge_ids = {key for e in entry.ring_edge_ids for _, _, key in base_ids[e]}
        nodes = {n for e in entry.ring_edge_ids for u, v, _ in base_ids[e] for n in (u, v)}
        internal_ids = {key for e in entry.internal_edge_ids for _, _, key in base_ids[e]}
        internal_nodes = {
            n for e in entry.internal_edge_ids for u, v, _ in base_ids[e] for n in (u, v)
        }
        if nodes & taken:
            problems.append(f"{entry.name}: overlaps a tagged ring; entry skipped")
            continue
        dangling = _dangling_internal_nodes(graph, internal_nodes - nodes, edge_ids | internal_ids)
        if dangling:
            problems.append(
                f"{entry.name}: internal edges must join ring nodes without dangling ends "
                f"(problem at {sorted(dangling)[:3]}); entry skipped"
            )
            continue
        taken |= nodes
        rings.append(
            Ring(
                0,
                "override",
                entry.name,
                edge_ids,
                nodes,
                set(entry.entry_arm_edge_ids),
                set(entry.internal_edge_ids),
                internal_ids,
                entry.verified,
            )
        )
    return rings, problems


def _dangling_internal_nodes(
    graph: nx.MultiDiGraph, extra_nodes: set[str], allowed_edge_ids: set[str]
) -> set[str]:
    """Non-ring nodes touched by internal edges that are not a pass-through inside the intersection.

    An internal edge may pass through extra nodes (for example where a signal splits it) as long as
    every edge at such a node is internal or ring and it has two distinct neighbours; otherwise it
    would be a dead end or an arm.
    """
    bad: set[str] = set()
    for node in extra_nodes:
        incident = [*graph.in_edges(node, keys=True), *graph.out_edges(node, keys=True)]
        neighbours = {a if b == node else b for a, b, _ in incident if a != b}
        if len(neighbours) < 2 or any(key not in allowed_edge_ids for _, _, key in incident):
            bad.add(node)
    return bad


def number_rings(rings: list[Ring]) -> None:
    for index, ring in enumerate(rings):
        ring.ring_id = index


def street_name_components(graph: nx.MultiDiGraph, nodes: str | list[str]) -> list[str]:
    """Distinct street names around one or several nodes, most important road first.

    Never invents a name. With several nodes (a merged intersection) the edges of all of them count.
    """
    node_list = [nodes] if isinstance(nodes, str) else nodes
    entries: dict[str, tuple[int, float, str]] = {}
    incident = [
        edge
        for node in node_list
        for edge in [*graph.in_edges(node, data=True), *graph.out_edges(node, data=True)]
    ]
    for _, _, data in incident:
        name = data["name"]
        key = normalise_street_name(name) if name else ""
        if not key:
            continue
        rank = _HIGHWAY_RANK.get(data["highway"], 9)
        previous = entries.get(key)
        entries[key] = (
            min(rank, previous[0]) if previous else rank,
            (previous[1] if previous else 0.0) + data["length_m"],
            previous[2] if previous else name,
        )
    ordered = sorted(entries.values(), key=lambda e: (e[0], -e[1], e[2]))
    return [display for _, _, display in ordered[:_MAX_NAME_COMPONENTS]]


def coordinate_name(lat: float, lon: float) -> str:
    return f"{lat:.5f}, {lon:.5f}"


def format_intersection_id(index: int, total: int) -> str:
    """``INT-0001`` style; the width grows if there are more than 9999."""
    return f"{INTERSECTION_ID_PREFIX}{index:0{max(4, len(str(total)))}d}"
