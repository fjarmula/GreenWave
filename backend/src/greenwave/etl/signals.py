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
from greenwave.etl.profile_osm import (
    DrivableWay,
    LonLat,
    OsmScan,
    PointFeature,
    crossing_kind,
    tag,
)
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
    table = _classify(nodes)

    # Signals first: the handling policy decides which ones count, and crossings are judged
    # against the counted ones only (a crossing next to a blinker is still a real stop).
    counts_signal = np.array(
        [
            table.node_types[i] == NODE_TYPE_SIGNAL
            and table.handling[i] is not SignalHandling.EXCLUDE_AND_REJECT
            for i in range(len(table.nodes))
        ],
        dtype=np.bool_,
    )
    verdicts = _judge_crossings(table, counts_signal, settings)
    counts_in_delay = np.array(
        [h is not SignalHandling.EXCLUDE_AND_REJECT for h in table.handling], dtype=np.bool_
    )
    clusters = _provisional_clusters(table.xy, counts_signal, settings.cluster_radius_meters)
    positions = [
        _vertex_position((node.lon, node.lat), ways_per_vertex, topology.endpoints)
        for node in table.nodes
    ]
    analysis = _SignalAnalysis(
        table=table,
        verdicts=verdicts,
        counts_in_delay=counts_in_delay,
        clusters=clusters,
        positions=positions,
        nearest_way=_off_network_distances(table, positions, routable),
    )
    frame = _signal_frame(analysis, settings)
    report = _signals_report(analysis, _rejects(analysis), inputs_sha256, settings)
    logger.info("signals: %d nodes, %d counted", len(table.nodes), report.counted_nodes)
    return SignalsResult(frame=frame, report=report)


def classify_signal_tag(variant: str) -> tuple[SignalHandling, str | None]:
    """The handling policy of a ``traffic_signals=*`` value and, unless it simply counts, why."""
    policy = SIGNAL_TAG_HANDLING.get(variant)
    if policy is None:
        return (
            SignalHandling.EXCLUDE_AND_REJECT,
            f"unrecognised traffic_signals value {variant!r}; not counted",
        )
    if policy is SignalHandling.EXCLUDE_AND_REJECT:
        return policy, f"{variant}: non-blocking signal, excluded from D_v"
    if policy is SignalHandling.MANUAL_REVIEW:
        return policy, f"{variant}: counted in D_v, needs manual review"
    return policy, None


@dataclass(slots=True)
class _SignalTable:
    """Per-node columns in source-line order; the crossing pass refines handling and reasons."""

    nodes: list[PointFeature]
    xy: np.ndarray
    node_types: list[str]
    variants: list[str | None]
    kinds: list[str | None]
    handling: list[SignalHandling]
    reasons: list[str | None]


@dataclass(frozen=True, slots=True)
class _CrossingVerdicts:
    rows: list[int]
    nearest_counted_m: dict[int, float | None]
    standalone: dict[int, bool]
    standalone_if_every_signal_counted: int


@dataclass(frozen=True, slots=True)
class _Clusters:
    ids: np.ndarray
    sizes: np.ndarray
    counted_signal_rows: np.ndarray
    counted_xy: np.ndarray


@dataclass(frozen=True, slots=True)
class _SignalAnalysis:
    table: _SignalTable
    verdicts: _CrossingVerdicts
    counts_in_delay: np.ndarray
    clusters: _Clusters
    positions: list[str]
    nearest_way: dict[int, float]


def _classify(nodes: list[tuple[PointFeature, str]]) -> _SignalTable:
    xy = project_points(
        np.array([node.lon for node, _ in nodes]), np.array([node.lat for node, _ in nodes])
    )
    table = _SignalTable([node for node, _ in nodes], xy, [], [], [], [], [])
    for node, node_type in nodes:
        if node_type == NODE_TYPE_SIGNAL:
            variant = tag(node.properties, "traffic_signals") or ABSENT_TAG
            handling, reason = classify_signal_tag(variant)
            table.variants.append(variant)
            table.kinds.append(None)
            table.node_types.append(NODE_TYPE_SIGNAL)
            table.handling.append(handling)
            table.reasons.append(reason)
        else:
            kind = crossing_kind(node)
            table.variants.append(None)
            table.kinds.append(kind)
            table.node_types.append(
                NODE_TYPE_PEDESTRIAN_CROSSING
                if kind in COUNTED_CROSSING_KINDS
                else NODE_TYPE_OTHER_CROSSING
            )
            table.handling.append(SignalHandling.COUNT_IN_DELAY)  # refined by the crossing pass
            table.reasons.append(None)
    return table


def _judge_crossings(
    table: _SignalTable, counts_signal: np.ndarray, settings: SignalSettings
) -> _CrossingVerdicts:
    """Exclude other crossing kinds and crossings that duplicate a counted signal node."""
    is_signal = np.array([t == NODE_TYPE_SIGNAL for t in table.node_types], dtype=np.bool_)
    is_crossing = ~is_signal
    limit = settings.standalone_crossing_distance_meters
    nearest_counted = _nearest_distance_meters(table.xy[is_crossing], table.xy[counts_signal])
    nearest_any = _nearest_distance_meters(table.xy[is_crossing], table.xy[is_signal])
    rows = np.flatnonzero(is_crossing).tolist()
    standalone_flags: dict[int, bool] = {}
    nearest_by_row: dict[int, float | None] = {}
    standalone_if_any = 0
    for position, row in enumerate(rows):
        distance = nearest_counted[position]
        nearest_by_row[row] = _optional(distance)
        standalone = bool(np.isnan(distance) or distance > limit)
        standalone_flags[row] = standalone
        if table.node_types[row] == NODE_TYPE_PEDESTRIAN_CROSSING and (
            np.isnan(nearest_any[position]) or nearest_any[position] > limit
        ):
            standalone_if_any += 1
        if table.node_types[row] != NODE_TYPE_PEDESTRIAN_CROSSING:
            table.handling[row] = SignalHandling.EXCLUDE_AND_REJECT
            table.reasons[row] = (
                f"{table.kinds[row]}: not a road pedestrian crossing, excluded from D_v"
            )
        elif not standalone:
            table.handling[row] = SignalHandling.EXCLUDE_AND_REJECT
            table.reasons[row] = f"within {limit:g} m of a counted signal node: duplicates it"
    return _CrossingVerdicts(rows, nearest_by_row, standalone_flags, standalone_if_any)


def _provisional_clusters(xy: np.ndarray, counts_signal: np.ndarray, radius: float) -> _Clusters:
    """Counted signal nodes only, so a blinker never merges real signals."""
    cluster_ids = np.full(len(xy), -1, dtype=np.int64)
    cluster_sizes = np.zeros(len(xy), dtype=np.int64)
    counted_signal_rows = np.flatnonzero(counts_signal)
    counted_xy = xy[counts_signal]
    labels = single_linkage_labels(counted_xy, radius)
    if len(labels):
        sizes = np.bincount(labels)
        cluster_ids[counted_signal_rows] = labels
        cluster_sizes[counted_signal_rows] = sizes[labels]
    return _Clusters(cluster_ids, cluster_sizes, counted_signal_rows, counted_xy)


def _off_network_distances(
    table: _SignalTable, positions: list[str], routable: list[DrivableWay]
) -> dict[int, float]:
    """Distance to the nearest routable way for each signal node that is on no way vertex."""
    off_network_rows = [
        i
        for i, position in enumerate(positions)
        if position == "off_network" and table.node_types[i] == NODE_TYPE_SIGNAL
    ]
    if not off_network_rows or not routable:
        return {}
    lines = project_lines([shapely.LineString(way.coordinates) for way in routable])
    _, distances = shapely.STRtree(lines).query_nearest(
        shapely.points(table.xy[off_network_rows]), return_distance=True, all_matches=False
    )
    return {row: float(d) for row, d in zip(off_network_rows, distances, strict=True)}


def _signal_frame(analysis: _SignalAnalysis, settings: SignalSettings) -> pl.DataFrame:
    table, clusters, verdicts = analysis.table, analysis.clusters, analysis.verdicts
    delay: list[float | None] = []
    for i, node_type in enumerate(table.node_types):
        if not analysis.counts_in_delay[i]:
            delay.append(None)
        elif node_type == NODE_TYPE_SIGNAL:
            delay.append(settings.signal_delay_seconds)
        else:
            delay.append(settings.pedestrian_crossing_delay_seconds)
    count = len(table.nodes)
    columns: dict[str, Sequence[object]] = {
        "node_key": [f"OSM-L{node.line_number}" for node in table.nodes],
        "source_line": [node.line_number for node in table.nodes],
        "lon": [node.lon for node in table.nodes],
        "lat": [node.lat for node in table.nodes],
        "x_m": [float(x) for x in table.xy[:, 0]],
        "y_m": [float(y) for y in table.xy[:, 1]],
        "node_type": table.node_types,
        "tag_variant": table.variants,
        "direction": [tag(node.properties, "traffic_signals:direction") for node in table.nodes],
        "crossing_kind": table.kinds,
        "handling": [h.value for h in table.handling],
        "counts_in_delay": analysis.counts_in_delay.tolist(),
        "needs_review": [h is SignalHandling.MANUAL_REVIEW for h in table.handling],
        "reject_reason": table.reasons,
        "delay_seconds": delay,
        "vertex_position": analysis.positions,
        "nearest_counted_signal_m": [verdicts.nearest_counted_m.get(i) for i in range(count)],
        "standalone": [verdicts.standalone.get(i) for i in range(count)],
        "provisional_cluster_id": [int(c) if c >= 0 else None for c in clusters.ids],
        "provisional_cluster_size": [int(s) if s > 0 else None for s in clusters.sizes],
    }
    return pl.DataFrame(columns, schema=_SIGNAL_SCHEMA)


def _rejects(analysis: _SignalAnalysis) -> list[RejectEntry]:
    table = analysis.table
    rejects: list[RejectEntry] = []
    for i, node in enumerate(table.nodes):
        node_type = table.node_types[i]
        policy = (
            SIGNAL_TAG_HANDLING.get(table.variants[i] or "")
            if node_type == NODE_TYPE_SIGNAL
            else None
        )
        found: list[tuple[str, str, float | None]] = []
        if node_type == NODE_TYPE_SIGNAL and table.handling[i] is not SignalHandling.COUNT_IN_DELAY:
            if table.handling[i] is SignalHandling.MANUAL_REVIEW:
                category = "needs_manual_review"
            elif policy is None:
                category = "unrecognised_signal_tag"
            else:
                category = "non_blocking_signal"
            found.append((category, table.reasons[i] or "", None))
        elif node_type == NODE_TYPE_OTHER_CROSSING:
            found.append(("other_crossing_kind", table.reasons[i] or "", None))
        if i in analysis.nearest_way:
            found.append(
                (
                    "signal_off_network",
                    "not on any routable-way vertex; T4 will try to snap it",
                    analysis.nearest_way[i],
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
                tag_variant=table.variants[i],
                reason=reason,
                nearest_routable_way_m=distance,
            )
            for category, reason, distance in found
        )
    return rejects


def _signals_report(
    analysis: _SignalAnalysis,
    rejects: list[RejectEntry],
    inputs_sha256: dict[str, str],
    settings: SignalSettings,
) -> SignalsSection:
    table, verdicts = analysis.table, analysis.verdicts
    node_types, handling = table.node_types, table.handling
    is_signal = np.array([t == NODE_TYPE_SIGNAL for t in node_types], dtype=np.bool_)
    crossings_by_kind: dict[str, int] = {}
    for kind in (k for k in table.kinds if k is not None):
        crossings_by_kind[kind] = crossings_by_kind.get(kind, 0) + 1
    handling_signals: dict[str, int] = {}
    for i, h in enumerate(handling):
        if node_types[i] == NODE_TYPE_SIGNAL:
            handling_signals[h.value] = handling_signals.get(h.value, 0) + 1
    counted_positions: dict[str, int] = {}
    for i in analysis.clusters.counted_signal_rows.tolist():
        position = analysis.positions[i]
        counted_positions[position] = counted_positions.get(position, 0) + 1
    reject_counts: dict[str, int] = {}
    for reject in rejects:
        reject_counts[reject.category] = reject_counts.get(reject.category, 0) + 1
    return SignalsSection(
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
        crossings_total=int((~is_signal).sum()),
        crossings_by_kind=dict(sorted(crossings_by_kind.items(), key=lambda kv: -kv[1])),
        crossings_counted_standalone=sum(
            1
            for i in verdicts.rows
            if node_types[i] == NODE_TYPE_PEDESTRIAN_CROSSING
            and handling[i] is SignalHandling.COUNT_IN_DELAY
        ),
        crossings_excluded_duplicate_of_signal=sum(
            1
            for i in verdicts.rows
            if node_types[i] == NODE_TYPE_PEDESTRIAN_CROSSING
            and handling[i] is SignalHandling.EXCLUDE_AND_REJECT
        ),
        crossings_excluded_other_kind=sum(
            1 for i in verdicts.rows if node_types[i] == NODE_TYPE_OTHER_CROSSING
        ),
        standalone_if_every_signal_node_counted=verdicts.standalone_if_every_signal_counted,
        counted_nodes=int(analysis.counts_in_delay.sum()),
        counted_signals_vertex_position=dict(sorted(counted_positions.items())),
        provisional_clusters=cluster_profile(
            analysis.clusters.counted_xy, settings.cluster_radius_meters
        ),
        rejects=rejects,
        reject_counts=dict(sorted(reject_counts.items())),
    )
