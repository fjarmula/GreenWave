"""Graph lookups about junction nodes: road class and representative position."""

import networkx as nx
import numpy as np

_ROAD_RANK = {"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4,
              "unclassified": 5, "residential": 6, "living_street": 7, "service": 8}  # fmt: skip


def best_incident_class(graph: nx.MultiDiGraph, nodes: str | list[str]) -> str:
    """Most important road class at the node(s); links count as their parent class."""
    node_list = [nodes] if isinstance(nodes, str) else nodes
    classes = {
        data["highway"].removesuffix("_link")
        for node in node_list
        for _, _, data in [*graph.in_edges(node, data=True), *graph.out_edges(node, data=True)]
    }
    # Unranked classes tie at 9; the name breaks ties so the pick never depends on set order.
    return min(classes, key=lambda c: (_ROAD_RANK.get(c, 9), c)) if classes else "none"


def centroid(graph: nx.MultiDiGraph, nodes: list[str]) -> tuple[float, float, str]:
    """Mean lon/lat of the nodes and the member node closest to the metric-CRS centroid."""
    xs = np.array([graph.nodes[n]["x_m"] for n in nodes])
    ys = np.array([graph.nodes[n]["y_m"] for n in nodes])
    nearest = nodes[int(np.argmin(np.hypot(xs - xs.mean(), ys - ys.mean())))]
    lon = float(np.mean([graph.nodes[n]["lon"] for n in nodes]))
    lat = float(np.mean([graph.nodes[n]["lat"] for n in nodes]))
    return lon, lat, nearest
