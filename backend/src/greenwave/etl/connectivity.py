"""T3 connectivity report: strongly/weakly connected components, islands, one-way traps."""

from collections import Counter, defaultdict

import networkx as nx
from pydantic import BaseModel

_ISLANDS_LISTED = 50
_TRAPS_LISTED = 25
_SIZE_BUCKETS = ((1, "1"), (2, "2"), (5, "3-5"), (20, "6-20"), (100, "21-100"))


class ComponentSummary(BaseModel):
    nodes: int
    edges: int
    road_length_km: float
    centre_lon: float
    centre_lat: float
    top_streets: list[str]


class ConnectivityReport(BaseModel):
    nodes: int
    edges: int
    road_length_km: float
    weak_components: int
    strong_components: int
    largest_weak_nodes: int
    largest_weak_share_of_road_length: float
    largest_strong_nodes: int
    largest_strong_edges: int
    largest_strong_road_length_km: float
    largest_strong_share_of_road_length: float
    island_count: int
    island_nodes: int
    island_road_length_km: float
    island_size_histogram: dict[str, int]
    islands_listed: list[ComponentSummary]
    one_way_trap_fragments: int
    one_way_trap_nodes: int
    one_way_trap_road_length_km: float
    one_way_trap_fragments_listed: list[ComponentSummary]


def _bucket(size: int) -> str:
    for upper, label in _SIZE_BUCKETS:
        if size <= upper:
            return label
    return "101+"


def _summaries(
    graph: nx.MultiDiGraph,
    components: list[set[str]],
    limit: int,
) -> list[ComponentSummary]:
    """Summaries of the longest components.

    An edge belongs to the component holding its start node, or else the one holding its end node,
    so the entry edge of a one-way trap (whose only node has no internal edge) is still counted.
    """
    component_of = {node: index for index, nodes in enumerate(components) for node in nodes}
    length_m: defaultdict[int, float] = defaultdict(float)
    edge_count: Counter[int] = Counter()
    street_m: defaultdict[int, defaultdict[str, float]] = defaultdict(lambda: defaultdict(float))
    for u, v, data in graph.edges(data=True):
        index = component_of.get(u)
        if index is None:
            index = component_of.get(v)
        if index is None:
            continue
        edge_count[index] += 1
        if data["reverse_twin"]:
            continue
        length_m[index] += data["length_m"]
        if data["name"]:
            street_m[index][data["name"]] += data["length_m"]
    ranked = sorted(range(len(components)), key=lambda i: -length_m[i])[:limit]
    summaries = []
    for index in ranked:
        nodes = components[index]
        top = sorted(street_m[index].items(), key=lambda item: -item[1])[:3]
        summaries.append(
            ComponentSummary(
                nodes=len(nodes),
                edges=edge_count[index],
                road_length_km=length_m[index] / 1000,
                centre_lon=sum(graph.nodes[n]["lon"] for n in nodes) / len(nodes),
                centre_lat=sum(graph.nodes[n]["lat"] for n in nodes) / len(nodes),
                top_streets=[name for name, _ in top],
            )
        )
    return summaries


def main_component_nodes(graph: nx.MultiDiGraph) -> frozenset[str]:
    """Node keys of the largest strongly connected component: the routable core.

    Every node in it reaches and is reached by every other, so an endpoint snapped into it always
    has a route both ways; islands (e.g. a pedestrian street segment) never do. A size tie goes to
    the component with the smallest node key, so the choice is deterministic.
    """
    components = [
        frozenset(str(node) for node in c) for c in nx.strongly_connected_components(graph)
    ]
    if not components:
        return frozenset()
    return min(components, key=lambda component: (-len(component), min(component)))


def analyse_connectivity(graph: nx.MultiDiGraph) -> ConnectivityReport:
    total_road_m = sum(d["length_m"] for _, _, d in graph.edges(data=True) if not d["reverse_twin"])
    weak = sorted(nx.weakly_connected_components(graph), key=len, reverse=True)
    strong = sorted(nx.strongly_connected_components(graph), key=len, reverse=True)
    if not weak:
        raise ValueError("graph is empty")
    largest_weak, largest_strong = weak[0], strong[0]

    def road_length_inside(nodes: set[str]) -> tuple[int, float]:
        count, length = 0, 0.0
        for u, v, data in graph.edges(data=True):
            if u in nodes and v in nodes:
                count += 1
                length += 0.0 if data["reverse_twin"] else data["length_m"]
        return count, length

    weak_edges, weak_length = road_length_inside(largest_weak)
    strong_edges, strong_length = road_length_inside(largest_strong)
    del weak_edges

    islands = weak[1:]
    island_summaries = _summaries(graph, islands, limit=len(islands))
    traps = [component for component in strong[1:] if component <= largest_weak]
    trap_summaries = _summaries(graph, traps, limit=len(traps))

    return ConnectivityReport(
        nodes=graph.number_of_nodes(),
        edges=graph.number_of_edges(),
        road_length_km=total_road_m / 1000,
        weak_components=len(weak),
        strong_components=len(strong),
        largest_weak_nodes=len(largest_weak),
        largest_weak_share_of_road_length=weak_length / total_road_m,
        largest_strong_nodes=len(largest_strong),
        largest_strong_edges=strong_edges,
        largest_strong_road_length_km=strong_length / 1000,
        largest_strong_share_of_road_length=strong_length / total_road_m,
        island_count=len(islands),
        island_nodes=sum(len(c) for c in islands),
        island_road_length_km=sum(s.road_length_km for s in island_summaries),
        island_size_histogram=dict(
            sorted(Counter(_bucket(len(c)) for c in islands).items(), key=lambda kv: kv[0])
        ),
        islands_listed=island_summaries[:_ISLANDS_LISTED],
        one_way_trap_fragments=len(traps),
        one_way_trap_nodes=sum(len(c) for c in traps),
        one_way_trap_road_length_km=sum(s.road_length_km for s in trap_summaries),
        one_way_trap_fragments_listed=trap_summaries[:_TRAPS_LISTED],
    )
