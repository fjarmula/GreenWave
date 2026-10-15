"""T3: build the directed road graph from the pinned GeoJSON ways (exact shared vertices).

Limitations, inherent to the GeoJSON source (decision 1): there are no OSM node ids
and no turn restrictions. Topology comes from vertices that share the exact 7-decimal coordinate,
so a node key is the rounded coordinate. Two ways that cross without a shared vertex (a bridge)
are correctly not connected. Signals are not attached here (T4); edges keep every original vertex
so T4 can split an edge at an exact signal vertex without losing geometry.
"""

import itertools
import logging
from collections import Counter, defaultdict
from dataclasses import dataclass

import networkx as nx
import numpy as np
import shapely
from pydantic import BaseModel

from greenwave.etl.geo import project_points
from greenwave.etl.profile_osm import DrivableWay, LonLat, tag
from greenwave.etl.road_rules import (
    UnrecognisedTagError,
    is_routable_way,
    resolve_oneway,
    resolve_speed,
)

logger = logging.getLogger(__name__)

_COORDINATE_DECIMALS = 7
_SAMPLE_LIMIT = 20


def node_key(lon: float, lat: float) -> str:
    """Stable node id: the coordinate rounded to the source precision (7 decimals)."""
    return f"{lon:.{_COORDINATE_DECIMALS}f},{lat:.{_COORDINATE_DECIMALS}f}"


class WayIssue(BaseModel):
    source_line: int
    reason: str


class GraphBuildReport(BaseModel):
    limitations: list[str]
    drivable_ways_in: int
    routable_ways: int
    ways_collapsed_to_a_point: int
    duplicate_consecutive_vertices_removed: int
    reversible_ways_excluded: int
    reversible_way_samples: list[WayIssue]
    unrecognised_oneway_ways_excluded: int
    unrecognised_oneway_samples: list[WayIssue]
    split_vertices: int
    nodes: int
    edges: int
    self_loop_edges: int
    node_pairs_with_parallel_edges: int
    edges_by_highway: dict[str, int]
    edge_length_km_by_oneway_source: dict[str, float]
    edge_length_km_by_speed_source: dict[str, float]
    class_default_length_km_by_highway: dict[str, float]
    total_directed_length_km: float
    total_road_length_km: float


@dataclass(slots=True)
class GraphBuild:
    graph: nx.MultiDiGraph
    report: GraphBuildReport


def _dedupe_consecutive(keys: list[str]) -> list[int]:
    """Indices of vertices to keep (drops a vertex equal to the previous kept one)."""
    kept: list[int] = []
    for index, key in enumerate(keys):
        if not kept or keys[kept[-1]] != key:
            kept.append(index)
    return kept


def _parse_lanes(value: str | None) -> int | None:
    return int(value) if value is not None and value.isdigit() else None


def build_graph(ways: list[DrivableWay]) -> GraphBuild:
    routable = [way for way in ways if is_routable_way(way)]

    # Pass 1: clean each way's vertex list and count how often every vertex is used.
    cleaned: list[tuple[DrivableWay, list[LonLat], list[str]]] = []
    usage: Counter[str] = Counter()
    duplicates_removed = 0
    collapsed = 0
    for way in routable:
        keys_all = [node_key(lon, lat) for lon, lat in way.coordinates]
        kept = _dedupe_consecutive(keys_all)
        duplicates_removed += len(keys_all) - len(kept)
        if len(kept) < 2:
            collapsed += 1
            continue
        coordinates = [way.coordinates[i] for i in kept]
        keys = [keys_all[i] for i in kept]
        cleaned.append((way, coordinates, keys))
        for key, count in Counter(keys).items():
            # A vertex visited twice by one way (a loop) is a junction with itself.
            usage[key] += 2 if count > 1 else 1
    split_vertices = {key for key, count in usage.items() if count >= 2}

    # Project every distinct vertex once, in a single batch.
    unique_keys = sorted(usage)
    first_seen: dict[str, LonLat] = {}
    for _, coordinates, keys in cleaned:
        for key, coordinate in zip(keys, coordinates, strict=True):
            first_seen.setdefault(key, coordinate)
    lons = np.array([first_seen[k][0] for k in unique_keys])
    lats = np.array([first_seen[k][1] for k in unique_keys])
    projected = project_points(lons, lats)
    xy_by_key = {key: projected[i] for i, key in enumerate(unique_keys)}

    graph: nx.MultiDiGraph = nx.MultiDiGraph()
    reversible: list[WayIssue] = []
    unrecognised: list[WayIssue] = []
    reversible_count = 0
    unrecognised_count = 0
    oneway_length_m: defaultdict[str, float] = defaultdict(float)
    speed_length_m: defaultdict[str, float] = defaultdict(float)
    default_length_m: defaultdict[str, float] = defaultdict(float)
    highway_edges: Counter[str] = Counter()
    total_road_m = 0.0

    def ensure_node(key: str) -> None:
        if key not in graph:
            lon, lat = first_seen[key]
            x, y = xy_by_key[key]
            graph.add_node(key, lon=lon, lat=lat, x_m=float(x), y_m=float(y))

    for way, _, keys in cleaned:
        try:
            oneway = resolve_oneway(way.properties, way.highway)
            speed = resolve_speed(way.properties, way.highway)
        except UnrecognisedTagError as error:
            unrecognised_count += 1
            if len(unrecognised) < _SAMPLE_LIMIT:
                unrecognised.append(WayIssue(source_line=way.line_number, reason=str(error)))
            continue
        if oneway.direction == "reversible":
            reversible_count += 1
            if len(reversible) < _SAMPLE_LIMIT:
                reversible.append(
                    WayIssue(
                        source_line=way.line_number, reason="oneway=reversible: direction varies"
                    )
                )
            continue

        cut_indices = [
            i for i, key in enumerate(keys) if i in (0, len(keys) - 1) or key in split_vertices
        ]
        lanes = _parse_lanes(tag(way.properties, "lanes"))
        name = tag(way.properties, "name")
        for segment_index, (start, end) in enumerate(itertools.pairwise(cut_indices)):
            segment_xy = np.array([xy_by_key[k] for k in keys[start : end + 1]])
            length_m = float(np.hypot(*np.diff(segment_xy, axis=0).T).sum())
            if length_m <= 0:
                continue
            geometry = shapely.LineString(segment_xy)
            u, v = keys[start], keys[end]
            ensure_node(u)
            ensure_node(v)
            attributes = {
                "length_m": length_m,
                "highway": way.highway,
                "speed_kmh": speed.speed_kmh,
                "speed_source": speed.source,
                "oneway_source": oneway.source,
                "lanes": lanes,
                "name": name,
                "junction": tag(way.properties, "junction"),
                "source_line": way.line_number,
                "segment_index": segment_index,
            }
            total_road_m += length_m
            directions: list[tuple[str, str, str, shapely.LineString, bool]] = []
            if oneway.direction in ("forward", "both"):
                directions.append((u, v, "+", geometry, False))
            if oneway.direction == "backward":
                directions.append((v, u, "-", shapely.reverse(geometry), False))
            elif oneway.direction == "both":
                directions.append((v, u, "-", shapely.reverse(geometry), True))
            for from_key, to_key, sign, edge_geometry, is_twin in directions:
                edge_id = f"W{way.line_number}.{segment_index}{sign}"
                graph.add_edge(
                    from_key,
                    to_key,
                    key=edge_id,
                    edge_id=edge_id,
                    base_edge_id=edge_id,
                    geometry=edge_geometry,
                    reverse_twin=is_twin,
                    **attributes,
                )
                highway_edges[way.highway] += 1
                oneway_length_m[oneway.source] += length_m
                speed_length_m[speed.source] += length_m
                if speed.source != "osm_maxspeed":
                    default_length_m[way.highway] += length_m

    pair_counts = Counter((u, v) for u, v, _ in graph.edges(keys=True))
    total_directed_m = sum(data["length_m"] for _, _, data in graph.edges(data=True))
    report = GraphBuildReport(
        limitations=[
            "no turn restrictions (the GeoJSON carries relations nowhere)",
            "no OSM node ids; node key is the 7-decimal coordinate",
            "connectivity only where ways share an exact vertex; bridges/tunnels without a "
            "shared vertex are not connected",
            "signals are not attached to the graph yet (T4)",
        ],
        drivable_ways_in=len(ways),
        routable_ways=len(routable),
        ways_collapsed_to_a_point=collapsed,
        duplicate_consecutive_vertices_removed=duplicates_removed,
        reversible_ways_excluded=reversible_count,
        reversible_way_samples=reversible,
        unrecognised_oneway_ways_excluded=unrecognised_count,
        unrecognised_oneway_samples=unrecognised,
        split_vertices=len(split_vertices),
        nodes=graph.number_of_nodes(),
        edges=graph.number_of_edges(),
        self_loop_edges=nx.number_of_selfloops(graph),
        node_pairs_with_parallel_edges=sum(1 for count in pair_counts.values() if count > 1),
        edges_by_highway=dict(highway_edges.most_common()),
        edge_length_km_by_oneway_source={
            k: v / 1000 for k, v in sorted(oneway_length_m.items(), key=lambda kv: -kv[1])
        },
        edge_length_km_by_speed_source={
            k: v / 1000 for k, v in sorted(speed_length_m.items(), key=lambda kv: -kv[1])
        },
        class_default_length_km_by_highway={
            k: v / 1000 for k, v in sorted(default_length_m.items(), key=lambda kv: -kv[1])
        },
        total_directed_length_km=total_directed_m / 1000,
        total_road_length_km=total_road_m / 1000,
    )
    logger.info("graph: %d nodes, %d edges", report.nodes, report.edges)
    return GraphBuild(graph=graph, report=report)
