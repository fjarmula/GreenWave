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
    way_by_line = {way.line_number: way for way in ways}
    ends: list[tuple[str, int]] = []  # (node key, way source line)
    for way in ways:
        for lon, lat in (way.coordinates[0], way.coordinates[-1]):
            key = node_key(lon, lat)
            if key in graph:
                ends.append((key, way.line_number))
    ends = sorted(set(ends))

    lines_at: dict[str, set[int]] = defaultdict(set)
    for u, v, data in graph.edges(data=True):
        lines_at[u].add(data["source_line"])
        lines_at[v].add(data["source_line"])

    node_keys = sorted(graph.nodes)
    node_xy = np.array(
        [[graph.nodes[k]["x_m"], graph.nodes[k]["y_m"]] for k in node_keys], dtype=np.float64
    ).reshape(-1, 2)
    node_tree = shapely.STRtree(shapely.points(node_xy))
    canonical = [(u, v, data) for u, v, data in graph.edges(data=True) if not data["reverse_twin"]]
    edge_tree = shapely.STRtree([data["geometry"] for *_, data in canonical])

    rows: list[dict[str, object]] = []
    seen_node_pairs: set[tuple[str, str]] = set()
    for key, line in ends:
        point = shapely.Point(graph.nodes[key]["x_m"], graph.nodes[key]["y_m"])
        # Other nodes close by: report when they belong to a different way and are not linked.
        for index in node_tree.query(
            point, predicate="dwithin", distance=tolerance_meters
        ).tolist():
            other = node_keys[index]
            if other == key or lines_at[other] <= {line}:
                continue
            if graph.has_edge(key, other) or graph.has_edge(other, key):
                continue
            pair = (key, other) if key < other else (other, key)
            if pair in seen_node_pairs:
                continue
            seen_node_pairs.add(pair)
            other_line = min(lines_at[other] - {line})
            rows.append(
                _row(
                    graph,
                    KIND_END_TO_NODE,
                    key,
                    line,
                    way_by_line,
                    other_line,
                    float(point.distance(shapely.Point(*node_xy[index]))),
                    other_node=other,
                )
            )
        # Bodies of other ways: the end is near an interior point of an edge that does not end here.
        for index in edge_tree.query(
            point, predicate="dwithin", distance=tolerance_meters
        ).tolist():
            u, v, data = canonical[index]
            if data["source_line"] == line or key in (u, v):
                continue
            geometry = data["geometry"]
            along = float(shapely.line_locate_point(geometry, point))
            if along <= _END_EPSILON_METERS or geometry.length - along <= _END_EPSILON_METERS:
                continue  # near an end of that edge: covered by the node check above
            nearest = geometry.interpolate(along)
            rows.append(
                _row(
                    graph,
                    KIND_END_TO_SEGMENT,
                    key,
                    line,
                    way_by_line,
                    data["source_line"],
                    float(point.distance(geometry)),
                    other_xy=(nearest.x, nearest.y),
                )
            )

    frame = pl.DataFrame(rows, schema=_COLUMNS).sort("distance_m", "way_line", "other_way_line")
    kinds = dict(frame["kind"].value_counts().iter_rows()) if frame.height else {}
    report = NearMissReport(
        tolerance_m=tolerance_meters,
        way_ends_checked=len(ends),
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
    return frame, report


def _row(
    graph: nx.MultiDiGraph,
    kind: str,
    key: str,
    line: int,
    way_by_line: dict[int, DrivableWay],
    other_line: int,
    distance: float,
    other_node: str | None = None,
    other_xy: tuple[float, float] | None = None,
) -> dict[str, object]:
    if other_node is not None:
        other_lon, other_lat = graph.nodes[other_node]["lon"], graph.nodes[other_node]["lat"]
    else:
        assert other_xy is not None
        other_lon, other_lat = (float(c) for c in unproject_points(np.array([other_xy]))[0])
    way, other_way = way_by_line[line], way_by_line[other_line]
    return {
        "kind": kind,
        "distance_m": distance,
        "lon": graph.nodes[key]["lon"],
        "lat": graph.nodes[key]["lat"],
        "other_lon": other_lon,
        "other_lat": other_lat,
        "way_line": line,
        "other_way_line": other_line,
        "street": way.properties.get("name")
        if isinstance(way.properties.get("name"), str)
        else None,
        "other_street": (
            other_way.properties.get("name")
            if isinstance(other_way.properties.get("name"), str)
            else None
        ),
        "highway": way.highway,
        "other_highway": other_way.highway,
    }


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
