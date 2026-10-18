"""Merge junction nodes within a distance along the road, under a diameter cap."""

import heapq
from dataclasses import dataclass

import networkx as nx
from pydantic import BaseModel

from greenwave.etl.intersections.model import GroupingSettings
from greenwave.etl.junctions import (
    Adjacency,
    street_name_components,
)


def reach_within(adjacency: Adjacency, start: str, cutoff: float) -> dict[str, float]:
    """Along-road distance from ``start`` to every node within ``cutoff`` metres."""
    heap = [(0.0, start)]
    settled: dict[str, float] = {}
    while heap:
        distance, node = heapq.heappop(heap)
        if node in settled:
            continue
        settled[node] = distance
        for neighbour, length in adjacency.get(node, []):
            if distance + length <= cutoff and neighbour not in settled:
                heapq.heappush(heap, (distance + length, neighbour))
    return settled


class CappedCase(BaseModel):
    node_a: str
    node_b: str
    lon_a: float
    lat_a: float
    lon_b: float
    lat_b: float
    distance_m: float
    group_a_size: int
    group_b_size: int
    would_be_diameter_m: float | None  # None: some member pair is more than twice the cap apart
    streets_a: list[str]
    streets_b: list[str]


@dataclass(slots=True)
class MergeResult:
    groups: list[list[str]]
    capped: list[CappedCase]
    candidate_pairs: int
    merges: int
    diameters_m: dict[tuple[str, ...], float]


def merge_junction_nodes(
    graph: nx.MultiDiGraph,
    adjacency: Adjacency,
    nodes: list[str],
    merge_distance_meters: float,
    max_diameter_meters: float,
) -> MergeResult:
    """Group nodes within ``merge_distance_meters`` along the road, closest pairs first.

    A merge is refused (and reported) when the group's diameter, the largest along-road distance
    between two members, would exceed ``max_diameter_meters``.
    """
    node_set = set(nodes)
    # Search twice the cap so a refused merge can report its real would-be diameter.
    cutoff = max(merge_distance_meters, 2 * max_diameter_meters)
    reach = {node: reach_within(adjacency, node, cutoff) for node in sorted(node_set)}
    pairs = sorted(
        (distance, a, b)
        for a in reach
        for b, distance in reach[a].items()
        if a < b and b in node_set and distance <= merge_distance_meters
    )
    members: dict[str, list[str]] = {node: [node] for node in node_set}
    diameter: dict[str, float] = {node: 0.0 for node in node_set}
    parent = {node: node for node in node_set}

    def find(item: str) -> str:
        while parent[item] != item:
            parent[item] = parent[parent[item]]
            item = parent[item]
        return item

    capped: list[CappedCase] = []
    refused: set[tuple[tuple[str, ...], tuple[str, ...]]] = set()
    merges = 0
    for distance, a, b in pairs:
        root_a, root_b = find(a), find(b)
        if root_a == root_b:
            continue
        cross = max(reach[x].get(y, float("inf")) for x in members[root_a] for y in members[root_b])
        would_be = max(diameter[root_a], diameter[root_b], cross)
        if would_be > max_diameter_meters:
            first, second = sorted((tuple(sorted(members[root_a])), tuple(sorted(members[root_b]))))
            key = (first, second)
            if key not in refused:
                refused.add(key)
                capped.append(
                    CappedCase(
                        node_a=a,
                        node_b=b,
                        lon_a=graph.nodes[a]["lon"],
                        lat_a=graph.nodes[a]["lat"],
                        lon_b=graph.nodes[b]["lon"],
                        lat_b=graph.nodes[b]["lat"],
                        distance_m=distance,
                        group_a_size=len(members[root_a]),
                        group_b_size=len(members[root_b]),
                        would_be_diameter_m=None if would_be == float("inf") else would_be,
                        streets_a=street_name_components(graph, members[root_a]),
                        streets_b=street_name_components(graph, members[root_b]),
                    )
                )
            continue
        keep, drop = sorted((root_a, root_b))
        parent[drop] = keep
        members[keep] += members.pop(drop)
        diameter[keep] = would_be
        diameter.pop(drop)
        merges += 1

    groups = sorted((sorted(m) for m in members.values()), key=lambda g: g[0])
    diameters = {tuple(sorted(members[root])): diameter[root] for root in members}
    return MergeResult(groups, capped, len(pairs), merges, diameters)


_CAP_SENSITIVITY_METERS = (30.0, 40.0, 50.0, 60.0, 80.0)


def capped_case_sensitivity(
    graph: nx.MultiDiGraph,
    adjacency: Adjacency,
    nodes: list[str],
    settings: GroupingSettings,
) -> dict[str, int]:
    """How many merges would be refused under other diameter caps (diagnostic)."""
    return {
        f"{cap:g}": len(
            merge_junction_nodes(
                graph, adjacency, nodes, settings.merge_distance_meters, cap
            ).capped
        )
        for cap in _CAP_SENSITIVITY_METERS
    }


_CAP_DETAIL_METERS = (50.0,)


def capped_case_details(
    graph: nx.MultiDiGraph,
    adjacency: Adjacency,
    nodes: list[str],
    settings: GroupingSettings,
) -> dict[str, list[CappedCase]]:
    """The refused merges under tighter caps than the configured one, for review."""
    return {
        f"{cap:g}": merge_junction_nodes(
            graph, adjacency, nodes, settings.merge_distance_meters, cap
        ).capped
        for cap in _CAP_DETAIL_METERS
        if cap < settings.merge_max_group_diameter_meters
    }
