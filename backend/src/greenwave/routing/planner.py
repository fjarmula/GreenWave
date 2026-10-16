"""Snap WGS84 requests and produce deterministic fastest directed routes."""

from collections.abc import Mapping
from dataclasses import dataclass
from itertools import pairwise
from math import inf

import networkx as nx
import numpy as np

from greenwave.etl.geo import project_points, unproject_points
from greenwave.routing.errors import DestinationOffNetwork, NoRoute, OriginOffNetwork
from greenwave.routing.network_index import RoutingIndex
from greenwave.schemas.simulation import Position
from greenwave.simulation_settings import SimulationSettings


@dataclass(frozen=True, slots=True)
class SnappedRouteEndpoint:
    """A request endpoint resolved to its actual graph node."""

    node_key: str
    position: Position
    snap_distance_m: float


@dataclass(frozen=True, slots=True)
class StopLineEvent:
    """A controlled approach stop line at the end of one route edge."""

    intersection_id: str
    edge_id: str
    distance_along_route_m: float


@dataclass(frozen=True, slots=True)
class PlannedRoute:
    """One fully snapped route, expressed in metric distances and WGS84 display geometry."""

    edge_ids: tuple[str, ...]
    edge_lengths_m: tuple[float, ...]
    edge_speeds_kmh: tuple[float, ...]
    cumulative_m: tuple[float, ...]
    total_distance_m: float
    polyline_wgs84: list[tuple[float, float]]
    origin_snap: SnappedRouteEndpoint
    destination_snap: SnappedRouteEndpoint
    stop_lines: tuple[StopLineEvent, ...]


def ambulance_speed_kmh(speed_kmh: float, settings: SimulationSettings) -> float:
    """Return the bounded emergency-vehicle speed used for route weighting."""
    return min(
        max(settings.ambulance_speed_factor * speed_kmh, settings.ambulance_min_speed_kmh),
        settings.ambulance_max_speed_kmh,
    )


def _edge_weight(
    _: str, __: str, data: Mapping[object, object], settings: SimulationSettings
) -> float:
    """NetworkX MultiDiGraph callback: minimum ambulance time among parallel edges."""
    weights: list[float] = []
    for candidate in data.values():
        if not isinstance(candidate, Mapping):
            continue
        length = float(candidate["length_m"])
        speed = ambulance_speed_kmh(float(candidate["speed_kmh"]), settings)
        weights.append(length / (speed / 3.6))
    return min(weights, default=inf)


def _best_edge_id(
    index: RoutingIndex, source: str, target: str, settings: SimulationSettings
) -> str:
    """Choose the same stable minimum-time parallel edge that the path weight used."""
    candidates = index.graph.get_edge_data(source, target)
    if candidates is None:
        raise NoRoute(f"route step {source!r}->{target!r} has no edge")
    return min(
        (str(edge_id) for edge_id in candidates),
        key=lambda edge_id: _edge_key(index, edge_id, settings),
    )


def _edge_key(index: RoutingIndex, edge_id: str, settings: SimulationSettings) -> tuple[float, str]:
    edge = index.edge(edge_id)
    duration = edge.length_m / (ambulance_speed_kmh(edge.speed_kmh, settings) / 3.6)
    return duration, edge_id


def _snap_endpoint(index: RoutingIndex, position: Position, origin: bool) -> SnappedRouteEndpoint:
    xy = project_points(
        np.array([position.lng], dtype=np.float64), np.array([position.lat], dtype=np.float64)
    )[0]
    snapped = index.snap(float(xy[0]), float(xy[1]))
    if snapped is None:
        error = OriginOffNetwork if origin else DestinationOffNetwork
        label = "Origin" if origin else "Destination"
        raise error(f"{label} is farther than the configured snap limit from the routable network")
    node_key, distance_m = snapped
    node = index.graph.nodes[node_key]
    return SnappedRouteEndpoint(
        node_key=node_key,
        position=Position(lat=float(node["lat"]), lng=float(node["lon"])),
        snap_distance_m=distance_m,
    )


def plan_route(
    index: RoutingIndex,
    origin: Position,
    destination: Position,
    settings: SimulationSettings,
) -> PlannedRoute:
    """Plan the fastest ambulance route between snapped positions or raise a domain error."""
    origin_snap = _snap_endpoint(index, origin, origin=True)
    destination_snap = _snap_endpoint(index, destination, origin=False)
    if origin_snap.node_key == destination_snap.node_key:
        raise NoRoute("origin and destination snap to the same node; route has no edges")
    try:
        node_path = nx.shortest_path(
            index.graph,
            origin_snap.node_key,
            destination_snap.node_key,
            weight=lambda source, target, data: _edge_weight(source, target, data, settings),
        )
    except nx.NetworkXNoPath as error:
        raise NoRoute("no directed route connects the snapped origin and destination") from error
    edge_ids = tuple(
        _best_edge_id(index, str(source), str(target), settings)
        for source, target in pairwise(node_path)
    )
    if not edge_ids:
        raise NoRoute("route has no edges")
    edges = tuple(index.edge(edge_id) for edge_id in edge_ids)
    lengths = tuple(edge.length_m for edge in edges)
    cumulative: list[float] = []
    distance = 0.0
    metric_coordinates: list[tuple[float, float]] = []
    stop_lines: list[StopLineEvent] = []
    for edge in edges:
        cumulative.append(distance)
        coordinates = list(edge.geometry.coords)
        if metric_coordinates:
            coordinates = coordinates[1:]
        metric_coordinates.extend((float(x), float(y)) for x, y in coordinates)
        distance += edge.length_m
        stop_lines.extend(
            StopLineEvent(approach.intersection_id, edge.edge_id, distance)
            for approach in index.approaches_on_edge(edge.edge_id)
        )
    wgs84 = unproject_points(np.asarray(metric_coordinates, dtype=np.float64))
    return PlannedRoute(
        edge_ids=edge_ids,
        edge_lengths_m=lengths,
        edge_speeds_kmh=tuple(edge.speed_kmh for edge in edges),
        cumulative_m=tuple(cumulative),
        total_distance_m=distance,
        polyline_wgs84=[(float(lon), float(lat)) for lon, lat in wgs84],
        origin_snap=origin_snap,
        destination_snap=destination_snap,
        stop_lines=tuple(sorted(stop_lines, key=lambda stop: stop.distance_along_route_m)),
    )
