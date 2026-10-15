"""T4: attach counted signals to the road graph by splitting edges at the signal position.

A signal sits either on an existing graph node (a junction vertex or way end), on an interior
vertex of an edge, or near an edge (snapped within a configurable tolerance). Edges are split so
the signal becomes a node; the directed edges that *arrive* at that node are the ones it controls.
``traffic_signals:direction`` picks the arrival direction relative to the way's digitised
direction (``forward`` = along it); without the tag both directions are controlled. At an existing
junction node the tag cannot pick an edge (the node belongs to several ways), so every arriving
edge is controlled and that is reported.
"""

from dataclasses import dataclass, field

import networkx as nx
import numpy as np
import shapely
from shapely.ops import substring

from greenwave.etl.config import SIGNAL_SNAP_TOLERANCE_METERS
from greenwave.etl.geo import unproject_points
from greenwave.etl.graph import node_key

SNAP_GRAPH_NODE = "graph_node"
SNAP_INTERIOR_VERTEX = "interior_vertex"
SNAP_OFFSET = "offset_snap"
SNAP_UNSNAPPED = "unsnapped"

DIRECTION_BOTH = "both_directions"
DIRECTION_FORWARD = "forward"
DIRECTION_BACKWARD = "backward"
DIRECTION_ALL_INCOMING = "node_all_incoming"
DIRECTION_UNRESOLVED = "unresolved"
DIRECTION_NOT_ATTACHED = "not_attached"

# Points closer than this along an edge share one node; closer than this to an end use that end.
_MIN_PIECE_METERS = 0.05
_ON_VERTEX_METERS = 1e-3


@dataclass(frozen=True, slots=True)
class SignalPoint:
    node_key: str
    node_type: str
    lon: float
    lat: float
    x_m: float
    y_m: float
    direction: str | None
    delay_seconds: float
    provisional_cluster_id: int | None


@dataclass(slots=True)
class Attachment:
    signal: SignalPoint
    snap_kind: str
    snap_distance_m: float | None
    graph_node: str | None
    controlled_edge_ids: list[str] = field(default_factory=list)
    direction_resolved: str = DIRECTION_NOT_ATTACHED
    issue: str | None = None
    nearest_street: str | None = None


@dataclass(slots=True)
class AttachResult:
    graph: nx.MultiDiGraph
    attachments: list[Attachment]
    edges_split: int
    nodes_added: int


@dataclass(slots=True)
class _Request:
    distance_m: float
    signal_index: int
    snap_kind: str


def _twin_edge_id(edge_id: str) -> str:
    return edge_id[:-1] + ("-" if edge_id.endswith("+") else "+")


def _piece_geometry(geometry: shapely.LineString, start: float, end: float) -> shapely.LineString:
    return substring(geometry, start, end)


def attach_signals(
    base_graph: nx.MultiDiGraph,
    signals: list[SignalPoint],
    tolerance_meters: float = SIGNAL_SNAP_TOLERANCE_METERS,
) -> AttachResult:
    """Return a copy of the graph with every snappable signal attached (``base_graph`` is kept)."""
    if tolerance_meters < 0:
        raise ValueError("snap tolerance must not be negative (metres)")
    graph: nx.MultiDiGraph = base_graph.copy()
    canonical = [
        (u, v, key, data)
        for u, v, key, data in base_graph.edges(keys=True, data=True)
        if not data["reverse_twin"]
    ]
    tree = shapely.STRtree([data["geometry"] for *_, data in canonical])

    attachments: list[Attachment] = []
    requests: dict[int, list[_Request]] = {}
    for index, signal in enumerate(signals):
        existing = node_key(signal.lon, signal.lat)
        if existing in base_graph:
            attachments.append(Attachment(signal, SNAP_GRAPH_NODE, 0.0, existing))
            continue
        point = shapely.Point(signal.x_m, signal.y_m)
        nearest, distances = tree.query_nearest(point, return_distance=True, all_matches=False)
        edge_index, distance = int(nearest[0]), float(distances[0])
        street = canonical[edge_index][3]["name"]
        if distance > tolerance_meters:
            attachments.append(
                Attachment(
                    signal,
                    SNAP_UNSNAPPED,
                    distance,
                    None,
                    issue=(
                        f"nearest edge is {distance:.1f} m away (tolerance {tolerance_meters:g} m)"
                    ),
                    nearest_street=street,
                )
            )
            continue
        geometry = canonical[edge_index][3]["geometry"]
        kind = SNAP_INTERIOR_VERTEX if distance <= _ON_VERTEX_METERS else SNAP_OFFSET
        attachments.append(Attachment(signal, kind, distance, None, nearest_street=street))
        requests.setdefault(edge_index, []).append(
            _Request(float(shapely.line_locate_point(geometry, point)), index, kind)
        )

    # arrivals[node][travel sign] = id of the edge that arrives at the node travelling that way.
    arrivals: dict[str, dict[str, str]] = {}
    nodes_added = 0
    edges_split = 0
    for edge_index, edge_requests in sorted(requests.items()):
        u, v, edge_id, data = canonical[edge_index]
        added = _split_edge(
            graph, u, v, edge_id, data, edge_requests, attachments, signals, arrivals
        )
        nodes_added += added
        edges_split += added > 0

    for attachment in attachments:
        if attachment.graph_node is None:
            continue
        _resolve_controlled_edges(graph, attachment, arrivals)
    return AttachResult(
        graph=graph, attachments=attachments, edges_split=edges_split, nodes_added=nodes_added
    )


def _split_edge(
    graph: nx.MultiDiGraph,
    u: str,
    v: str,
    edge_id: str,
    data: dict[str, object],
    edge_requests: list[_Request],
    attachments: list[Attachment],
    signals: list[SignalPoint],
    arrivals: dict[str, dict[str, str]],
) -> int:
    geometry = data["geometry"]
    assert isinstance(geometry, shapely.LineString)
    length = float(geometry.length)
    ordered = sorted(edge_requests, key=lambda r: (r.distance_m, signals[r.signal_index].node_key))

    # Decide the node of each request: an existing end, a node shared with the previous request,
    # or a new node.
    new_nodes: list[tuple[float, str, int, str]] = []  # (distance, key, first signal index, kind)
    for request in ordered:
        attachment = attachments[request.signal_index]
        if request.distance_m <= _MIN_PIECE_METERS:
            attachment.graph_node = u
        elif length - request.distance_m <= _MIN_PIECE_METERS:
            attachment.graph_node = v
        elif new_nodes and request.distance_m - new_nodes[-1][0] <= _MIN_PIECE_METERS:
            attachment.graph_node = new_nodes[-1][1]
        else:
            signal = signals[request.signal_index]
            key = (
                node_key(signal.lon, signal.lat)
                if request.snap_kind == SNAP_INTERIOR_VERTEX
                else f"snap:{signal.node_key}"
            )
            new_nodes.append((request.distance_m, key, request.signal_index, request.snap_kind))
            attachment.graph_node = key
    if not new_nodes:
        return 0

    distances = [d for d, *_ in new_nodes]
    keys = [key for _, key, *_ in new_nodes]
    new_keys = set(keys)
    xy = np.array([shapely.get_coordinates(geometry.interpolate(d))[0] for d in distances])
    lon_lat = unproject_points(xy)
    for position, (_, key, signal_index, kind) in enumerate(new_nodes):
        signal = signals[signal_index]
        lon, lat = (
            (signal.lon, signal.lat) if kind == SNAP_INTERIOR_VERTEX else tuple(lon_lat[position])
        )
        graph.add_node(
            key,
            lon=float(lon),
            lat=float(lat),
            x_m=float(xy[position][0]),
            y_m=float(xy[position][1]),
        )

    twin_id = _twin_edge_id(edge_id)
    twin_data = graph.get_edge_data(v, u, key=twin_id) if edge_id.endswith(("+", "-")) else None
    directions = [(u, v, edge_id, data, [0.0, *distances, length], [u, *keys, v])]
    if twin_data is not None and twin_data["reverse_twin"]:
        directions.append(
            (
                v,
                u,
                twin_id,
                twin_data,
                [0.0, *[length - d for d in reversed(distances)], length],
                [v, *reversed(keys), u],
            )
        )
    for from_node, to_node, original_id, original, bounds, chain in directions:
        original_geometry = original["geometry"]
        graph.remove_edge(from_node, to_node, key=original_id)
        sign = original_id[-1]
        for piece_index in range(len(chain) - 1):
            piece_id = f"{original_id}~{piece_index}"
            piece = _piece_geometry(original_geometry, bounds[piece_index], bounds[piece_index + 1])
            attributes = {
                **original,
                "edge_id": piece_id,
                "geometry": piece,
                "length_m": float(piece.length),
            }
            graph.add_edge(chain[piece_index], chain[piece_index + 1], key=piece_id, **attributes)
            if chain[piece_index + 1] in new_keys:
                arrivals.setdefault(chain[piece_index + 1], {})[sign] = piece_id
    return len(new_nodes)


def _resolve_controlled_edges(
    graph: nx.MultiDiGraph, attachment: Attachment, arrivals: dict[str, dict[str, str]]
) -> None:
    node = attachment.graph_node
    assert node is not None
    direction = attachment.signal.direction
    new_node_arrivals = arrivals.get(node)
    if new_node_arrivals is None:
        # An existing node (junction vertex, way end): it belongs to several ways, so the
        # direction tag cannot pick an edge.
        attachment.controlled_edge_ids = sorted(
            key for _, _, key in graph.in_edges(node, keys=True)
        )
        attachment.direction_resolved = DIRECTION_ALL_INCOMING
        if not attachment.controlled_edge_ids:
            attachment.issue = "no edge arrives at the node"
        return
    if direction in (None, "both"):
        attachment.controlled_edge_ids = sorted(new_node_arrivals.values())
        attachment.direction_resolved = DIRECTION_BOTH
        return
    wanted = {"forward": "+", "backward": "-"}.get(direction)
    if wanted is None:
        attachment.direction_resolved = DIRECTION_UNRESOLVED
        attachment.issue = f"unrecognised traffic_signals:direction value {direction!r}"
        return
    edge_id = new_node_arrivals.get(wanted)
    if edge_id is None:
        attachment.direction_resolved = DIRECTION_UNRESOLVED
        attachment.issue = (
            f"direction={direction} but no edge arrives travelling that way (one-way against it)"
        )
        return
    attachment.controlled_edge_ids = [edge_id]
    attachment.direction_resolved = (
        DIRECTION_FORWARD if direction == "forward" else DIRECTION_BACKWARD
    )
