"""The grouping diagnostics recorded in the T4 report section."""

from collections import Counter
from dataclasses import dataclass

import networkx as nx
import numpy as np
from pydantic import BaseModel

from greenwave.etl.intersections.merge import (
    CappedCase,
    MergeResult,
    capped_case_details,
    capped_case_sensitivity,
)
from greenwave.etl.intersections.model import Assignment, GroupingSettings, IntersectionRecord
from greenwave.etl.intersections.node_queries import best_incident_class
from greenwave.etl.junctions import (
    KIND_MIDBLOCK_SIGNAL,
    KIND_PEDESTRIAN_CROSSING,
    KIND_SIGNALISED_JUNCTION,
    Adjacency,
    Ring,
)
from greenwave.etl.network import Attachment


class GroupingReport(BaseModel):
    settings: dict[str, float]
    approaches: int
    approaches_within_limit: int
    approaches_standalone_midblock: int
    standalone_reasons: dict[str, int]
    junction_nodes_with_approaches: int
    ring_groups: int
    ring_member_nodes: int
    free_junction_nodes: int
    merge_candidate_pairs: int
    merges_performed: int
    merged_groups: int
    merged_group_size_histogram: dict[str, int]
    merged_group_diameter_m: dict[str, float]
    capped_cases: list[CappedCase]
    capped_cases_if_the_cap_were_m: dict[str, int]
    capped_case_details_for_tighter_caps: dict[str, list[CappedCase]]
    pedestrian_crossing_nodes: int
    crossing_merges_performed: int
    crossing_capped_cases: list[CappedCase]
    intersections_signalised_junction: int
    intersections_midblock_signal: int
    intersections_pedestrian_crossing: int
    intersections_total: int
    approaches_per_intersection: dict[str, int]
    best_incident_road_class: dict[str, int]
    rings_tagged: int
    rings_from_overrides: int
    rings_with_intersections: int
    provisional_clusters: int
    provisional_clusters_in_several_intersections: int
    intersections_with_several_provisional_clusters: int


@dataclass(frozen=True, slots=True)
class GroupingInputs:
    graph: nx.MultiDiGraph
    adjacency: Adjacency
    attachments: list[Attachment]
    assignments: list[Assignment]
    rings: list[Ring]
    settings: GroupingSettings


@dataclass(frozen=True, slots=True)
class GroupingTrace:
    """The intermediate results of one grouping run, kept for its report."""

    within: list[Assignment]
    standalone: list[tuple[Assignment, str]]
    junction_nodes: list[str]
    ring_nodes_by_id: dict[int, list[str]]
    free_nodes: list[str]
    merge: MergeResult
    crossing_merge: MergeResult
    crossing_nodes: int


def grouping_report(
    inputs: GroupingInputs, trace: GroupingTrace, intersections: list[IntersectionRecord]
) -> GroupingReport:
    graph, adjacency, attachments = inputs.graph, inputs.adjacency, inputs.attachments
    assignments, rings, settings = inputs.assignments, inputs.rings, inputs.settings
    within, standalone, junction_nodes = trace.within, trace.standalone, trace.junction_nodes
    ring_nodes_by_id, free_nodes = trace.ring_nodes_by_id, trace.free_nodes
    merge, crossing_merge, crossing_nodes = trace.merge, trace.crossing_merge, trace.crossing_nodes
    merged = [g for g in merge.groups if len(g) > 1]
    sizes = Counter(str(len(g)) if len(g) < 5 else "5+" for g in merged)
    diameters = np.array([merge.diameters_m[tuple(sorted(g))] for g in merged])
    by_kind = Counter(i.kind for i in intersections)
    signalised = [i for i in intersections if i.kind == KIND_SIGNALISED_JUNCTION]
    cluster_sets = [
        {attachments[k].signal.provisional_cluster_id for k in i.approach_indices} - {None}
        for i in signalised
    ]
    per_cluster: Counter[int] = Counter()
    for clusters in cluster_sets:
        per_cluster.update(c for c in clusters if c is not None)
    all_clusters = {
        a.signal.provisional_cluster_id
        for a in attachments
        if a.signal.node_type == "traffic_signals" and a.signal.provisional_cluster_id is not None
    }
    return GroupingReport(
        settings={
            "assignment_limit_m": settings.assignment_limit_meters,
            "merge_distance_m": settings.merge_distance_meters,
            "merge_max_group_diameter_m": settings.merge_max_group_diameter_meters,
            "crossing_merge_distance_m": settings.crossing_merge_distance_meters,
        },
        approaches=len(assignments),
        approaches_within_limit=len(within),
        approaches_standalone_midblock=len(standalone),
        standalone_reasons=dict(Counter(reason for _, reason in standalone)),
        junction_nodes_with_approaches=len(junction_nodes),
        ring_groups=len(ring_nodes_by_id),
        ring_member_nodes=sum(len(n) for n in ring_nodes_by_id.values()),
        free_junction_nodes=len(free_nodes),
        merge_candidate_pairs=merge.candidate_pairs,
        merges_performed=merge.merges,
        merged_groups=len(merged),
        merged_group_size_histogram=dict(sorted(sizes.items())),
        merged_group_diameter_m=(
            {
                "p50": float(np.percentile(diameters, 50)),
                "p90": float(np.percentile(diameters, 90)),
                "max": float(diameters.max()),
            }
            if len(diameters)
            else {}
        ),
        capped_cases=merge.capped,
        capped_cases_if_the_cap_were_m=capped_case_sensitivity(
            graph, adjacency, free_nodes, settings
        ),
        capped_case_details_for_tighter_caps=capped_case_details(
            graph, adjacency, free_nodes, settings
        ),
        pedestrian_crossing_nodes=crossing_nodes,
        crossing_merges_performed=crossing_merge.merges,
        crossing_capped_cases=crossing_merge.capped,
        intersections_signalised_junction=by_kind[KIND_SIGNALISED_JUNCTION],
        intersections_midblock_signal=by_kind[KIND_MIDBLOCK_SIGNAL],
        intersections_pedestrian_crossing=by_kind[KIND_PEDESTRIAN_CROSSING],
        intersections_total=len(intersections),
        approaches_per_intersection=dict(
            sorted(
                Counter(str(len(i.approach_indices)) for i in intersections).items(),
                key=lambda kv: int(kv[0]),
            )
        ),
        best_incident_road_class=dict(
            Counter(best_incident_class(graph, i.nodes) for i in signalised).most_common()
        ),
        rings_tagged=sum(r.source == "junction_tag" for r in rings),
        rings_from_overrides=sum(r.source == "override" for r in rings),
        rings_with_intersections=len(ring_nodes_by_id),
        provisional_clusters=len(all_clusters),
        provisional_clusters_in_several_intersections=sum(c > 1 for c in per_cluster.values()),
        intersections_with_several_provisional_clusters=sum(len(c) > 1 for c in cluster_sets),
    )
