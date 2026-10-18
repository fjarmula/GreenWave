"""T1 signal statistics: tag variants, position on the road graph, clustering, crossings."""

import statistics
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import shapely
from numpy.typing import NDArray

from greenwave.etl.clustering import single_linkage_labels
from greenwave.etl.config import CLUSTER_PROBE_RADII_METERS, NON_BLOCKING_SIGNAL_TAGS
from greenwave.etl.geo import project_points
from greenwave.etl.profile_models import (
    ClusteringProfile,
    CrossingsProfile,
    DistanceSummary,
    ProbeResult,
    ProbeSignal,
    SignalsProfile,
)
from greenwave.etl.profile_osm import (
    DrivableWay,
    LonLat,
    OsmScan,
    PointFeature,
    crossing_kind,
    tag,
)
from greenwave.etl.profile_roads import RoadAnalysis

_PROBE_SEARCH_RADIUS_METERS = 100.0
_ABSENT = "<absent>"


def cluster_profile(xy: NDArray[np.float64], radius_meters: float) -> ClusteringProfile:
    labels = single_linkage_labels(xy, radius_meters)
    sizes = np.bincount(labels) if len(labels) else np.empty(0, dtype=np.int64)
    histogram: Counter[str] = Counter()
    for size in sizes.tolist():
        histogram[str(size) if size < 5 else "5+"] += 1
    max_diameter = 0.0
    over_radius = 0
    for label in np.flatnonzero(sizes > 1).tolist():
        members = xy[labels == label]
        diffs = members[:, None, :] - members[None, :, :]
        diameter = float(np.sqrt((diffs**2).sum(axis=2)).max())
        max_diameter = max(max_diameter, diameter)
        over_radius += diameter > radius_meters
    return ClusteringProfile(
        radius_m=radius_meters,
        nodes=len(xy),
        clusters=len(sizes),
        size_histogram=dict(sorted(histogram.items())),
        max_size=int(sizes.max()) if len(sizes) else 0,
        max_diameter_m=max_diameter,
        clusters_with_diameter_over_radius=over_radius,
    )


def _distance_summary(distances: Sequence[float]) -> DistanceSummary:
    return DistanceSummary(
        count=len(distances),
        min_m=min(distances) if distances else None,
        median_m=statistics.median(distances) if distances else None,
        max_m=max(distances) if distances else None,
        within_5m=sum(d <= 5 for d in distances),
        within_10m=sum(d <= 10 for d in distances),
        within_25m=sum(d <= 25 for d in distances),
    )


def _vertex_position(coordinate: LonLat, roads: RoadAnalysis) -> str:
    ways_here = roads.topology.ways_per_vertex.get(coordinate, 0)
    if ways_here >= 2:
        return "junction"
    if ways_here == 1:
        return "way_endpoint" if coordinate in roads.topology.endpoints else "interior"
    return "off_network"


def _count_within(
    queries_xy: NDArray[np.float64], targets_xy: NDArray[np.float64], radius_meters: float
) -> int:
    if len(queries_xy) == 0 or len(targets_xy) == 0:
        return 0
    tree = shapely.STRtree(shapely.points(targets_xy))
    pairs = tree.query(shapely.points(queries_xy), predicate="dwithin", distance=radius_meters)
    return len(np.unique(pairs[0]))


@dataclass(frozen=True, slots=True)
class _ProbeContext:
    """What every junction probe searches: the ways, the signals and their cluster labels."""

    ways: list[DrivableWay]
    signals: list[PointFeature]
    signals_xy: NDArray[np.float64]
    labels_by_radius: dict[float, NDArray[np.int64]]


def _probe_vertices(
    ways: list[DrivableWay],
    name_fragments_a: tuple[str, ...],
    name_fragments_b: tuple[str, ...] | None,
) -> set[LonLat]:
    def vertices_of(fragments: tuple[str, ...]) -> set[LonLat]:
        found: set[LonLat] = set()
        for way in ways:
            name = (tag(way.properties, "name") or "").casefold()
            if any(fragment.casefold() in name for fragment in fragments):
                found.update(way.coordinates)
        return found

    vertices = vertices_of(name_fragments_a)
    if name_fragments_b is not None:
        vertices &= vertices_of(name_fragments_b)
    return vertices


def _probe(
    label: str,
    name_fragments_a: tuple[str, ...],
    name_fragments_b: tuple[str, ...] | None,
    context: _ProbeContext,
) -> ProbeResult:
    """Locate a known junction from street names, then list the signal nodes around it."""
    vertices = _probe_vertices(context.ways, name_fragments_a, name_fragments_b)
    if not vertices:
        return ProbeResult(
            label=label, found=False, center_lon=None, center_lat=None, signals_within_100m=[]
        )
    center_lon = float(np.mean([lon for lon, _ in vertices]))
    center_lat = float(np.mean([lat for _, lat in vertices]))
    center_xy = project_points(np.array([center_lon]), np.array([center_lat]))[0]
    distances = np.hypot(*(context.signals_xy - center_xy).T)
    nearby = []
    for index in np.flatnonzero(distances <= _PROBE_SEARCH_RADIUS_METERS).tolist():
        signal = context.signals[index]
        cluster_sizes = {
            f"{radius:g}": int((radius_labels == radius_labels[index]).sum())
            for radius, radius_labels in context.labels_by_radius.items()
        }
        nearby.append(
            ProbeSignal(
                lon=signal.lon,
                lat=signal.lat,
                distance_to_center_m=float(distances[index]),
                tag_variant=tag(signal.properties, "traffic_signals") or _ABSENT,
                direction=tag(signal.properties, "traffic_signals:direction"),
                cluster_size_by_radius_m=cluster_sizes,
            )
        )
    nearby.sort(key=lambda item: item.distance_to_center_m)
    return ProbeResult(
        label=label,
        found=True,
        center_lon=center_lon,
        center_lat=center_lat,
        signals_within_100m=nearby,
    )


def _off_network_distances(
    signals_xy: NDArray[np.float64], positions: list[str], roads: RoadAnalysis
) -> list[float]:
    """Distance from each off-network signal to its nearest drivable way."""
    off_network = [i for i, position in enumerate(positions) if position == "off_network"]
    if not (off_network and len(roads.projected_lines)):
        return []
    tree = shapely.STRtree(roads.projected_lines)
    _, distances = tree.query_nearest(
        shapely.points(signals_xy[off_network]), return_distance=True, all_matches=False
    )
    return [float(d) for d in distances]


def _crossings_profile(
    scan: OsmScan, roads: RoadAnalysis, signals_xy: NDArray[np.float64], positions: list[str]
) -> CrossingsProfile:
    crossings = scan.signalised_crossings
    crossings_xy = project_points(
        np.array([c.lon for c in crossings]), np.array([c.lat for c in crossings])
    )
    junction_mask = np.array([p == "junction" for p in positions], dtype=np.bool_)
    return CrossingsProfile(
        total=len(crossings),
        by_kind=dict(Counter(crossing_kind(c) for c in crossings).most_common()),
        signal_nodes_also_tagged_crossing=scan.signal_nodes_also_tagged_crossing,
        on_drivable_vertex=sum(
            roads.topology.ways_per_vertex.get((c.lon, c.lat), 0) > 0 for c in crossings
        ),
        within_radius_of_any_signal={
            f"{r:g}": _count_within(crossings_xy, signals_xy, r) for r in CLUSTER_PROBE_RADII_METERS
        },
        within_radius_of_junction_signal={
            f"{r:g}": _count_within(crossings_xy, signals_xy[junction_mask], r)
            for r in CLUSTER_PROBE_RADII_METERS
        },
    )


def analyse_signals(
    scan: OsmScan, roads: RoadAnalysis, city_outline: shapely.Geometry
) -> SignalsProfile:
    signals = scan.signal_nodes
    signals_xy = project_points(
        np.array([s.lon for s in signals]), np.array([s.lat for s in signals])
    )
    positions = [_vertex_position((s.lon, s.lat), roads) for s in signals]
    off_distances = _off_network_distances(signals_xy, positions, roads)
    non_blocking = np.array(
        [tag(s.properties, "traffic_signals") in NON_BLOCKING_SIGNAL_TAGS for s in signals],
        dtype=np.bool_,
    )
    labels_by_radius = {
        radius: single_linkage_labels(signals_xy, radius) for radius in CLUSTER_PROBE_RADII_METERS
    }
    crossings_profile = _crossings_profile(scan, roads, signals_xy, positions)
    inside = (
        shapely.contains_xy(city_outline, signals_xy[:, 0], signals_xy[:, 1])
        if len(signals_xy)
        else np.empty(0, dtype=np.bool_)
    )
    context = _ProbeContext(scan.drivable_ways, signals, signals_xy, labels_by_radius)
    probes = [
        _probe("Rondo Mogilskie", ("Rondo Mogilskie",), None, context),
        _probe("Czarnowiejska x Mickiewicza", ("Czarnowiejska",), ("Mickiewicza",), context),
    ]

    return SignalsProfile(
        signal_nodes=len(signals),
        signal_features_not_points=scan.signal_features_not_points,
        tag_variants=dict(
            Counter(tag(s.properties, "traffic_signals") or _ABSENT for s in signals).most_common()
        ),
        with_direction=sum("traffic_signals:direction" in s.properties for s in signals),
        direction_values=dict(
            Counter(
                tag(s.properties, "traffic_signals:direction") or _ABSENT
                for s in signals
                if "traffic_signals:direction" in s.properties
            ).most_common()
        ),
        with_name=sum("name" in s.properties for s in signals),
        with_ref=sum("ref" in s.properties for s in signals),
        with_check_date=sum("check_date" in s.properties for s in signals),
        vertex_position=dict(Counter(positions).most_common()),
        on_drivable_vertex=sum(p != "off_network" for p in positions),
        off_network_nearest_way=_distance_summary(off_distances),
        outside_city_proxy=int((~inside).sum()),
        clustering_all=[cluster_profile(signals_xy, r) for r in CLUSTER_PROBE_RADII_METERS],
        clustering_excluding_non_blocking=[
            cluster_profile(signals_xy[~non_blocking], r) for r in CLUSTER_PROBE_RADII_METERS
        ],
        crossings=crossings_profile,
        probes=probes,
    )
