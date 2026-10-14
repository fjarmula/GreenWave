"""T2: normalise signal nodes and signalised crossings, apply the handling policy, group them.

Every OSM node stays in ``signals.parquet`` with an explicit ``handling`` and ``counts_in_delay``
so nothing is dropped silently; excluded and flagged nodes are also listed in the report.
Clusters here are provisional (distance only). The final intersection is the graph junction node
and is produced in T4.
"""

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

import numpy as np
import polars as pl
import shapely
from pydantic import BaseModel

from greenwave.etl.clustering import single_linkage_labels
from greenwave.etl.config import (
    ABSENT_TAG,
    COUNTED_CROSSING_KINDS,
    PEDESTRIAN_CROSSING_DELAY_SECONDS,
    SIGNAL_CLUSTER_RADIUS_METERS,
    SIGNAL_DELAY_SECONDS,
    SIGNAL_TAG_HANDLING,
    STANDALONE_CROSSING_DISTANCE_METERS,
    SignalHandling,
)
from greenwave.etl.geo import project_lines, project_points
from greenwave.etl.profile_models import ClusteringProfile
from greenwave.etl.profile_osm import LonLat, OsmScan, PointFeature, crossing_kind, tag
from greenwave.etl.profile_roads import build_topology
from greenwave.etl.profile_signals import cluster_profile
from greenwave.etl.road_rules import is_routable_way

logger = logging.getLogger(__name__)

NODE_TYPE_SIGNAL = "traffic_signals"
NODE_TYPE_PEDESTRIAN_CROSSING = "pedestrian_crossing"
NODE_TYPE_OTHER_CROSSING = "other_crossing"

_SIGNAL_SCHEMA: dict[str, pl.DataType | type[pl.DataType]] = {
    "node_key": pl.String,
    "source_line": pl.Int64,
    "lon": pl.Float64,
    "lat": pl.Float64,
    "x_m": pl.Float64,
    "y_m": pl.Float64,
    "node_type": pl.String,
    "tag_variant": pl.String,
    "direction": pl.String,
    "crossing_kind": pl.String,
    "handling": pl.String,
    "counts_in_delay": pl.Boolean,
    "needs_review": pl.Boolean,
    "reject_reason": pl.String,
    "delay_seconds": pl.Float64,
    "vertex_position": pl.String,
    "nearest_counted_signal_m": pl.Float64,
    "standalone": pl.Boolean,
    "provisional_cluster_id": pl.Int64,
    "provisional_cluster_size": pl.Int64,
}


@dataclass(frozen=True, slots=True)
class SignalSettings:
    """Tunable values; defaults come from ``config.py`` and tests inject their own."""

    cluster_radius_meters: float = SIGNAL_CLUSTER_RADIUS_METERS
    standalone_crossing_distance_meters: float = STANDALONE_CROSSING_DISTANCE_METERS
    signal_delay_seconds: float = SIGNAL_DELAY_SECONDS
    pedestrian_crossing_delay_seconds: float = PEDESTRIAN_CROSSING_DELAY_SECONDS

    def __post_init__(self) -> None:
        if self.cluster_radius_meters <= 0 or self.standalone_crossing_distance_meters <= 0:
            raise ValueError("distances must be positive (metres)")
        if self.signal_delay_seconds < 0 or self.pedestrian_crossing_delay_seconds < 0:
            raise ValueError("delays must not be negative (seconds)")


class RejectEntry(BaseModel):
    category: str
    node_key: str
    source_line: int
    lon: float
    lat: float
    node_type: str
    tag_variant: str | None
    reason: str
    nearest_routable_way_m: float | None = None


class SignalsSection(BaseModel):
    generated_at_utc: str
    inputs_sha256: dict[str, str]
    settings: dict[str, float]
    signal_nodes: int
    signals_by_handling: dict[str, int]
    crossings_total: int
    crossings_by_kind: dict[str, int]
    crossings_counted_standalone: int
    crossings_excluded_duplicate_of_signal: int
    crossings_excluded_other_kind: int
    standalone_if_every_signal_node_counted: int
    counted_nodes: int
    counted_signals_vertex_position: dict[str, int]
    provisional_clusters: ClusteringProfile
    rejects: list[RejectEntry]
    reject_counts: dict[str, int]


@dataclass(frozen=True, slots=True)
class SignalsResult:
    frame: pl.DataFrame
    report: SignalsSection


def _vertex_position(
    coordinate: LonLat, ways_per_vertex: dict[LonLat, int], endpoints: set[LonLat]
) -> str:
    ways_here = ways_per_vertex.get(coordinate, 0)
    if ways_here >= 2:
        return "junction"
    if ways_here == 1:
        return "way_endpoint" if coordinate in endpoints else "interior"
    return "off_network"


def _nearest_distance_meters(queries_xy: np.ndarray, targets_xy: np.ndarray) -> np.ndarray:
    """Distance from each query point to its nearest target; NaN when there are no targets."""
    distances = np.full(len(queries_xy), np.nan, dtype=np.float64)
    if len(queries_xy) == 0 or len(targets_xy) == 0:
        return distances
    tree = shapely.STRtree(shapely.points(targets_xy))
    indices, nearest = tree.query_nearest(
        shapely.points(queries_xy), return_distance=True, all_matches=False
    )
    distances[indices[0]] = nearest
    return distances


def _optional(value: float) -> float | None:
    return None if np.isnan(value) else float(value)


def build_signals(
    scan: OsmScan, inputs_sha256: dict[str, str], settings: SignalSettings | None = None
) -> SignalsResult:
    settings = settings or SignalSettings()
    routable = [way for way in scan.drivable_ways if is_routable_way(way)]
    topology = build_topology(routable)
    ways_per_vertex = dict(topology.ways_per_vertex)

    nodes: list[tuple[PointFeature, str]] = [
        (signal, NODE_TYPE_SIGNAL) for signal in scan.signal_nodes
    ] + [(crossing, NODE_TYPE_PEDESTRIAN_CROSSING) for crossing in scan.signalised_crossings]
    nodes.sort(key=lambda item: item[0].line_number)
    xy = project_points(
        np.array([node.lon for node, _ in nodes]), np.array([node.lat for node, _ in nodes])
    )

    # Signals first: the handling policy decides which ones count, and crossings are judged
    # against the counted ones only (a crossing next to a blinker is still a real stop).
    handling: list[SignalHandling] = []
    reasons: list[str | None] = []
    variants: list[str | None] = []
    kinds: list[str | None] = []
    node_types: list[str] = []
    for node, node_type in nodes:
        if node_type == NODE_TYPE_SIGNAL:
            variant = tag(node.properties, "traffic_signals") or ABSENT_TAG
            policy = SIGNAL_TAG_HANDLING.get(variant)
            variants.append(variant)
            kinds.append(None)
            node_types.append(NODE_TYPE_SIGNAL)
            if policy is None:
                handling.append(SignalHandling.EXCLUDE_AND_REJECT)
                reasons.append(f"unrecognised traffic_signals value {variant!r}; not counted")
            elif policy is SignalHandling.EXCLUDE_AND_REJECT:
                handling.append(policy)
                reasons.append(f"{variant}: non-blocking signal, excluded from D_v")
            elif policy is SignalHandling.MANUAL_REVIEW:
                handling.append(policy)
                reasons.append(f"{variant}: counted in D_v, needs manual review")
            else:
                handling.append(policy)
                reasons.append(None)
        else:
            kind = crossing_kind(node)
            variants.append(None)
            kinds.append(kind)
            node_types.append(
                NODE_TYPE_PEDESTRIAN_CROSSING
                if kind in COUNTED_CROSSING_KINDS
                else NODE_TYPE_OTHER_CROSSING
            )
            handling.append(SignalHandling.COUNT_IN_DELAY)  # refined below
            reasons.append(None)

    counts_signal = np.array(
        [
            node_types[i] == NODE_TYPE_SIGNAL
            and handling[i] is not SignalHandling.EXCLUDE_AND_REJECT
            for i in range(len(nodes))
        ],
        dtype=np.bool_,
    )
    is_signal = np.array([t == NODE_TYPE_SIGNAL for t in node_types], dtype=np.bool_)
    is_crossing = ~is_signal

    nearest_counted = _nearest_distance_meters(xy[is_crossing], xy[counts_signal])
    nearest_any = _nearest_distance_meters(xy[is_crossing], xy[is_signal])
    crossing_rows = np.flatnonzero(is_crossing)
    standalone_flags: dict[int, bool] = {}
    nearest_by_row: dict[int, float | None] = {}
    standalone_if_any = 0
    for position, row in enumerate(crossing_rows.tolist()):
        distance = nearest_counted[position]
        nearest_by_row[row] = _optional(distance)
        standalone = bool(
            np.isnan(distance) or distance > settings.standalone_crossing_distance_meters
        )
        standalone_flags[row] = standalone
        if node_types[row] == NODE_TYPE_PEDESTRIAN_CROSSING and (
            np.isnan(nearest_any[position])
            or nearest_any[position] > settings.standalone_crossing_distance_meters
        ):
            standalone_if_any += 1
        if node_types[row] != NODE_TYPE_PEDESTRIAN_CROSSING:
            handling[row] = SignalHandling.EXCLUDE_AND_REJECT
            reasons[row] = f"{kinds[row]}: not a road pedestrian crossing, excluded from D_v"
        elif not standalone:
            handling[row] = SignalHandling.EXCLUDE_AND_REJECT
            reasons[row] = (
                f"within {settings.standalone_crossing_distance_meters:g} m of a counted signal "
                "node: duplicates it"
            )

    counts_in_delay = np.array(
        [h is not SignalHandling.EXCLUDE_AND_REJECT for h in handling], dtype=np.bool_
    )

    # Provisional clusters: counted signal nodes only, so a blinker never merges real signals.
    cluster_ids = np.full(len(nodes), -1, dtype=np.int64)
    cluster_sizes = np.zeros(len(nodes), dtype=np.int64)
    counted_signal_rows = np.flatnonzero(counts_signal)
    counted_xy = xy[counts_signal]
    labels = single_linkage_labels(counted_xy, settings.cluster_radius_meters)
    if len(labels):
        sizes = np.bincount(labels)
        cluster_ids[counted_signal_rows] = labels
        cluster_sizes[counted_signal_rows] = sizes[labels]

    positions = [
        _vertex_position((node.lon, node.lat), ways_per_vertex, topology.endpoints)
        for node, _ in nodes
    ]
    off_network_rows = [
        i
        for i, position in enumerate(positions)
        if position == "off_network" and node_types[i] == NODE_TYPE_SIGNAL
    ]
    nearest_way: dict[int, float] = {}
    if off_network_rows and routable:
        lines = project_lines([shapely.LineString(way.coordinates) for way in routable])
        _, distances = shapely.STRtree(lines).query_nearest(
            shapely.points(xy[off_network_rows]), return_distance=True, all_matches=False
        )
        nearest_way = {row: float(d) for row, d in zip(off_network_rows, distances, strict=True)}

    delay: list[float | None] = []
    for i, node_type in enumerate(node_types):
        if not counts_in_delay[i]:
            delay.append(None)
        elif node_type == NODE_TYPE_SIGNAL:
            delay.append(settings.signal_delay_seconds)
        else:
            delay.append(settings.pedestrian_crossing_delay_seconds)

    columns: dict[str, Sequence[object]] = {
        "node_key": [f"OSM-L{node.line_number}" for node, _ in nodes],
        "source_line": [node.line_number for node, _ in nodes],
        "lon": [node.lon for node, _ in nodes],
        "lat": [node.lat for node, _ in nodes],
        "x_m": [float(x) for x in xy[:, 0]],
        "y_m": [float(y) for y in xy[:, 1]],
        "node_type": node_types,
        "tag_variant": variants,
        "direction": [tag(node.properties, "traffic_signals:direction") for node, _ in nodes],
        "crossing_kind": kinds,
        "handling": [h.value for h in handling],
        "counts_in_delay": counts_in_delay.tolist(),
        "needs_review": [h is SignalHandling.MANUAL_REVIEW for h in handling],
        "reject_reason": reasons,
        "delay_seconds": delay,
        "vertex_position": positions,
        "nearest_counted_signal_m": [nearest_by_row.get(i) for i in range(len(nodes))],
        "standalone": [standalone_flags.get(i) for i in range(len(nodes))],
        "provisional_cluster_id": [int(c) if c >= 0 else None for c in cluster_ids],
        "provisional_cluster_size": [int(s) if s > 0 else None for s in cluster_sizes],
    }
    frame = pl.DataFrame(columns, schema=_SIGNAL_SCHEMA)

    rejects: list[RejectEntry] = []
    for i, (node, _) in enumerate(nodes):
        node_type = node_types[i]
        policy = (
            SIGNAL_TAG_HANDLING.get(variants[i] or "") if node_type == NODE_TYPE_SIGNAL else None
        )
        found: list[tuple[str, str, float | None]] = []
        if node_type == NODE_TYPE_SIGNAL and handling[i] is not SignalHandling.COUNT_IN_DELAY:
            if handling[i] is SignalHandling.MANUAL_REVIEW:
                category = "needs_manual_review"
            elif policy is None:
                category = "unrecognised_signal_tag"
            else:
                category = "non_blocking_signal"
            found.append((category, reasons[i] or "", None))
        elif node_type == NODE_TYPE_OTHER_CROSSING:
            found.append(("other_crossing_kind", reasons[i] or "", None))
        if i in nearest_way:
            found.append(
                (
                    "signal_off_network",
                    "not on any routable-way vertex; T4 will try to snap it",
                    nearest_way[i],
                )
            )
        rejects.extend(
            RejectEntry(
                category=category,
                node_key=f"OSM-L{node.line_number}",
                source_line=node.line_number,
                lon=node.lon,
                lat=node.lat,
                node_type=node_type,
                tag_variant=variants[i],
                reason=reason,
                nearest_routable_way_m=distance,
            )
            for category, reason, distance in found
        )

    crossings_by_kind: dict[str, int] = {}
    for kind in (k for k in kinds if k is not None):
        crossings_by_kind[kind] = crossings_by_kind.get(kind, 0) + 1
    handling_signals: dict[str, int] = {}
    for i, h in enumerate(handling):
        if node_types[i] == NODE_TYPE_SIGNAL:
            handling_signals[h.value] = handling_signals.get(h.value, 0) + 1
    counted_positions: dict[str, int] = {}
    for i in counted_signal_rows.tolist():
        counted_positions[positions[i]] = counted_positions.get(positions[i], 0) + 1
    reject_counts: dict[str, int] = {}
    for reject in rejects:
        reject_counts[reject.category] = reject_counts.get(reject.category, 0) + 1

    report = SignalsSection(
        generated_at_utc=datetime.now(UTC).isoformat(timespec="seconds"),
        inputs_sha256=inputs_sha256,
        settings={
            "cluster_radius_meters": settings.cluster_radius_meters,
            "standalone_crossing_distance_meters": settings.standalone_crossing_distance_meters,
            "signal_delay_seconds": settings.signal_delay_seconds,
            "pedestrian_crossing_delay_seconds": settings.pedestrian_crossing_delay_seconds,
        },
        signal_nodes=int(is_signal.sum()),
        signals_by_handling=handling_signals,
        crossings_total=int(is_crossing.sum()),
        crossings_by_kind=dict(sorted(crossings_by_kind.items(), key=lambda kv: -kv[1])),
        crossings_counted_standalone=sum(
            1
            for i in crossing_rows.tolist()
            if node_types[i] == NODE_TYPE_PEDESTRIAN_CROSSING
            and handling[i] is SignalHandling.COUNT_IN_DELAY
        ),
        crossings_excluded_duplicate_of_signal=sum(
            1
            for i in crossing_rows.tolist()
            if node_types[i] == NODE_TYPE_PEDESTRIAN_CROSSING
            and handling[i] is SignalHandling.EXCLUDE_AND_REJECT
        ),
        crossings_excluded_other_kind=sum(
            1 for i in crossing_rows.tolist() if node_types[i] == NODE_TYPE_OTHER_CROSSING
        ),
        standalone_if_every_signal_node_counted=standalone_if_any,
        counted_nodes=int(counts_in_delay.sum()),
        counted_signals_vertex_position=dict(sorted(counted_positions.items())),
        provisional_clusters=cluster_profile(counted_xy, settings.cluster_radius_meters),
        rejects=rejects,
        reject_counts=dict(sorted(reject_counts.items())),
    )
    logger.info("signals: %d nodes, %d counted", len(nodes), report.counted_nodes)
    return SignalsResult(frame=frame, report=report)
