"""T3 check (b): shortest-path sanity checks between named places, written out as GeoJSON."""

import itertools
import json
from dataclasses import dataclass
from typing import Any

import geopandas as gpd
import networkx as nx
import numpy as np
import shapely
from pydantic import BaseModel

from greenwave.etl.cluster_map import JUNCTIONS, locate_junction
from greenwave.etl.config import (
    METRIC_CRS,
    ROUTE_DETOUR_RATIO_RANGE,
    ROUTE_SNAP_TOLERANCE_METERS,
    SOURCE_CRS,
)
from greenwave.etl.geo import project_points
from greenwave.etl.profile_osm import DrivableWay

# Pairs of places from the named-junction list (labels as in ``cluster_map.JUNCTIONS``).
PLACE_PAIRS: tuple[tuple[str, str], ...] = (
    ("Rondo Mogilskie", "Rondo Grunwaldzkie"),
    ("Rondo Czyżyńskie", "Rondo Matecznego"),
    ("Rondo Kocmyrzowskie", "Rondo Barei"),
    ("Rondo Grzegórzeckie", "Aleje / Czarnowiejska"),
    ("Rondo Ofiar Katynia", "Rondo 308 Dywizjonu"),
)


class RouteCheck(BaseModel):
    origin: str
    destination: str
    origin_snap_m: float | None
    destination_snap_m: float | None
    route_found: bool
    route_length_km: float | None
    straight_line_km: float | None
    detour_ratio: float | None
    within_expected_range: bool | None
    edges: int | None
    travel_time_minutes_at_posted_speed: float | None
    # Share of the route's length whose speed is a class default, not an OSM maxspeed: the higher
    # it is, the less the travel time can be trusted.
    share_of_length_on_default_speed: float | None = None
    note: str | None = None


@dataclass(frozen=True, slots=True)
class RouteCheckResult:
    checks: list[RouteCheck]
    geojson: dict[str, object]


def _snap_candidates(graph: nx.MultiDiGraph, nodes: set[str]) -> tuple[list[str], shapely.STRtree]:
    keys = sorted(nodes)
    points = shapely.points(
        np.array([[graph.nodes[k]["x_m"], graph.nodes[k]["y_m"]] for k in keys])
    )
    return keys, shapely.STRtree(points)


def _to_wgs84(geometry: shapely.Geometry) -> dict[str, object]:
    projected = gpd.GeoSeries([geometry], crs=METRIC_CRS).to_crs(SOURCE_CRS)
    return dict(json.loads(shapely.to_geojson(projected.iloc[0])))


def run_route_checks(
    graph: nx.MultiDiGraph,
    ways: list[DrivableWay],
    pairs: tuple[tuple[str, str], ...] = PLACE_PAIRS,
    detour_range: tuple[float, float] = ROUTE_DETOUR_RATIO_RANGE,
    snap_tolerance_meters: float = ROUTE_SNAP_TOLERANCE_METERS,
) -> RouteCheckResult:
    """Shortest path by length between named places; endpoints are snapped to the graph.

    Endpoints are restricted to the largest strongly connected component so a missing route
    means a real connectivity problem, not an endpoint on an island. This snaps reference places
    only; signals are attached in T4.
    """
    largest = max(nx.strongly_connected_components(graph), key=len)
    keys, tree = _snap_candidates(graph, largest)
    specs = {spec.label: spec for spec in JUNCTIONS}
    checks: list[RouteCheck] = []
    features: list[dict[str, object]] = []

    def locate(label: str) -> tuple[str, float] | None:
        centre = locate_junction(specs[label], ways)
        if centre is None:
            return None
        xy = project_points(np.array([centre[0]]), np.array([centre[1]]))[0]
        indices, distances = tree.query_nearest(shapely.points(xy), return_distance=True)
        return keys[int(indices[0])], float(distances[0])

    for origin, destination in pairs:
        start, end = locate(origin), locate(destination)
        if start is None or end is None:
            note = "place could not be located from street names"
            checks.append(_unrouted(origin, destination, start, end, note))
            continue
        if max(start[1], end[1]) > snap_tolerance_meters:
            note = f"no graph node within {snap_tolerance_meters:g} m of a place"
            checks.append(_unrouted(origin, destination, start, end, note))
            continue
        path = nx.shortest_path(graph, start[0], end[0], weight="length_m")
        chosen = [
            min(graph[u][v].values(), key=lambda data: data["length_m"])
            for u, v in itertools.pairwise(path)
        ]
        check = _measure(graph, chosen, origin, destination, start, end, detour_range)
        checks.append(check)
        features += _route_features(graph, chosen, check, start[0], end[0])
    return RouteCheckResult(
        checks=checks, geojson={"type": "FeatureCollection", "features": features}
    )


_Snap = tuple[str, float]  # (graph node, snap distance in metres)


def _unrouted(
    origin: str, destination: str, start: _Snap | None, end: _Snap | None, note: str
) -> RouteCheck:
    return RouteCheck(
        origin=origin,
        destination=destination,
        origin_snap_m=start[1] if start else None,
        destination_snap_m=end[1] if end else None,
        route_found=False,
        route_length_km=None,
        straight_line_km=None,
        detour_ratio=None,
        within_expected_range=None,
        edges=None,
        travel_time_minutes_at_posted_speed=None,
        note=note,
    )


def _measure(
    graph: nx.MultiDiGraph,
    chosen: list[dict[str, Any]],
    origin: str,
    destination: str,
    start: _Snap,
    end: _Snap,
    detour_range: tuple[float, float],
) -> RouteCheck:
    """Length, detour against the straight line, posted-speed time and default-speed share."""
    route_m = sum(data["length_m"] for data in chosen)
    straight_m = float(
        np.hypot(
            graph.nodes[start[0]]["x_m"] - graph.nodes[end[0]]["x_m"],
            graph.nodes[start[0]]["y_m"] - graph.nodes[end[0]]["y_m"],
        )
    )
    ratio = route_m / straight_m if straight_m else None
    default_m = sum(data["length_m"] for data in chosen if data["speed_source"] != "osm_maxspeed")
    seconds = sum(data["length_m"] / (data["speed_kmh"] / 3.6) for data in chosen)
    return RouteCheck(
        origin=origin,
        destination=destination,
        origin_snap_m=start[1],
        destination_snap_m=end[1],
        route_found=True,
        route_length_km=route_m / 1000,
        straight_line_km=straight_m / 1000,
        detour_ratio=ratio,
        within_expected_range=(
            detour_range[0] <= ratio <= detour_range[1] if ratio is not None else None
        ),
        edges=len(chosen),
        travel_time_minutes_at_posted_speed=seconds / 60,
        share_of_length_on_default_speed=default_m / route_m if route_m else None,
    )


def _route_features(
    graph: nx.MultiDiGraph,
    chosen: list[dict[str, Any]],
    check: RouteCheck,
    start_node: str,
    end_node: str,
) -> list[dict[str, object]]:
    """The route line and its two snapped endpoints as GeoJSON features (WGS84)."""
    route_line = shapely.line_merge(
        shapely.MultiLineString([list(data["geometry"].coords) for data in chosen])
    )
    features: list[dict[str, object]] = [
        {
            "type": "Feature",
            "geometry": _to_wgs84(route_line),
            "properties": {
                "kind": "route",
                "from": check.origin,
                "to": check.destination,
                **{
                    k: v
                    for k, v in check.model_dump().items()
                    if k not in ("origin", "destination", "note")
                },
            },
        }
    ]
    for role, key, label in (
        ("start", start_node, check.origin),
        ("end", end_node, check.destination),
    ):
        features.append(
            {
                "type": "Feature",
                "geometry": _to_wgs84(
                    shapely.Point(graph.nodes[key]["x_m"], graph.nodes[key]["y_m"])
                ),
                "properties": {"kind": role, "place": label},
            }
        )
    return features
