"""On-foot access to an incident beyond the snap limit (spec D; ADR 0009).

An incident that does not snap to the routable network is reached at an *access node*: a
snap-set node within walking reach, chosen per origin by drive time plus walking time. The walk
is a straight line times a detour factor; barriers (river, rail, fences) are not modelled.
"""

import heapq
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from itertools import count
from math import inf

import networkx as nx
import numpy as np

from greenwave.etl.geo import project_points
from greenwave.routing.errors import DestinationOffNetwork
from greenwave.routing.network_index import RoutingIndex
from greenwave.schemas.simulation import Position
from greenwave.simulation_settings import SimulationSettings

EdgeWeight = Callable[[str, str, Mapping[object, object]], float]


@dataclass(frozen=True, slots=True)
class AccessNode:
    """A routable node the crew can walk to the incident from."""

    node_key: str
    straight_m: float
    on_foot_m: float  # straight_m * on_foot_detour_factor
    on_foot_seconds: float  # on_foot_m / on_foot_speed_meters_per_second


def access_nodes(
    index: RoutingIndex, position: Position, settings: SimulationSettings
) -> tuple[AccessNode, ...]:
    """Snap-set nodes within the on-foot limit of ``position`` (inclusive), nearest first.

    Raises ``DestinationOffNetwork`` when there is none.
    """
    x, y = project_points(
        np.array([position.lng], dtype=np.float64), np.array([position.lat], dtype=np.float64)
    )[0]
    reach_m = settings.max_on_foot_meters / settings.on_foot_detour_factor
    nodes = tuple(
        AccessNode(
            node_key=key,
            straight_m=straight_m,
            on_foot_m=straight_m * settings.on_foot_detour_factor,
            on_foot_seconds=straight_m
            * settings.on_foot_detour_factor
            / settings.on_foot_speed_meters_per_second,
        )
        for key, straight_m in index.nodes_within(float(x), float(y), reach_m)
    )
    if not nodes:
        raise DestinationOffNetwork(
            f"Incident is farther than {settings.max_on_foot_meters:.0f} m on foot "
            "from any vehicle access point"
        )
    return nodes


def seeded_lengths(
    graph: nx.MultiDiGraph, seeds: Mapping[str, float], weight: EdgeWeight
) -> dict[str, float]:
    """Dijkstra from several sources, each starting at its own value.

    ``weight`` has the networkx callback signature (source, target, parallel-edge data). With one
    seed at 0 this equals ``nx.single_source_dijkstra_path_length``. O((V + E) log V).
    """
    lengths: dict[str, float] = {}
    order = count()  # ties pop in insertion order, never comparing node keys of mixed types
    heap = [(value, next(order), node) for node, value in seeds.items()]
    heapq.heapify(heap)
    while heap:
        length, _, node = heapq.heappop(heap)
        if node in lengths:
            continue
        lengths[node] = length
        for target, data in graph.adj[node].items():
            if target in lengths:
                continue
            step = weight(node, target, data)
            if step == inf:
                continue
            heapq.heappush(heap, (length + step, next(order), target))
    return lengths


def best_access(
    lengths: Mapping[str, float], nodes: Sequence[AccessNode], exclude: str | None = None
) -> AccessNode | None:
    """The reachable access node with the least drive + walk time (ties by node key)."""
    reachable = [n for n in nodes if n.node_key != exclude and n.node_key in lengths]
    if not reachable:
        return None
    return min(reachable, key=lambda n: (lengths[n.node_key] + n.on_foot_seconds, n.node_key))
