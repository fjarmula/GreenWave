"""Startup-only lookup structures built from a validated processed dataset."""

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import cast

import networkx as nx
import numpy as np
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

from greenwave.dataset import ProcessedDataset
from greenwave.etl.connectivity import main_component_nodes
from greenwave.schemas import SignalMovementKind
from greenwave.simulation_settings import SimulationSettings

# Simulated movements each persisted signal node type may show; other node types show none.
SIGNAL_MOVEMENT_KINDS: Mapping[str, tuple[SignalMovementKind, ...]] = MappingProxyType(
    {
        "traffic_signals": (SignalMovementKind.VEHICLE, SignalMovementKind.PEDESTRIAN),
        "pedestrian_crossing": (SignalMovementKind.PEDESTRIAN,),
    }
)


@dataclass(frozen=True, slots=True)
class EdgeView:
    """Route-relevant attributes of one directed graph edge."""

    edge_id: str
    source_node: str
    target_node: str
    length_m: float
    speed_kmh: float
    geometry: LineString
    bus_lane: bool = False
    tram_track: bool = False
    lanes_per_direction: int | None = None
    surface_class: str | None = None
    calming_count: int = 0


@dataclass(frozen=True, slots=True)
class ApproachRef:
    """One signal approach controlled by an edge."""

    intersection_id: str
    signal_key: str
    edge_id: str


@dataclass(frozen=True, slots=True)
class SignalApproachRef:
    """One signal node of an intersection, at its processed WGS84 position (never synthesised)."""

    intersection_id: str
    signal_key: str
    node_type: str
    lon: float
    lat: float
    controlled_edge_ids: tuple[str, ...]

    @property
    def movement_kinds(self) -> tuple[SignalMovementKind, ...]:
        """Simulated movements this node may show, from its source node type."""
        return SIGNAL_MOVEMENT_KINDS.get(self.node_type, ())

    @property
    def movement_group(self) -> str | None:
        """The controlled approach identity (sorted edge ids); ``None`` when it controls none."""
        return "|".join(sorted(self.controlled_edge_ids)) or None


@dataclass(frozen=True, slots=True)
class IntersectionInfo:
    """Intersection metadata used by the route model and API response."""

    id: str
    name: str | None
    kind: str
    lon: float
    lat: float
    delay_seconds: float
    signal_count: int
    approach_count: int
    needs_review: bool


@dataclass(frozen=True, slots=True)
class RoutingIndex:
    """Immutable routing lookups; all coordinates here are metric EPSG:2178."""

    graph: nx.MultiDiGraph
    cascade_threshold_m: float
    _node_keys: tuple[str, ...]
    _node_points: tuple[Point, ...]
    _tree: STRtree
    _max_snap_distance_meters: float
    _edges: Mapping[str, EdgeView]
    _approaches: Mapping[str, tuple[ApproachRef, ...]]
    _intersections: Mapping[str, IntersectionInfo]
    _neighbour_candidates: Mapping[tuple[str, str], float]
    _signal_approaches: Mapping[str, tuple[SignalApproachRef, ...]] = MappingProxyType({})

    def snap(self, x_m: float, y_m: float) -> tuple[str, float] | None:
        """Return the nearest routable node within the configured metric distance."""
        point = Point(x_m, y_m)
        index = int(self._tree.nearest(point))
        distance = float(point.distance(self._node_points[index]))
        if distance > self._max_snap_distance_meters:
            return None
        return self._node_keys[index], distance

    def nodes_within(
        self, x_m: float, y_m: float, radius_m: float
    ) -> tuple[tuple[str, float], ...]:
        """Snap-set nodes at most ``radius_m`` away, nearest first (ties by node key)."""
        point = Point(x_m, y_m)
        # Geographic/projected round trips can put an exact boundary a few nanometres outside.
        inclusive_radius_m = radius_m + 1e-8
        found = (
            (self._node_keys[int(i)], float(point.distance(self._node_points[int(i)])))
            for i in self._tree.query(point, predicate="dwithin", distance=inclusive_radius_m)
        )
        return tuple(
            sorted(
                ((key, distance) for key, distance in found if distance <= inclusive_radius_m),
                key=lambda item: (item[1], item[0]),
            )
        )

    def edge(self, edge_id: str) -> EdgeView:
        """Get a route edge by its stable ETL edge id."""
        return self._edges[edge_id]

    def approaches_on_edge(self, edge_id: str) -> tuple[ApproachRef, ...]:
        """Return all attached controlled approaches on an edge, in stable order."""
        return self._approaches.get(edge_id, ())

    def intersection(self, intersection_id: str) -> IntersectionInfo:
        """Get canonical metadata for one route intersection."""
        return self._intersections[intersection_id]

    def signal_approaches(self, intersection_id: str) -> tuple[SignalApproachRef, ...]:
        """The intersection's supported signal nodes ordered by signal key; empty when none."""
        return self._signal_approaches.get(intersection_id, ())

    def neighbour_candidate(self, from_edge_id: str, to_edge_id: str) -> float | None:
        """Return the shortest candidate distance for an approach-edge pair, if present."""
        return self._neighbour_candidates.get((from_edge_id, to_edge_id))


def _optional_int(value: object) -> int | None:
    return None if value is None else int(cast("int", value))


def build_routing_index(dataset: ProcessedDataset, settings: SimulationSettings) -> RoutingIndex:
    """Build O(nodes + edges) immutable indexes once at application startup.

    Endpoints snap only to the main (largest strongly connected) component, so a start or an
    incident on a road island still gets a route; the graph itself keeps every node.
    """
    routable = main_component_nodes(dataset.graph)
    node_keys = tuple(
        str(node_key) for node_key in dataset.graph.nodes if str(node_key) in routable
    )
    node_points = tuple(
        Point(
            float(dataset.graph.nodes[node_key]["x_m"]),
            float(dataset.graph.nodes[node_key]["y_m"]),
        )
        for node_key in node_keys
    )
    if not node_points:
        raise ValueError("processed graph has no nodes")
    edges: dict[str, EdgeView] = {}
    for source, target, edge_key, attributes in dataset.graph.edges(keys=True, data=True):
        edge_id = str(attributes["edge_id"])
        if edge_id != str(edge_key):
            raise ValueError(f"graph edge key {edge_key!r} does not match edge_id {edge_id!r}")
        geometry = attributes["geometry"]
        if not isinstance(geometry, LineString):
            raise TypeError(f"edge {edge_id!r} geometry is not a LineString")
        edges[edge_id] = EdgeView(
            edge_id=edge_id,
            source_node=str(source),
            target_node=str(target),
            length_m=float(attributes["length_m"]),
            speed_kmh=float(attributes["speed_kmh"]),
            geometry=geometry,
            bus_lane=bool(attributes["bus_lane"]),
            tram_track=bool(attributes["tram_track"]),
            lanes_per_direction=_optional_int(attributes["lanes_per_direction"]),
            surface_class=attributes["surface_class"],
            calming_count=int(attributes["calming_count"]),
        )

    details = {
        str(row["intersection_id"]): row
        for row in dataset.intersections.select(
            "intersection_id",
            "delay_seconds",
            "signal_count",
            "approaches",
            "needs_review",
        ).iter_rows(named=True)
    }
    intersections = {
        record.id: IntersectionInfo(
            id=record.id,
            name=record.name,
            kind=record.kind,
            lon=record.lon,
            lat=record.lat,
            delay_seconds=float(details[record.id]["delay_seconds"]),
            signal_count=int(details[record.id]["signal_count"]),
            approach_count=int(details[record.id]["approaches"]),
            needs_review=bool(details[record.id]["needs_review"]),
        )
        for record in dataset.intersection_ids
    }
    approaches: dict[str, list[ApproachRef]] = {}
    signals: dict[str, list[SignalApproachRef]] = {}
    for row in dataset.signal_approaches.iter_rows(named=True):
        intersection_id = row["intersection_id"]
        if intersection_id is None:
            continue
        if row["node_type"] in SIGNAL_MOVEMENT_KINDS:
            signals.setdefault(str(intersection_id), []).append(
                SignalApproachRef(
                    intersection_id=str(intersection_id),
                    signal_key=str(row["signal_key"]),
                    node_type=str(row["node_type"]),
                    lon=float(row["lon"]),
                    lat=float(row["lat"]),
                    controlled_edge_ids=tuple(
                        str(edge_id) for edge_id in row["controlled_edge_ids"]
                    ),
                )
            )
        for edge_id in row["controlled_edge_ids"]:
            ref = ApproachRef(str(intersection_id), str(row["signal_key"]), str(edge_id))
            approaches.setdefault(ref.edge_id, []).append(ref)
    sorted_approaches = {
        edge_id: tuple(sorted(refs, key=lambda ref: (ref.intersection_id, ref.signal_key)))
        for edge_id, refs in approaches.items()
    }
    neighbour_candidates: dict[tuple[str, str], float] = {}
    for row in dataset.approach_neighbours.select(
        "from_approach_edge_id", "to_approach_edge_id", "distance_m"
    ).iter_rows(named=True):
        key = (str(row["from_approach_edge_id"]), str(row["to_approach_edge_id"]))
        distance = float(row["distance_m"])
        neighbour_candidates[key] = min(distance, neighbour_candidates.get(key, float("inf")))
    return RoutingIndex(
        graph=dataset.graph,
        cascade_threshold_m=dataset.cascade_threshold_m,
        _node_keys=node_keys,
        _node_points=node_points,
        _tree=STRtree(np.asarray(node_points, dtype=object)),
        _max_snap_distance_meters=settings.max_snap_distance_meters,
        _edges=MappingProxyType(edges),
        _approaches=MappingProxyType(sorted_approaches),
        _intersections=MappingProxyType(intersections),
        _neighbour_candidates=MappingProxyType(neighbour_candidates),
        _signal_approaches=MappingProxyType(
            {
                intersection_id: tuple(sorted(refs, key=lambda ref: ref.signal_key))
                for intersection_id, refs in signals.items()
            }
        ),
    )
