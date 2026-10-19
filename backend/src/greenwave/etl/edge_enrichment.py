"""Geometry-level road attributes on the final network graph (after signal splitting).

``calming_count``: OSM traffic-calming points on an edge's vertices. A point counts on an edge when
it lies within ``on_vertex_m`` of an interior vertex or the end vertex, never the start vertex, so a
point at a split vertex counts once per direction (on the piece that arrives there). Both directions
of a two-way road count it: each drives over it.

``tram_track``: an edge whose length lies at least ``min_share`` within ``match_m`` of an OSM
``railway=tram`` line. All distances in metres (``METRIC_CRS``).
"""

import itertools
from collections import Counter, defaultdict

import networkx as nx
import numpy as np
import shapely
from numpy.typing import NDArray
from pydantic import BaseModel

from greenwave.etl.geo import project_points


class CalmingStats(BaseModel):
    points_total: int
    points_on_edges: int
    points_off_network: int


class TramStats(BaseModel):
    edges_marked: int
    km_marked: float
    match_m: float
    min_share: float


def annotate_calming(
    graph: nx.MultiDiGraph, points_xy: NDArray[np.float64], on_vertex_m: float = 0.5
) -> CalmingStats:
    """Set ``calming_count`` on every edge; ``points_xy`` is an ``(n, 2)`` metric array."""
    edges = list(graph.edges(keys=True, data=True))
    vertex_edge: list[int] = []
    vertex_xy: list[NDArray[np.float64]] = []
    for index, (*_, data) in enumerate(edges):
        coordinates = shapely.get_coordinates(data["geometry"])[1:]  # the start vertex never counts
        vertex_xy.append(coordinates)
        vertex_edge.extend([index] * len(coordinates))
    counts: Counter[int] = Counter()
    points_on_edges = 0
    if len(points_xy) and vertex_edge:
        tree = shapely.STRtree(shapely.points(np.concatenate(vertex_xy)))
        point_indices, vertex_indices = tree.query(
            shapely.points(points_xy), predicate="dwithin", distance=on_vertex_m
        )
        hits = {
            (int(p), vertex_edge[int(v)])
            for p, v in zip(point_indices, vertex_indices, strict=True)
        }
        counts.update(edge for _, edge in hits)
        points_on_edges = len({point for point, _ in hits})
    for index, (u, v, key, _) in enumerate(edges):
        graph.edges[u, v, key]["calming_count"] = counts.get(index, 0)
    return CalmingStats(
        points_total=len(points_xy),
        points_on_edges=points_on_edges,
        points_off_network=len(points_xy) - points_on_edges,
    )


def annotate_tram_tracks(
    graph: nx.MultiDiGraph,
    tram_lines_xy: list[NDArray[np.float64]],
    match_m: float,
    min_share: float,
) -> TramStats:
    """Set ``tram_track`` on every edge from the overlap share with buffered tram lines."""
    buffers = [shapely.LineString(xy).buffer(match_m) for xy in tram_lines_xy if len(xy) >= 2]
    tree = shapely.STRtree(buffers)
    marked = 0
    marked_m = 0.0
    for u, v, key, data in graph.edges(keys=True, data=True):
        geometry = data["geometry"]
        hits = tree.query(geometry, predicate="intersects")
        is_tram = False
        if len(hits) and geometry.length > 0:
            near = shapely.union_all([buffers[int(i)] for i in sorted(hits)])
            is_tram = geometry.intersection(near).length / geometry.length >= min_share
        graph.edges[u, v, key]["tram_track"] = is_tram
        if is_tram:
            marked += 1
            marked_m += data["length_m"]
    return TramStats(
        edges_marked=marked, km_marked=marked_m / 1000, match_m=match_m, min_share=min_share
    )


def project_lonlat_lines(lines: list[list[tuple[float, float]]]) -> list[NDArray[np.float64]]:
    """Project WGS84 vertex lists to ``(n, 2)`` metric arrays in one batch."""
    if not lines:
        return []
    flat = np.array([c for line in lines for c in line], dtype=np.float64)
    projected = project_points(flat[:, 0], flat[:, 1])
    bounds = np.cumsum([0, *(len(line) for line in lines)])
    return [projected[start:end] for start, end in itertools.pairwise(bounds)]


class RoadAttributesSection(BaseModel):
    """Top-level ``road_attributes`` ETL report section (network graph, directed km)."""

    calming: CalmingStats
    tram: TramStats
    total_directed_km: float
    km_by_bus_lane: dict[str, float]
    km_by_surface_class: dict[str, float]
    # Ways with a surface value outside both surface sets, most common first (at most 20).
    unknown_surface_values: dict[str, int]
    edges_by_lanes_per_direction: dict[str, int]


def road_attributes_section(
    graph: nx.MultiDiGraph,
    calming: CalmingStats,
    tram: TramStats,
    unknown_surface_values: dict[str, int],
) -> RoadAttributesSection:
    bus_m: defaultdict[str, float] = defaultdict(float)
    surface_m: defaultdict[str, float] = defaultdict(float)
    lanes: Counter[int | None] = Counter()
    total_m = 0.0
    for *_, data in graph.edges(data=True):
        length = data["length_m"]
        total_m += length
        bus_m[str(data["bus_lane"]).lower()] += length
        surface_m[data["surface_class"] or "unknown"] += length
        lanes[data["lanes_per_direction"]] += 1
    return RoadAttributesSection(
        calming=calming,
        tram=tram,
        total_directed_km=total_m / 1000,
        km_by_bus_lane={k: v / 1000 for k, v in sorted(bus_m.items())},
        km_by_surface_class={k: v / 1000 for k, v in sorted(surface_m.items())},
        unknown_surface_values=unknown_surface_values,
        edges_by_lanes_per_direction={
            "unknown" if k is None else str(k): n
            for k, n in sorted(lanes.items(), key=lambda kv: (kv[0] is None, kv[0] or 0))
        },
    )
