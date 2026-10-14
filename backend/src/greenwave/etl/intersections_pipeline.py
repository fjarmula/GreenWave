"""Step T4 orchestration: weld, attach signals, build intersections, write the network artifacts."""

import hashlib
import json
import logging
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

import networkx as nx
import polars as pl
from pydantic import BaseModel

from greenwave.etl.config import SIGNAL_SNAP_TOLERANCE_METERS
from greenwave.etl.graph import build_graph
from greenwave.etl.graph_io import write_graph
from greenwave.etl.intersections import (
    AssignmentDistribution,
    GroupingReport,
    GroupingSettings,
    IntersectionRecord,
    NameReport,
    approach_frame,
    assign_approaches,
    build_intersections,
    distance_distribution,
    intersection_frame,
    intersection_index,
    name_report,
    prepare_rings,
)
from greenwave.etl.junctions import Ring, find_junction_nodes, undirected_adjacency
from greenwave.etl.manifest import MANIFEST_FILENAME
from greenwave.etl.near_misses import NearMissReport, find_near_misses
from greenwave.etl.network import (
    DIRECTION_UNRESOLVED,
    SNAP_GRAPH_NODE,
    SNAP_UNSNAPPED,
    AttachResult,
    SignalPoint,
    attach_signals,
)
from greenwave.etl.overrides import OVERRIDE_FILENAME, RoundaboutOverride, load_overrides
from greenwave.etl.prepare import (
    TERTIARY_PLUS_FILENAME,
    WELDS_FILENAME,
    PreparedScan,
    prepare_scan,
    tertiary_plus_cases,
    welds_frame,
)
from greenwave.etl.road_rules import is_routable_way
from greenwave.etl.signals import build_signals
from greenwave.etl.street_comparison import ulice_street_lengths
from greenwave.etl.weld import WeldReport

logger = logging.getLogger(__name__)

NETWORK_NODES_FILENAME = "network_nodes.parquet"
NETWORK_EDGES_FILENAME = "network_edges.parquet"
INTERSECTIONS_FILENAME = "intersections.parquet"
APPROACHES_FILENAME = "signal_approaches.parquet"
IDS_FILENAME = "intersection_ids.json"
NEAR_MISSES_FILENAME = "near_misses.csv"


class SnapReport(BaseModel):
    tolerance_m: float
    attached_signals: int
    by_snap_kind: dict[str, int]
    edges_split: int
    nodes_added: int
    offset_snap_distances_m: list[float]
    unsnapped: list[dict[str, object]]
    signals_with_direction_tag: int
    direction_by_resolution: dict[str, int]
    direction_tag_ignored_at_graph_node: int
    unresolved_directions: list[dict[str, object]]
    approaches_not_in_largest_scc: list[dict[str, object]]


class RingReport(BaseModel):
    override_file: str
    override_entries: int
    override_rings_applied: int
    override_rings_verified: int
    problems: list[str]
    rings: list[dict[str, object]]


class IntersectionsSection(BaseModel):
    generated_at_utc: str
    inputs_sha256: dict[str, str]
    manifest_sha256: str
    snapping: SnapReport
    assignment_distance: AssignmentDistribution
    grouping: GroupingReport
    rings: RingReport
    names: NameReport
    welds: WeldReport
    near_misses_before_welding: NearMissReport
    near_misses_after_welding: NearMissReport
    tertiary_plus_near_misses: list[dict[str, object]]
    notes: list[str]


def _signal_points(frame: pl.DataFrame) -> list[SignalPoint]:
    counted = frame.filter(pl.col("counts_in_delay")).sort("source_line")
    return [
        SignalPoint(
            node_key=row["node_key"],
            node_type=row["node_type"],
            lon=row["lon"],
            lat=row["lat"],
            x_m=row["x_m"],
            y_m=row["y_m"],
            direction=row["direction"],
            delay_seconds=row["delay_seconds"],
            provisional_cluster_id=row["provisional_cluster_id"],
        )
        for row in counted.iter_rows(named=True)
    ]


def _file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_intersections(
    raw_dir: Path,
    processed_dir: Path,
    overrides_dir: Path,
    snap_tolerance_meters: float = SIGNAL_SNAP_TOLERANCE_METERS,
    settings: GroupingSettings | None = None,
) -> IntersectionsSection:
    settings = settings or GroupingSettings()
    prepared = prepare_scan(raw_dir)
    inputs_sha256 = prepared.inputs_sha256
    scan = prepared.scan

    signals = build_signals(scan, inputs_sha256).frame
    base = build_graph(scan.drivable_ways).graph
    points = _signal_points(signals)

    logger.info("attaching %d counted signal nodes", len(points))
    attached = attach_signals(base, points, snap_tolerance_meters)
    graph = attached.graph
    attachments = attached.attachments

    adjacency = undirected_adjacency(graph)
    junctions = find_junction_nodes(adjacency)
    overrides = load_overrides(overrides_dir / OVERRIDE_FILENAME)
    rings, ring_problems = prepare_rings(graph, overrides)
    assignments = assign_approaches(attachments, adjacency, junctions, rings, graph)
    intersections, grouping = build_intersections(
        graph, adjacency, attachments, assignments, rings, settings
    )

    largest_scc = max(nx.strongly_connected_components(graph), key=len)
    ulice_names = set(ulice_street_lengths(raw_dir / "krakow" / "Ulice.geojson"))
    intersections_frame = intersection_frame(
        graph, intersections, attachments, rings, ulice_names, largest_scc
    )
    approaches = approach_frame(attachments, assignments, intersections, largest_scc, settings)

    routable = [way for way in scan.drivable_ways if is_routable_way(way)]
    near_after_frame, near_after = find_near_misses(base, routable)
    tertiary = tertiary_plus_cases(prepared.near_misses_before, prepared.weld_report)

    processed_dir.mkdir(parents=True, exist_ok=True)
    write_graph(graph, processed_dir, NETWORK_NODES_FILENAME, NETWORK_EDGES_FILENAME)
    intersections_frame.write_parquet(processed_dir / INTERSECTIONS_FILENAME)
    approaches.write_parquet(processed_dir / APPROACHES_FILENAME)
    near_after_frame.write_csv(processed_dir / NEAR_MISSES_FILENAME)
    tertiary.write_csv(processed_dir / TERTIARY_PLUS_FILENAME)
    welds_frame(prepared.weld_report).write_csv(processed_dir / WELDS_FILENAME)
    manifest_sha256 = _file_sha256(raw_dir / MANIFEST_FILENAME)
    _write_ids(processed_dir / IDS_FILENAME, intersections_frame, manifest_sha256, inputs_sha256)

    return IntersectionsSection(
        generated_at_utc=datetime.now(UTC).isoformat(timespec="seconds"),
        inputs_sha256=inputs_sha256,
        manifest_sha256=manifest_sha256,
        snapping=_snap_report(attached, snap_tolerance_meters, largest_scc),
        assignment_distance=distance_distribution(
            attachments,
            assignments,
            intersection_index(intersections),
            settings.assignment_limit_meters,
        ),
        grouping=grouping,
        rings=_ring_report(
            overrides_dir / OVERRIDE_FILENAME,
            overrides.entries,
            rings,
            ring_problems,
            intersections,
        ),
        names=name_report(intersections, ulice_names),
        welds=prepared.weld_report,
        near_misses_before_welding=prepared.near_miss_report_before,
        near_misses_after_welding=near_after,
        tertiary_plus_near_misses=tertiary.to_dicts(),
        notes=_notes(prepared),
    )


def _notes(prepared: PreparedScan) -> list[str]:
    return [
        "Intersection = a graph junction node with counted signals; rings are one intersection; "
        "junction nodes within the merge distance along the road merge unless the group diameter "
        "cap refuses (see grouping.capped_cases). Approaches beyond the assignment limit are "
        "standalone mid-block signals. Pedestrian crossings are kind=pedestrian_crossing.",
        "Ids INT-0001.. are ordered by kind (signalised junctions, mid-block signals, pedestrian "
        "crossings), then position (south to north, then west to east) of the group centroid.",
        "D_v attaches to each signal approach a route crosses (signal_approaches.delay_seconds and "
        "controlled_edge_ids), not to the intersection.",
        "Signals on an existing junction node control every arriving edge; traffic_signals:"
        "direction can only pick an edge for signals split out of an edge.",
        f"All ETL steps use ways welded within {prepared.weld_report.tolerance_m:g} m "
        "(never across different layer/bridge/tunnel); every weld is in welds.csv.",
    ]


def _write_ids(
    path: Path, frame: pl.DataFrame, manifest_sha256: str, inputs: dict[str, str]
) -> None:
    path.write_text(
        json.dumps(
            {
                "valid_for": {
                    "manifest_sha256": manifest_sha256,
                    "inputs_sha256": inputs,
                    "note": "ids are valid for this pinned snapshot and this configuration only",
                },
                "intersections": [
                    {
                        "id": row["intersection_id"],
                        "kind": row["kind"],
                        "node_key": row["node_key"],
                        "member_nodes": row["member_nodes"],
                        "lon": row["lon"],
                        "lat": row["lat"],
                        "name": row["name"],
                    }
                    for row in frame.iter_rows(named=True)
                ],
            },
            ensure_ascii=False,
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )


def _snap_report(attached: AttachResult, tolerance: float, largest_scc: set[str]) -> SnapReport:
    attachments = attached.attachments
    by_kind = Counter(a.snap_kind for a in attachments)
    tagged = [a for a in attachments if a.signal.direction is not None]
    return SnapReport(
        tolerance_m=tolerance,
        attached_signals=sum(a.snap_kind != SNAP_UNSNAPPED for a in attachments),
        by_snap_kind=dict(sorted(by_kind.items())),
        edges_split=attached.edges_split,
        nodes_added=attached.nodes_added,
        offset_snap_distances_m=sorted(
            round(a.snap_distance_m, 2)
            for a in attachments
            if a.snap_kind == "offset_snap" and a.snap_distance_m is not None
        ),
        unsnapped=[
            {
                "signal": a.signal.node_key,
                "type": a.signal.node_type,
                "lon": a.signal.lon,
                "lat": a.signal.lat,
                "nearest_edge_m": a.snap_distance_m,
                "nearest_street": a.nearest_street,
            }
            for a in attachments
            if a.snap_kind == SNAP_UNSNAPPED
        ],
        signals_with_direction_tag=len(tagged),
        direction_by_resolution=dict(Counter(a.direction_resolved for a in attachments)),
        direction_tag_ignored_at_graph_node=sum(
            a.snap_kind == SNAP_GRAPH_NODE or a.direction_resolved == "node_all_incoming"
            for a in tagged
        ),
        unresolved_directions=[
            {
                "signal": a.signal.node_key,
                "lon": a.signal.lon,
                "lat": a.signal.lat,
                "direction": a.signal.direction,
                "issue": a.issue,
            }
            for a in attachments
            if a.direction_resolved == DIRECTION_UNRESOLVED and a.graph_node is not None
        ],
        approaches_not_in_largest_scc=[
            {
                "signal": a.signal.node_key,
                "type": a.signal.node_type,
                "lon": a.signal.lon,
                "lat": a.signal.lat,
                "graph_node": a.graph_node,
            }
            for a in attachments
            if a.graph_node is not None and a.graph_node not in largest_scc
        ],
    )


def _ring_report(
    path: Path,
    entries: list[RoundaboutOverride],
    rings: list[Ring],
    problems: list[str],
    intersections: list[IntersectionRecord],
) -> RingReport:
    intersections_per_ring: Counter[int] = Counter()
    approaches_per_ring: Counter[int] = Counter()
    for intersection in intersections:
        if intersection.ring_id is not None:
            intersections_per_ring[intersection.ring_id] += 1
            approaches_per_ring[intersection.ring_id] += len(intersection.approach_indices)
    overrides = [r for r in rings if r.source == "override"]
    return RingReport(
        override_file=str(path),
        override_entries=len(entries),
        override_rings_applied=len(overrides),
        override_rings_verified=sum(bool(r.verified) for r in overrides),
        problems=problems,
        rings=[
            {
                "ring_id": r.ring_id,
                "source": r.source,
                "name": r.name,
                "verified": r.verified,
                "ring_edges": len(r.edge_ids),
                "entry_arm_edges": len(r.arm_base_edge_ids),
                "internal_edges": len(r.internal_edge_ids),
                "intersections": intersections_per_ring.get(r.ring_id, 0),
                "approaches": approaches_per_ring.get(r.ring_id, 0),
            }
            for r in rings
            if intersections_per_ring.get(r.ring_id) or r.source == "override"
        ],
    )
