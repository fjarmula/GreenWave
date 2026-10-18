"""T4 near-miss report: way ends close to another way's end or body but sharing no vertex.

The graph connects ways only at exactly shared vertices, so a way that stops 1 m short of another
silently stays disconnected. This reports such cases; it never fixes them.
"""

from collections import defaultdict

import networkx as nx
import numpy as np
import polars as pl
import shapely
from pydantic import BaseModel

from greenwave.etl.config import NEAR_MISS_TOLERANCE_METERS
from greenwave.etl.geo import unproject_points
from greenwave.etl.graph import node_key
from greenwave.etl.profile_osm import DrivableWay

KIND_END_TO_NODE = "end_to_node"
KIND_END_TO_SEGMENT = "end_to_segment"
_END_EPSILON_METERS = 0.01
_LISTED = 100
MAIN_ROAD_CLASSES = [
    "motorway", "trunk", "primary", "secondary", "tertiary",
    "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
]  # fmt: skip
_DISTANCE_EDGES = (0.1, 0.25, 0.5, 1.0)

_COLUMNS = {
    "kind": pl.String,
    "distance_m": pl.Float64,
    "lon": pl.Float64,
    "lat": pl.Float64,
    "other_lon": pl.Float64,
    "other_lat": pl.Float64,
    "way_line": pl.Int64,
    "other_way_line": pl.Int64,
    "street": pl.String,
    "other_street": pl.String,
    "highway": pl.String,
    "other_highway": pl.String,
}


class NearMissReport(BaseModel):
    tolerance_m: float
    way_ends_checked: int
    near_misses: int
    by_kind: dict[str, int]
    by_distance_m: dict[str, int]
    involving_a_road_of_class_tertiary_or_above: int
    closest: list[dict[str, object]]


def find_near_misses(
    graph: nx.MultiDiGraph,
    ways: list[DrivableWay],
    tolerance_meters: float = NEAR_MISS_TOLERANCE_METERS,
) -> tuple[pl.DataFrame, NearMissReport]:
    """Find way ends within ``tolerance_meters`` of a different way that share no vertex with it."""
    if tolerance_meters <= 0:
        raise ValueError("near-miss tolerance must be positive (metres)")
    finder = _NearMissFinder(graph, ways, tolerance_meters)
    frame = pl.DataFrame(finder.rows(), schema=_COLUMNS).sort(
        "distance_m", "way_line", "other_way_line"
    )
    return frame, _near_miss_report(frame, len(finder.ends), tolerance_meters)


class _NearMissFinder:
    """Spatial indexes over the graph's nodes and canonical edges, queried at every way end."""

    def __init__(
        self, graph: nx.MultiDiGraph, ways: list[DrivableWay], tolerance_meters: float
    ) -> None:
        self.graph = graph
        self.tolerance_meters = tolerance_meters
        self.way_by_line = {way.line_number: way for way in ways}
        ends: list[tuple[str, int]] = []  # (node key, way source line)
        for way in ways:
            for lon, lat in (way.coordinates[0], way.coordinates[-1]):
                key = node_key(lon, lat)
                if key in graph:
                    ends.append((key, way.line_number))
        self.ends = sorted(set(ends))
        self.lines_at: dict[str, set[int]] = defaultdict(set)
        for u, v, data in graph.edges(data=True):
            self.lines_at[u].add(data["source_line"])
            self.lines_at[v].add(data["source_line"])
        self.node_keys = sorted(graph.nodes)
        self.node_xy = np.array(
            [[graph.nodes[k]["x_m"], graph.nodes[k]["y_m"]] for k in self.node_keys],
            dtype=np.float64,
        ).reshape(-1, 2)
        self.node_tree = shapely.STRtree(shapely.points(self.node_xy))
        self.canonical = [
            (u, v, data) for u, v, data in graph.edges(data=True) if not data["reverse_twin"]
        ]
        self.edge_tree = shapely.STRtree([data["geometry"] for *_, data in self.canonical])
        self._seen_node_pairs: set[tuple[str, str]] = set()

    def rows(self) -> list[dict[str, object]]:
        rows: list[dict[str, object]] = []
        for key, line in self.ends:
            point = shapely.Point(self.graph.nodes[key]["x_m"], self.graph.nodes[key]["y_m"])
            rows += self._node_rows(key, line, point)
            rows += self._segment_rows(key, line, point)
        return rows

    def _node_rows(self, key: str, line: int, point: shapely.Point) -> list[dict[str, object]]:
        """Other nodes close by that belong to a different way and are not linked to this end."""
        rows: list[dict[str, object]] = []
        nearby = self.node_tree.query(point, predicate="dwithin", distance=self.tolerance_meters)
        for index in nearby.tolist():
            other = self.node_keys[index]
            if other == key or self.lines_at[other] <= {line}:
                continue
            if self.graph.has_edge(key, other) or self.graph.has_edge(other, key):
                continue
            pair = (key, other) if key < other else (other, key)
            if pair in self._seen_node_pairs:
                continue
            self._seen_node_pairs.add(pair)
            rows.append(
                self._row(
                    KIND_END_TO_NODE,
                    key,
                    line,
                    min(self.lines_at[other] - {line}),
                    float(point.distance(shapely.Point(*self.node_xy[index]))),
                    other_node=other,
                )
            )
        return rows

    def _segment_rows(self, key: str, line: int, point: shapely.Point) -> list[dict[str, object]]:
        """Interior points of other ways' edges that do not end at this end."""
        rows: list[dict[str, object]] = []
        nearby = self.edge_tree.query(point, predicate="dwithin", distance=self.tolerance_meters)
        for index in nearby.tolist():
            u, v, data = self.canonical[index]
            if data["source_line"] == line or key in (u, v):
                continue
            geometry = data["geometry"]
            along = float(shapely.line_locate_point(geometry, point))
            if along <= _END_EPSILON_METERS or geometry.length - along <= _END_EPSILON_METERS:
                continue  # near an end of that edge: covered by the node check
            nearest = geometry.interpolate(along)
            rows.append(
                self._row(
                    KIND_END_TO_SEGMENT,
                    key,
                    line,
                    data["source_line"],
                    float(point.distance(geometry)),
                    other_xy=(nearest.x, nearest.y),
                )
            )
        return rows

    def _row(
        self,
        kind: str,
        key: str,
        line: int,
        other_line: int,
        distance: float,
        other_node: str | None = None,
        other_xy: tuple[float, float] | None = None,
    ) -> dict[str, object]:
        graph = self.graph
        if other_node is not None:
            other_lon, other_lat = graph.nodes[other_node]["lon"], graph.nodes[other_node]["lat"]
        else:
            assert other_xy is not None
            other_lon, other_lat = (float(c) for c in unproject_points(np.array([other_xy]))[0])
        way, other_way = self.way_by_line[line], self.way_by_line[other_line]
        return {
            "kind": kind,
            "distance_m": distance,
            "lon": graph.nodes[key]["lon"],
            "lat": graph.nodes[key]["lat"],
            "other_lon": other_lon,
            "other_lat": other_lat,
            "way_line": line,
            "other_way_line": other_line,
            "street": _street(way),
            "other_street": _street(other_way),
            "highway": way.highway,
            "other_highway": other_way.highway,
        }


def _street(way: DrivableWay) -> str | None:
    name = way.properties.get("name")
    return name if isinstance(name, str) else None


def _near_miss_report(frame: pl.DataFrame, ends_checked: int, tolerance: float) -> NearMissReport:
    kinds = dict(frame["kind"].value_counts().iter_rows()) if frame.height else {}
    return NearMissReport(
        tolerance_m=tolerance,
        way_ends_checked=ends_checked,
        near_misses=frame.height,
        by_kind=dict(sorted(kinds.items())),
        by_distance_m=_distance_buckets(frame),
        involving_a_road_of_class_tertiary_or_above=int(
            frame.filter(
                pl.col("highway").is_in(MAIN_ROAD_CLASSES)
                | pl.col("other_highway").is_in(MAIN_ROAD_CLASSES)
            ).height
        ),
        closest=frame.head(_LISTED).to_dicts(),
    )


def _distance_buckets(frame: pl.DataFrame) -> dict[str, int]:
    distances = frame["distance_m"].to_list()
    buckets: dict[str, int] = {}
    lower = 0.0
    for upper in _DISTANCE_EDGES:
        buckets[f"<= {upper:g}"] = sum(
            lower < d <= upper or (lower == 0.0 and d == 0.0) for d in distances
        )
        lower = upper
    buckets[f"> {lower:g}"] = sum(d > lower for d in distances)
    return buckets
