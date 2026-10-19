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
from greenwave.etl.road_attributes import bus_lane_directions, lanes_per_direction, surface_class
from greenwave.etl.road_rules import (
    OnewayResolution,
    SpeedResolution,
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
    # Ways whose `surface` value is in neither surface set (surface_class null), most common first.
    unknown_surface_values: dict[str, int]


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
    cleaned = _clean_ways(routable)
    builder = _GraphBuilder(_project_vertices(cleaned))
    for way, _, keys in cleaned.ways:
        builder.add_way(way, keys)
    report = _graph_report(ways, routable, cleaned, builder)
    logger.info("graph: %d nodes, %d edges", report.nodes, report.edges)
    return GraphBuild(graph=builder.graph, report=report)


@dataclass(frozen=True, slots=True)
class _CleanWays:
    """Routable ways with consecutive duplicate vertices removed, and vertex usage counts."""

    ways: list[tuple[DrivableWay, list[LonLat], list[str]]]
    usage: Counter[str]
    duplicates_removed: int
    collapsed: int

    @property
    def split_vertices(self) -> set[str]:
        return {key for key, count in self.usage.items() if count >= 2}


def _clean_ways(routable: list[DrivableWay]) -> _CleanWays:
    """Clean each way's vertex list and count how often every vertex is used."""
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
    return _CleanWays(cleaned, usage, duplicates_removed, collapsed)


@dataclass(frozen=True, slots=True)
class _Vertices:
    first_seen: dict[str, LonLat]
    xy_by_key: dict[str, np.ndarray]
    split: set[str]


def _project_vertices(cleaned: _CleanWays) -> _Vertices:
    """Project every distinct vertex once, in a single batch."""
    unique_keys = sorted(cleaned.usage)
    first_seen: dict[str, LonLat] = {}
    for _, coordinates, keys in cleaned.ways:
        for key, coordinate in zip(keys, coordinates, strict=True):
            first_seen.setdefault(key, coordinate)
    lons = np.array([first_seen[k][0] for k in unique_keys])
    lats = np.array([first_seen[k][1] for k in unique_keys])
    projected = project_points(lons, lats)
    xy_by_key = {key: projected[i] for i, key in enumerate(unique_keys)}
    return _Vertices(first_seen, xy_by_key, cleaned.split_vertices)


@dataclass(frozen=True, slots=True)
class _WayRules:
    """The resolved direction, speed and tags every segment of one way shares."""

    oneway: OnewayResolution
    speed: SpeedResolution
    lanes: int | None
    name: str | None
    # (along the digitised direction, against it)
    bus_lane: tuple[bool, bool]
    lanes_per_direction: tuple[int | None, int | None]
    surface_class: str | None


class _GraphBuilder:
    """Adds each way's directed edges and keeps the statistics the report needs."""

    def __init__(self, vertices: _Vertices) -> None:
        self.graph: nx.MultiDiGraph = nx.MultiDiGraph()
        self.vertices = vertices
        self.reversible: list[WayIssue] = []
        self.unrecognised: list[WayIssue] = []
        self.reversible_count = 0
        self.unrecognised_count = 0
        self.oneway_length_m: defaultdict[str, float] = defaultdict(float)
        self.speed_length_m: defaultdict[str, float] = defaultdict(float)
        self.default_length_m: defaultdict[str, float] = defaultdict(float)
        self.highway_edges: Counter[str] = Counter()
        self.total_road_m = 0.0
        self.unknown_surface_values: Counter[str] = Counter()

    def add_way(self, way: DrivableWay, keys: list[str]) -> None:
        try:
            oneway = resolve_oneway(way.properties, way.highway)
            speed = resolve_speed(way.properties, way.highway)
        except UnrecognisedTagError as error:
            self.unrecognised_count += 1
            if len(self.unrecognised) < _SAMPLE_LIMIT:
                self.unrecognised.append(WayIssue(source_line=way.line_number, reason=str(error)))
            return
        if oneway.direction == "reversible":
            self.reversible_count += 1
            if len(self.reversible) < _SAMPLE_LIMIT:
                self.reversible.append(
                    WayIssue(
                        source_line=way.line_number, reason="oneway=reversible: direction varies"
                    )
                )
            return

        cut_indices = [
            i for i, key in enumerate(keys) if i in (0, len(keys) - 1) or key in self.vertices.split
        ]
        surface = surface_class(way.properties)
        surface_tag = tag(way.properties, "surface")
        if surface is None and surface_tag is not None:
            self.unknown_surface_values[surface_tag] += 1
        rules = _WayRules(
            oneway=oneway,
            speed=speed,
            lanes=_parse_lanes(tag(way.properties, "lanes")),
            name=tag(way.properties, "name"),
            bus_lane=bus_lane_directions(way.properties),
            lanes_per_direction=lanes_per_direction(
                way.properties, oneway=oneway.direction != "both"
            ),
            surface_class=surface,
        )
        for segment_index, (start, end) in enumerate(itertools.pairwise(cut_indices)):
            self._add_segment(way, segment_index, keys[start : end + 1], rules)

    def _add_segment(
        self, way: DrivableWay, segment_index: int, segment_keys: list[str], rules: _WayRules
    ) -> None:
        segment_xy = np.array([self.vertices.xy_by_key[k] for k in segment_keys])
        length_m = float(np.hypot(*np.diff(segment_xy, axis=0).T).sum())
        if length_m <= 0:
            return
        geometry = shapely.LineString(segment_xy)
        u, v = segment_keys[0], segment_keys[-1]
        self._ensure_node(u)
        self._ensure_node(v)
        attributes = {
            "length_m": length_m,
            "highway": way.highway,
            "speed_kmh": rules.speed.speed_kmh,
            "speed_source": rules.speed.source,
            "oneway_source": rules.oneway.source,
            "lanes": rules.lanes,
            "name": rules.name,
            "surface_class": rules.surface_class,
            "junction": tag(way.properties, "junction"),
            "source_line": way.line_number,
            "segment_index": segment_index,
        }
        self.total_road_m += length_m
        lanes_along, lanes_against = rules.lanes_per_direction
        along: dict[str, object] = {
            "bus_lane": rules.bus_lane[0],
            "lanes_per_direction": lanes_along,
        }
        against: dict[str, object] = {
            "bus_lane": rules.bus_lane[1],
            # A backward one-way has its `lanes` total in the "along" slot (one-way rule).
            "lanes_per_direction": lanes_against
            if lanes_against is not None or rules.oneway.direction == "both"
            else lanes_along,
        }
        directions: list[tuple[str, str, str, shapely.LineString, bool, dict[str, object]]] = []
        if rules.oneway.direction in ("forward", "both"):
            directions.append((u, v, "+", geometry, False, along))
        if rules.oneway.direction == "backward":
            directions.append((v, u, "-", shapely.reverse(geometry), False, against))
        elif rules.oneway.direction == "both":
            directions.append((v, u, "-", shapely.reverse(geometry), True, against))
        for from_key, to_key, sign, edge_geometry, is_twin, directional in directions:
            edge_id = f"W{way.line_number}.{segment_index}{sign}"
            self.graph.add_edge(
                from_key,
                to_key,
                key=edge_id,
                edge_id=edge_id,
                base_edge_id=edge_id,
                geometry=edge_geometry,
                reverse_twin=is_twin,
                **attributes,
                **directional,
            )
            self.highway_edges[way.highway] += 1
            self.oneway_length_m[rules.oneway.source] += length_m
            self.speed_length_m[rules.speed.source] += length_m
            if rules.speed.source != "osm_maxspeed":
                self.default_length_m[way.highway] += length_m

    def _ensure_node(self, key: str) -> None:
        if key not in self.graph:
            lon, lat = self.vertices.first_seen[key]
            x, y = self.vertices.xy_by_key[key]
            self.graph.add_node(key, lon=lon, lat=lat, x_m=float(x), y_m=float(y))


def _km_by_length(lengths_m: dict[str, float]) -> dict[str, float]:
    return {k: v / 1000 for k, v in sorted(lengths_m.items(), key=lambda kv: -kv[1])}


def _graph_report(
    ways: list[DrivableWay],
    routable: list[DrivableWay],
    cleaned: _CleanWays,
    builder: _GraphBuilder,
) -> GraphBuildReport:
    graph = builder.graph
    pair_counts = Counter((u, v) for u, v, _ in graph.edges(keys=True))
    total_directed_m = sum(data["length_m"] for _, _, data in graph.edges(data=True))
    return GraphBuildReport(
        limitations=[
            "no turn restrictions (the GeoJSON carries relations nowhere)",
            "no OSM node ids; node key is the 7-decimal coordinate",
            "connectivity only where ways share an exact vertex; bridges/tunnels without a "
            "shared vertex are not connected",
            "signals are not attached to the graph yet (T4)",
        ],
        drivable_ways_in=len(ways),
        routable_ways=len(routable),
        ways_collapsed_to_a_point=cleaned.collapsed,
        duplicate_consecutive_vertices_removed=cleaned.duplicates_removed,
        reversible_ways_excluded=builder.reversible_count,
        reversible_way_samples=builder.reversible,
        unrecognised_oneway_ways_excluded=builder.unrecognised_count,
        unrecognised_oneway_samples=builder.unrecognised,
        split_vertices=len(builder.vertices.split),
        nodes=graph.number_of_nodes(),
        edges=graph.number_of_edges(),
        self_loop_edges=nx.number_of_selfloops(graph),
        node_pairs_with_parallel_edges=sum(1 for count in pair_counts.values() if count > 1),
        edges_by_highway=dict(builder.highway_edges.most_common()),
        edge_length_km_by_oneway_source=_km_by_length(builder.oneway_length_m),
        edge_length_km_by_speed_source=_km_by_length(builder.speed_length_m),
        class_default_length_km_by_highway=_km_by_length(builder.default_length_m),
        total_directed_length_km=total_directed_m / 1000,
        total_road_length_km=builder.total_road_m / 1000,
        unknown_surface_values=dict(builder.unknown_surface_values.most_common(_SAMPLE_LIMIT)),
    )
