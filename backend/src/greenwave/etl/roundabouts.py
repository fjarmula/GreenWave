"""Roundabout inventory, a report only (``run_etl.py roundabouts``): how many rings, how many carry
signals, and the intersection counts under the two conventions that were compared before decision
8 (a ring is one intersection) was taken. T4 itself builds rings in ``junctions.py`` and applies
the decision; this inventory is estimated from provisional clusters, so its counts are not the
final ones.

Rings are built from ``junction=roundabout|circular`` ways joined by shared vertices; entry arms are
the other routable ways touching a ring vertex.
"""

from collections import Counter
from dataclasses import dataclass

import numpy as np
import polars as pl
import shapely
from numpy.typing import NDArray
from pydantic import BaseModel

from greenwave.etl.config import (
    IMPLIED_ONEWAY_JUNCTION_VALUES,
    ROUNDABOUT_SIGNAL_ASSOCIATION_METERS,
)
from greenwave.etl.geo import project_lines
from greenwave.etl.profile_osm import DrivableWay, LonLat, tag
from greenwave.etl.road_rules import is_routable_way


class RoundaboutRing(BaseModel):
    ring_id: int
    name: str | None
    centre_lon: float
    centre_lat: float
    ring_ways: int
    entry_arm_ways: int
    contact_vertices: int
    signal_nodes_near_ring: int
    provisional_clusters_touching: int


class RoundaboutsSection(BaseModel):
    association_distance_meters: float
    rings_total: int
    rings_with_signals: int
    rings_without_signals: int
    signal_nodes_at_rings: int
    counted_signal_nodes_total: int
    signal_nodes_per_signalised_ring: dict[str, int]
    entry_arms_per_ring: dict[str, int]
    provisional_clusters_total: int
    provisional_clusters_touching_rings: int
    intersections_if_each_ring_is_one: int
    intersections_if_ring_clusters_stay_separate: int
    # Ways named "Rondo ..." that carry no junction=roundabout|circular tag, so ring detection
    # by tag misses them (e.g. Rondo Mogilskie). T4 needs another rule for these.
    named_rondos_without_ring_tag: list[str]
    signalised_rings: list[RoundaboutRing]


@dataclass(slots=True)
class _Ring:
    ways: list[DrivableWay]
    vertices: set[LonLat]


def _group_rings(ring_ways: list[DrivableWay]) -> list[_Ring]:
    parent = list(range(len(ring_ways)))

    def find(item: int) -> int:
        while parent[item] != item:
            parent[item] = parent[parent[item]]
            item = parent[item]
        return item

    owner: dict[LonLat, int] = {}
    for index, way in enumerate(ring_ways):
        for vertex in way.coordinates:
            if vertex in owner:
                root_a, root_b = find(owner[vertex]), find(index)
                if root_a != root_b:
                    parent[max(root_a, root_b)] = min(root_a, root_b)
            else:
                owner[vertex] = index
    grouped: dict[int, _Ring] = {}
    for index, way in enumerate(ring_ways):
        ring = grouped.setdefault(find(index), _Ring([], set()))
        ring.ways.append(way)
        ring.vertices.update(way.coordinates)
    return [grouped[key] for key in sorted(grouped)]


def _histogram(values: list[int], cap: int = 5) -> dict[str, int]:
    counts: Counter[str] = Counter(str(v) if v < cap else f"{cap}+" for v in values)
    return dict(sorted(counts.items(), key=lambda item: int(item[0].rstrip("+"))))


def _nearest_ring(
    rings: list[_Ring], signal_xy: NDArray[np.float64], association_distance_meters: float
) -> NDArray[np.int64]:
    """Index of the ring each signal is associated with, or -1 when none is within reach."""
    ring_geometries = [
        shapely.union_all(project_lines([shapely.LineString(w.coordinates) for w in ring.ways]))
        for ring in rings
    ]
    nearest_ring = np.full(len(signal_xy), -1, dtype=np.int64)
    if rings and len(signal_xy):
        tree = shapely.STRtree(np.array(ring_geometries, dtype=object))
        indices, _ = tree.query_nearest(
            shapely.points(signal_xy),
            max_distance=association_distance_meters,
            return_distance=True,
            all_matches=False,
        )
        nearest_ring[indices[0]] = indices[1]
    return nearest_ring


def _ring_name(ring: _Ring) -> str | None:
    names = Counter(tag(w.properties, "name") for w in ring.ways if tag(w.properties, "name"))
    return names.most_common(1)[0][0] if names else None


def _untagged_rondos(arms_pool: list[DrivableWay]) -> list[str]:
    return sorted(
        {
            name
            for way in arms_pool
            if (name := tag(way.properties, "name")) and name.casefold().startswith("rondo ")
        }
    )


def analyse_roundabouts(
    ways: list[DrivableWay],
    signals: pl.DataFrame,
    association_distance_meters: float = ROUNDABOUT_SIGNAL_ASSOCIATION_METERS,
) -> RoundaboutsSection:
    """``signals`` is the T2 table; only rows with node_type=traffic_signals that count are used."""
    routable = [way for way in ways if is_routable_way(way)]
    ring_ways = [
        way for way in routable if tag(way.properties, "junction") in IMPLIED_ONEWAY_JUNCTION_VALUES
    ]
    ring_way_ids = {id(way) for way in ring_ways}
    arms_pool = [way for way in routable if id(way) not in ring_way_ids]
    rings = _group_rings(ring_ways)

    counted = signals.filter((pl.col("node_type") == "traffic_signals") & pl.col("counts_in_delay"))
    signal_xy = counted.select("x_m", "y_m").to_numpy().astype(np.float64)
    signal_clusters = counted["provisional_cluster_id"].to_list()
    nearest_ring = _nearest_ring(rings, signal_xy, association_distance_meters)

    arm_vertex_sets = [set(way.coordinates) for way in arms_pool]
    signalised: list[RoundaboutRing] = []
    signals_per_ring: list[int] = []
    arms_per_ring: list[int] = []
    clusters_touching: set[int] = set()
    for ring_index, ring in enumerate(rings):
        member_rows = np.flatnonzero(nearest_ring == ring_index).tolist()
        arm_indices = [i for i, vertices in enumerate(arm_vertex_sets) if vertices & ring.vertices]
        contact = {v for i in arm_indices for v in arm_vertex_sets[i] & ring.vertices}
        arms_per_ring.append(len(arm_indices))
        cluster_ids = {signal_clusters[row] for row in member_rows}
        if not member_rows:
            continue
        clusters_touching |= cluster_ids
        signals_per_ring.append(len(member_rows))
        signalised.append(
            RoundaboutRing(
                ring_id=ring_index,
                name=_ring_name(ring),
                centre_lon=float(np.mean([lon for lon, _ in ring.vertices])),
                centre_lat=float(np.mean([lat for _, lat in ring.vertices])),
                ring_ways=len(ring.ways),
                entry_arm_ways=len(arm_indices),
                contact_vertices=len(contact),
                signal_nodes_near_ring=len(member_rows),
                provisional_clusters_touching=len(cluster_ids),
            )
        )

    total_clusters = len({c for c in signal_clusters if c is not None})
    return RoundaboutsSection(
        association_distance_meters=association_distance_meters,
        rings_total=len(rings),
        rings_with_signals=len(signalised),
        rings_without_signals=len(rings) - len(signalised),
        signal_nodes_at_rings=sum(signals_per_ring),
        counted_signal_nodes_total=len(signal_xy),
        signal_nodes_per_signalised_ring=_histogram(signals_per_ring),
        entry_arms_per_ring=_histogram(arms_per_ring, cap=6),
        provisional_clusters_total=total_clusters,
        provisional_clusters_touching_rings=len(clusters_touching),
        intersections_if_each_ring_is_one=total_clusters - len(clusters_touching) + len(signalised),
        intersections_if_ring_clusters_stay_separate=total_clusters,
        named_rondos_without_ring_tag=_untagged_rondos(arms_pool),
        signalised_rings=sorted(signalised, key=lambda r: -r.signal_nodes_near_ring),
    )
