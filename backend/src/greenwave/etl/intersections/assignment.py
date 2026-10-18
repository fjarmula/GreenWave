"""Assign each counted signal approach to its nearest junction along the road."""

from collections import defaultdict

import networkx as nx
import numpy as np
from pydantic import BaseModel

from greenwave.etl.config import (
    ASSIGNMENT_LIMIT_METERS,
)
from greenwave.etl.intersections.model import (
    METHOD_NEAREST,
    METHOD_NONE,
    METHOD_OVERRIDE_ARM,
    Assignment,
)
from greenwave.etl.junctions import (
    Adjacency,
    Ring,
    nearest_junctions,
    nearest_of,
)
from greenwave.etl.network import Attachment

_DISTANCE_BINS: tuple[tuple[float, str], ...] = (
    (0.0, "0 (at the junction)"),
    (5.0, "0-5"),
    (10.0, "5-10"),
    (20.0, "10-20"),
    (30.0, "20-30"),
    (50.0, "30-50"),
    (75.0, "50-75"),
    (100.0, "75-100"),
    (150.0, "100-150"),
    (250.0, "150-250"),
    (500.0, "250-500"),
)
_FARTHEST_LISTED = 25


def assign_approaches(
    attachments: list[Attachment],
    adjacency: Adjacency,
    junctions: set[str],
    rings: list[Ring],
    graph: nx.MultiDiGraph,
) -> list[Assignment]:
    """Nearest junction along the road for every attached signal approach (not crossings).

    Distances are reported as they are; the assignment limit is applied when grouping.
    """
    nearest = nearest_junctions(adjacency, junctions)
    arm_rings = [ring for ring in rings if ring.arm_base_edge_ids or ring.internal_base_edge_ids]
    base_of = {k: d["base_edge_id"] for _, _, k, d in graph.edges(keys=True, data=True)}
    assignments: list[Assignment] = []
    for index, attachment in enumerate(attachments):
        if attachment.graph_node is None or attachment.signal.node_type != "traffic_signals":
            continue
        node = attachment.graph_node
        controlled_bases = {base_of[edge_id] for edge_id in attachment.controlled_edge_ids}
        arm_ring = next(
            (
                r
                for r in arm_rings
                if controlled_bases & (r.arm_base_edge_ids | r.internal_base_edge_ids)
            ),
            None,
        )
        if arm_ring is not None:
            targets = (arm_ring.nodes & junctions) or arm_ring.nodes
            found = nearest_of(adjacency, node, targets)
            if found is not None:
                assignments.append(Assignment(index, found[0], found[1], METHOD_OVERRIDE_ARM))
                continue
        if node in nearest:
            junction, distance = nearest[node]
            assignments.append(Assignment(index, junction, distance, METHOD_NEAREST))
        else:
            assignments.append(Assignment(index, None, None, METHOD_NONE))
    return assignments


class AssignmentDistribution(BaseModel):
    approaches: int
    limit_m: float
    percentiles_m: dict[str, float]
    histogram: dict[str, int]
    by_snap_kind: dict[str, dict[str, float]]
    beyond_limit: int
    no_junction_reachable: int
    farthest: list[dict[str, object]]


def distance_distribution(
    attachments: list[Attachment],
    assignments: list[Assignment],
    intersection_by_index: dict[int, str],
    limit_meters: float = ASSIGNMENT_LIMIT_METERS,
) -> AssignmentDistribution:
    distances = np.array([a.distance_m for a in assignments if a.distance_m is not None])
    histogram: dict[str, int] = {label: 0 for _, label in _DISTANCE_BINS}
    histogram[">500"] = 0
    for value in distances.tolist():
        for upper, label in _DISTANCE_BINS:
            if value <= upper:
                histogram[label] += 1
                break
        else:
            histogram[">500"] += 1
    percentiles = (
        {f"p{p}": float(np.percentile(distances, p)) for p in (50, 75, 90, 95, 99)}
        | {"mean": float(distances.mean()), "max": float(distances.max())}
        if len(distances)
        else {}
    )
    by_kind: dict[str, list[float]] = defaultdict(list)
    for assignment in assignments:
        if assignment.distance_m is not None:
            by_kind[attachments[assignment.attachment_index].snap_kind].append(
                assignment.distance_m
            )
    ranked = sorted(
        (a for a in assignments if a.distance_m is not None), key=lambda a: -(a.distance_m or 0.0)
    )[:_FARTHEST_LISTED]
    return AssignmentDistribution(
        approaches=len(assignments),
        limit_m=limit_meters,
        percentiles_m=percentiles,
        histogram=histogram,
        by_snap_kind={
            kind: {
                "count": float(len(values)),
                "p50": float(np.percentile(values, 50)),
                "p90": float(np.percentile(values, 90)),
                "max": float(max(values)),
            }
            for kind, values in sorted(by_kind.items())
        },
        beyond_limit=int((distances > limit_meters).sum()),
        no_junction_reachable=sum(a.junction_node is None for a in assignments),
        farthest=[
            {
                "signal": attachments[a.attachment_index].signal.node_key,
                "lon": attachments[a.attachment_index].signal.lon,
                "lat": attachments[a.attachment_index].signal.lat,
                "distance_m": a.distance_m,
                "method": a.method,
                "intersection_id": intersection_by_index.get(a.attachment_index),
            }
            for a in ranked
        ],
    )
