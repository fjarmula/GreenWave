"""Group assigned approaches into intersections: rings, merges, crossings, mid-block."""

from collections import defaultdict

import networkx as nx

from greenwave.etl.intersections.grouping_report import (
    GroupingInputs,
    GroupingReport,
    GroupingTrace,
    grouping_report,
)
from greenwave.etl.intersections.merge import MergeResult, merge_junction_nodes
from greenwave.etl.intersections.model import (
    REASON_BEYOND_LIMIT,
    REASON_NO_JUNCTION,
    Assignment,
    GroupingSettings,
    IntersectionRecord,
)
from greenwave.etl.intersections.naming import assign_names
from greenwave.etl.intersections.node_queries import centroid
from greenwave.etl.junctions import (
    KIND_MIDBLOCK_SIGNAL,
    KIND_PEDESTRIAN_CROSSING,
    KIND_SIGNALISED_JUNCTION,
    Adjacency,
    Ring,
    format_intersection_id,
    number_rings,
    override_rings,
    tagged_rings,
)
from greenwave.etl.network import Attachment
from greenwave.etl.overrides import OverrideFile

_KIND_ORDER = (KIND_SIGNALISED_JUNCTION, KIND_MIDBLOCK_SIGNAL, KIND_PEDESTRIAN_CROSSING)


def build_intersections(
    graph: nx.MultiDiGraph,
    adjacency: Adjacency,
    attachments: list[Attachment],
    assignments: list[Assignment],
    rings: list[Ring],
    settings: GroupingSettings | None = None,
) -> tuple[list[IntersectionRecord], GroupingReport]:
    inputs = GroupingInputs(
        graph, adjacency, attachments, assignments, rings, settings or GroupingSettings()
    )
    within, standalone = partition_by_limit(assignments, inputs.settings.assignment_limit_meters)
    approaches_at: dict[str, list[int]] = defaultdict(list)
    for assignment in within:
        approaches_at[assignment.junction_node or ""].append(assignment.attachment_index)
    junction_nodes = sorted(approaches_at)
    ring_nodes_by_id, free_nodes = _split_ring_nodes(junction_nodes, rings)

    records = _ring_records(ring_nodes_by_id, approaches_at)
    merge = merge_junction_nodes(
        graph,
        adjacency,
        free_nodes,
        inputs.settings.merge_distance_meters,
        inputs.settings.merge_max_group_diameter_meters,
    )
    records += _grouped_records(KIND_SIGNALISED_JUNCTION, merge, approaches_at)
    midblock = _midblock_records(standalone, attachments)
    crossing_approaches = _crossing_approaches(attachments)
    crossing_merge = merge_junction_nodes(
        graph,
        adjacency,
        sorted(crossing_approaches),
        inputs.settings.crossing_merge_distance_meters,
        inputs.settings.merge_max_group_diameter_meters,
    )
    records += _grouped_records(KIND_PEDESTRIAN_CROSSING, crossing_merge, crossing_approaches)
    records += midblock

    ordered = _number_and_name(records, graph, rings)
    trace = GroupingTrace(
        within=within,
        standalone=standalone,
        junction_nodes=junction_nodes,
        ring_nodes_by_id=ring_nodes_by_id,
        free_nodes=free_nodes,
        merge=merge,
        crossing_merge=crossing_merge,
        crossing_nodes=len(crossing_approaches),
    )
    return ordered, grouping_report(inputs, trace, ordered)


def partition_by_limit(
    assignments: list[Assignment], limit_meters: float
) -> tuple[list[Assignment], list[tuple[Assignment, str]]]:
    """Approaches within the limit of their junction; the others with why they stand alone."""
    within: list[Assignment] = []
    standalone: list[tuple[Assignment, str]] = []
    for assignment in assignments:
        if assignment.junction_node is None:
            standalone.append((assignment, REASON_NO_JUNCTION))
        elif (assignment.distance_m or 0.0) > limit_meters:
            standalone.append((assignment, REASON_BEYOND_LIMIT))
        else:
            within.append(assignment)
    return within, standalone


def _split_ring_nodes(
    junction_nodes: list[str], rings: list[Ring]
) -> tuple[dict[int, list[str]], list[str]]:
    """Junction nodes on a ring (grouped by ring id, first ring wins) and the free ones."""
    ring_of_node: dict[str, int] = {}
    for ring in rings:
        for node in ring.nodes:
            ring_of_node.setdefault(node, ring.ring_id)
    ring_nodes_by_id: dict[int, list[str]] = defaultdict(list)
    free_nodes: list[str] = []
    for node in junction_nodes:
        if node in ring_of_node:
            ring_nodes_by_id[ring_of_node[node]].append(node)
        else:
            free_nodes.append(node)
    return ring_nodes_by_id, free_nodes


def _ring_records(
    ring_nodes_by_id: dict[int, list[str]], approaches_at: dict[str, list[int]]
) -> list[IntersectionRecord]:
    return [
        IntersectionRecord(
            KIND_SIGNALISED_JUNCTION,
            nodes,
            [i for n in nodes for i in approaches_at[n]],
            ring_id=ring_id,
        )
        for ring_id, nodes in sorted(ring_nodes_by_id.items())
    ]


def _grouped_records(
    kind: str, merge: MergeResult, approaches_at: dict[str, list[int]]
) -> list[IntersectionRecord]:
    return [
        IntersectionRecord(kind, group, [i for n in group for i in approaches_at[n]])
        for group in merge.groups
    ]


def _midblock_records(
    standalone: list[tuple[Assignment, str]], attachments: list[Attachment]
) -> list[IntersectionRecord]:
    """One mid-block signal per graph node that holds standalone approaches."""
    midblock: dict[str, IntersectionRecord] = {}
    for assignment, _ in standalone:
        node = attachments[assignment.attachment_index].graph_node or ""
        record = midblock.setdefault(node, IntersectionRecord(KIND_MIDBLOCK_SIGNAL, [node]))
        record.approach_indices.append(assignment.attachment_index)
    return list(midblock.values())


def _crossing_approaches(attachments: list[Attachment]) -> dict[str, list[int]]:
    crossing_approaches: dict[str, list[int]] = defaultdict(list)
    for index, attachment in enumerate(attachments):
        if attachment.graph_node is None or attachment.signal.node_type != "pedestrian_crossing":
            continue
        crossing_approaches[attachment.graph_node].append(index)
    return crossing_approaches


def _number_and_name(
    records: list[IntersectionRecord], graph: nx.MultiDiGraph, rings: list[Ring]
) -> list[IntersectionRecord]:
    """Place, order (kind, then latitude, then longitude), number and name every record."""
    for record in records:
        record.lon, record.lat, record.representative = centroid(graph, record.nodes)
    ordered = sorted(
        records, key=lambda r: (_KIND_ORDER.index(r.kind), round(r.lat, 9), round(r.lon, 9))
    )
    ring_by_id = {ring.ring_id: ring for ring in rings}
    for index, record in enumerate(ordered, start=1):
        record.intersection_id = format_intersection_id(index, len(ordered))
        ring = ring_by_id.get(record.ring_id) if record.ring_id is not None else None
        assign_names(record, graph, ring)
    return ordered


def intersection_index(intersections: list[IntersectionRecord]) -> dict[int, str]:
    """Attachment index -> intersection id."""
    return {i: record.intersection_id for record in intersections for i in record.approach_indices}


def prepare_rings(graph: nx.MultiDiGraph, overrides: OverrideFile) -> tuple[list[Ring], list[str]]:
    tagged = tagged_rings(graph)
    from_overrides, problems = override_rings(graph, overrides, tagged)
    rings = [*tagged, *from_overrides]
    number_rings(rings)
    return rings, problems
