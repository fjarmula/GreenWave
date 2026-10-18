"""The intersections and signal-approach tables written as parquet."""

from collections.abc import Mapping

import networkx as nx
import polars as pl

from greenwave.etl.config import (
    PEDESTRIAN_CROSSING_DELAY_SECONDS,
    SIGNAL_DELAY_SECONDS,
)
from greenwave.etl.intersections.grouping import intersection_index
from greenwave.etl.intersections.model import (
    REASON_BEYOND_LIMIT,
    REASON_NO_JUNCTION,
    Assignment,
    GroupingSettings,
    IntersectionRecord,
)
from greenwave.etl.intersections.node_queries import best_incident_class
from greenwave.etl.junctions import (
    KIND_MIDBLOCK_SIGNAL,
    KIND_PEDESTRIAN_CROSSING,
    KIND_SIGNALISED_JUNCTION,
    Ring,
)
from greenwave.etl.network import Attachment
from greenwave.etl.street_names import normalise_street_name


def kind_delay_seconds(
    signal_delay_seconds: float = SIGNAL_DELAY_SECONDS,
    pedestrian_crossing_delay_seconds: float = PEDESTRIAN_CROSSING_DELAY_SECONDS,
) -> dict[str, float]:
    """D_v of one intersection by kind. A kind that is not listed here has no delay: it raises."""
    return {
        KIND_SIGNALISED_JUNCTION: signal_delay_seconds,
        KIND_MIDBLOCK_SIGNAL: signal_delay_seconds,
        KIND_PEDESTRIAN_CROSSING: pedestrian_crossing_delay_seconds,
    }


def _delay_of(kind: str, delay_by_kind: Mapping[str, float]) -> float:
    if kind not in delay_by_kind:
        raise ValueError(f"no D_v is configured for intersection kind {kind!r}")
    return delay_by_kind[kind]


def intersection_frame(
    graph: nx.MultiDiGraph,
    intersections: list[IntersectionRecord],
    attachments: list[Attachment],
    rings: list[Ring],
    ulice_names: set[str],
    reachable_nodes: set[str],
    delay_by_kind: Mapping[str, float] | None = None,
) -> pl.DataFrame:
    delay_by_kind = kind_delay_seconds() if delay_by_kind is None else delay_by_kind
    ring_by_id = {ring.ring_id: ring for ring in rings}
    rows = []
    for record in intersections:
        data = graph.nodes[record.representative]
        ring = ring_by_id.get(record.ring_id) if record.ring_id is not None else None
        approaches = [attachments[i] for i in record.approach_indices]
        rows.append(
            {
                "intersection_id": record.intersection_id,
                "kind": record.kind,
                "delay_seconds": _delay_of(record.kind, delay_by_kind),
                "node_key": record.representative,
                "member_nodes": sorted(record.nodes),
                "lon": record.lon,
                "lat": record.lat,
                "x_m": data["x_m"],
                "y_m": data["y_m"],
                "name": record.name,
                "name_source": record.name_source,
                "street_names": record.street_names,
                "street_names_in_ulice": [
                    normalise_street_name(n) in ulice_names for n in record.street_names
                ],
                "approaches": len(approaches),
                "best_incident_road_class": best_incident_class(graph, record.nodes),
                "ring_id": record.ring_id,
                "ring_edge_ids": sorted(ring.edge_ids) if ring else [],
                "internal_edge_ids": sorted(ring.edge_ids | ring.internal_edge_ids) if ring else [],
                "ring_source": ring.source if ring else None,
                "ring_verified": ring.verified if ring else None,
                "provisional_cluster_ids": sorted(
                    {
                        a.signal.provisional_cluster_id
                        for a in approaches
                        if a.signal.provisional_cluster_id is not None
                    }
                ),
                "in_largest_scc": record.representative in reachable_nodes,
            }
        )
    return pl.DataFrame(
        rows,
        schema={
            "intersection_id": pl.String,
            "kind": pl.String,
            "delay_seconds": pl.Float64,
            "node_key": pl.String,
            "member_nodes": pl.List(pl.String),
            "lon": pl.Float64,
            "lat": pl.Float64,
            "x_m": pl.Float64,
            "y_m": pl.Float64,
            "name": pl.String,
            "name_source": pl.String,
            "street_names": pl.List(pl.String),
            "street_names_in_ulice": pl.List(pl.Boolean),
            "approaches": pl.Int64,
            "best_incident_road_class": pl.String,
            "ring_id": pl.Int64,
            "ring_edge_ids": pl.List(pl.String),
            "internal_edge_ids": pl.List(pl.String),
            "ring_source": pl.String,
            "ring_verified": pl.Boolean,
            "provisional_cluster_ids": pl.List(pl.Int64),
            "in_largest_scc": pl.Boolean,
        },
    )


def approach_frame(
    attachments: list[Attachment],
    assignments: list[Assignment],
    intersections: list[IntersectionRecord],
    reachable_nodes: set[str],
    settings: GroupingSettings | None = None,
) -> pl.DataFrame:
    settings = settings or GroupingSettings()
    assignment_by_index = {a.attachment_index: a for a in assignments}
    intersection_of = intersection_index(intersections)
    kind_of = {i: r.kind for r in intersections for i in r.approach_indices}
    rows = []
    for index, attachment in enumerate(attachments):
        signal = attachment.signal
        assignment = assignment_by_index.get(index)
        reason = None
        if assignment is not None:
            if assignment.junction_node is None:
                reason = REASON_NO_JUNCTION
            elif (assignment.distance_m or 0.0) > settings.assignment_limit_meters:
                reason = REASON_BEYOND_LIMIT
        rows.append(
            {
                "signal_key": signal.node_key,
                "node_type": signal.node_type,
                "lon": signal.lon,
                "lat": signal.lat,
                "intersection_id": intersection_of.get(index),
                "intersection_kind": kind_of.get(index),
                "nearest_junction_node": assignment.junction_node if assignment else None,
                "assignment_method": assignment.method if assignment else None,
                "assignment_distance_m": assignment.distance_m if assignment else None,
                "standalone_reason": reason,
                "snap_kind": attachment.snap_kind,
                "snap_distance_m": attachment.snap_distance_m,
                "graph_node": attachment.graph_node,
                "direction_tag": signal.direction,
                "direction_resolved": attachment.direction_resolved,
                "controlled_edge_ids": attachment.controlled_edge_ids,
                "issue": attachment.issue,
                "provisional_cluster_id": signal.provisional_cluster_id,
                "delay_seconds": signal.delay_seconds,
                "in_largest_scc": attachment.graph_node in reachable_nodes,
            }
        )
    return pl.DataFrame(
        rows,
        schema={
            "signal_key": pl.String,
            "node_type": pl.String,
            "lon": pl.Float64,
            "lat": pl.Float64,
            "intersection_id": pl.String,
            "intersection_kind": pl.String,
            "nearest_junction_node": pl.String,
            "assignment_method": pl.String,
            "assignment_distance_m": pl.Float64,
            "standalone_reason": pl.String,
            "snap_kind": pl.String,
            "snap_distance_m": pl.Float64,
            "graph_node": pl.String,
            "direction_tag": pl.String,
            "direction_resolved": pl.String,
            "controlled_edge_ids": pl.List(pl.String),
            "issue": pl.String,
            "provisional_cluster_id": pl.Int64,
            "delay_seconds": pl.Float64,
            "in_largest_scc": pl.Boolean,
        },
    )
