"""Hand-built metric graphs with exact route and stop-line distances for simulation tests."""

from collections.abc import Mapping
from types import MappingProxyType

import networkx as nx
import numpy as np
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

from greenwave.etl.geo import unproject_points
from greenwave.routing.network_index import ApproachRef, EdgeView, IntersectionInfo, RoutingIndex
from greenwave.schemas.simulation import Position
from greenwave.simulation_settings import SimulationSettings

_X = 7_421_000.0
_Y = 5_541_000.0


def position_at(x_m: float, y_m: float = _Y) -> Position:
    lon, lat = unproject_points(np.array([[x_m, y_m]], dtype=np.float64))[0]
    return Position(lat=float(lat), lng=float(lon))


def corridor_index(
    *,
    signal_count: int = 1,
    approach_count: int = 1,
    needs_review: bool = False,
    neighbour_candidates: Mapping[tuple[str, str], float] | None = None,
) -> RoutingIndex:
    """An index with a fast detour, corridor stop lines, a one-way edge, and an island."""
    graph = nx.MultiDiGraph()

    def node(key: str, x: float, y: float = _Y) -> None:
        position = position_at(x, y)
        graph.add_node(key, x_m=x, y_m=y, lon=position.lng, lat=position.lat)

    def edge(edge_id: str, source: str, target: str, length: float, speed: float) -> None:
        source_data = graph.nodes[source]
        target_data = graph.nodes[target]
        graph.add_edge(
            source,
            target,
            key=edge_id,
            edge_id=edge_id,
            length_m=length,
            speed_kmh=speed,
            geometry=LineString(
                [(source_data["x_m"], source_data["y_m"]), (target_data["x_m"], target_data["y_m"])]
            ),
        )

    node("short-start", _X)
    node("short-end", _X + 100)
    node("fast-mid", _X + 50, _Y + 100)
    edge("short-slow", "short-start", "short-end", 100, 30)
    edge("fast-a", "short-start", "fast-mid", 60, 90)
    edge("fast-b", "fast-mid", "short-end", 60, 90)

    node("corridor-0", _X + 1_000)
    node("corridor-1", _X + 1_100)
    node("corridor-2", _X + 1_350)
    node("corridor-3", _X + 1_600.01)
    node("corridor-4", _X + 1_850.02)
    edge("corridor-a", "corridor-0", "corridor-1", 100, 36)
    edge("corridor-twin-1", "corridor-1", "corridor-2", 250, 36)
    edge("corridor-twin-2", "corridor-2", "corridor-3", 250.01, 36)
    edge("corridor-b", "corridor-3", "corridor-4", 250.01, 36)

    node("one-way-start", _X + 3_000)
    node("one-way-end", _X + 3_100)
    edge("one-way", "one-way-start", "one-way-end", 100, 36)
    node("island", _X + 5_000)

    edges = {
        data["edge_id"]: EdgeView(
            edge_id=data["edge_id"],
            source_node=source,
            target_node=target,
            length_m=float(data["length_m"]),
            speed_kmh=float(data["speed_kmh"]),
            geometry=data["geometry"],
        )
        for source, target, data in graph.edges(data=True)
    }
    approaches = {
        "corridor-a": (ApproachRef("INT-A", "sig-a", "corridor-a"),),
        "corridor-twin-1": (ApproachRef("INT-TWIN", "sig-twin-1", "corridor-twin-1"),),
        "corridor-twin-2": (
            ApproachRef("INT-TWIN", "sig-twin-2", "corridor-twin-2"),
            ApproachRef("INT-C", "sig-c", "corridor-twin-2"),
        ),
        "corridor-b": (ApproachRef("INT-B", "sig-b", "corridor-b"),),
    }
    intersections = {
        identifier: IntersectionInfo(
            id=identifier,
            name=identifier,
            kind="signalised_junction",
            lon=position_at(x).lng,
            lat=position_at(x).lat,
            delay_seconds=delay,
            signal_count=signal_count,
            approach_count=approach_count,
            needs_review=needs_review,
        )
        for identifier, x, delay in (
            ("INT-A", _X + 1_100, 10),
            ("INT-TWIN", _X + 1_350, 20),
            ("INT-C", _X + 1_600.01, 30),
            ("INT-B", _X + 1_850.02, 40),
        )
    }
    node_keys = tuple(graph.nodes)
    node_points = tuple(
        Point(graph.nodes[key]["x_m"], graph.nodes[key]["y_m"]) for key in node_keys
    )
    return RoutingIndex(
        graph=nx.freeze(graph),
        cascade_threshold_m=250,
        _node_keys=node_keys,
        _node_points=node_points,
        _tree=STRtree(np.asarray(node_points, dtype=object)),
        _max_snap_distance_meters=SimulationSettings().max_snap_distance_meters,
        _edges=MappingProxyType(edges),
        _approaches=MappingProxyType(approaches),
        _intersections=MappingProxyType(intersections),
        _neighbour_candidates=MappingProxyType(dict(neighbour_candidates or {})),
    )
