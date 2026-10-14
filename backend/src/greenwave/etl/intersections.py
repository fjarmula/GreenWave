"""T4: build intersections and signal approaches from the T2 signals and the T3 graph.

Decisions applied (2026-10-14):
- Each counted signal approach goes to its nearest junction along the road. An approach farther
  than the assignment limit becomes a standalone mid-block signal.
- A ring is one intersection: every junction node of a ring that has approaches is grouped.
- The remaining junction nodes that have approaches and lie within the merge distance along the
  road are merged, unless the merged group's diameter would exceed the cap (every refusal is
  reported).
- Standalone pedestrian crossings are intersections of kind ``pedestrian_crossing``; crossings
  within the crossing merge distance along the road merge (same diameter cap).
D_v attaches to each signal approach a route crosses, so approaches keep their own delay.
"""

import heapq
import logging
from collections import Counter, defaultdict
from dataclasses import dataclass, field

import networkx as nx
import numpy as np
import polars as pl
from pydantic import BaseModel

from greenwave.etl.config import (
    ASSIGNMENT_LIMIT_METERS,
    CROSSING_MERGE_DISTANCE_METERS,
    MERGE_DISTANCE_METERS,
    MERGE_MAX_GROUP_DIAMETER_METERS,
)
from greenwave.etl.junctions import (
    KIND_MIDBLOCK_SIGNAL,
    KIND_PEDESTRIAN_CROSSING,
    KIND_SIGNALISED_JUNCTION,
    Adjacency,
    Ring,
    coordinate_name,
    format_intersection_id,
    nearest_junctions,
    nearest_of,
    number_rings,
    override_rings,
    street_name_components,
    tagged_rings,
)
from greenwave.etl.network import Attachment
from greenwave.etl.overrides import OverrideFile
from greenwave.etl.street_names import normalise_street_name

logger = logging.getLogger(__name__)

METHOD_NEAREST = "nearest_junction"
METHOD_OVERRIDE_ARM = "override_entry_arm"
METHOD_NONE = "no_junction_reachable"
REASON_BEYOND_LIMIT = "beyond_assignment_limit"
REASON_NO_JUNCTION = "no_junction_reachable"
NAME_SOURCE_STREETS = "osm_street_names"
NAME_SOURCE_COORDINATES = "coordinates"

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
_ROAD_RANK = {"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4,
              "unclassified": 5, "residential": 6, "living_street": 7, "service": 8}  # fmt: skip
_KIND_ORDER = (KIND_SIGNALISED_JUNCTION, KIND_MIDBLOCK_SIGNAL, KIND_PEDESTRIAN_CROSSING)


@dataclass(frozen=True, slots=True)
class GroupingSettings:
    assignment_limit_meters: float = ASSIGNMENT_LIMIT_METERS
    merge_distance_meters: float = MERGE_DISTANCE_METERS
    merge_max_group_diameter_meters: float = MERGE_MAX_GROUP_DIAMETER_METERS
    crossing_merge_distance_meters: float = CROSSING_MERGE_DISTANCE_METERS

    def __post_init__(self) -> None:
        if (
            min(
                self.assignment_limit_meters,
                self.merge_distance_meters,
                self.merge_max_group_diameter_meters,
                self.crossing_merge_distance_meters,
            )
            <= 0
        ):
            raise ValueError(
                "assignment limit, merge distances and diameter cap must be positive (m)"
            )


@dataclass(slots=True)
class Assignment:
    attachment_index: int
    junction_node: str | None
    distance_m: float | None
    method: str


@dataclass(slots=True)
class IntersectionRecord:
    kind: str
    nodes: list[str]
    approach_indices: list[int] = field(default_factory=list)
    ring_id: int | None = None
    intersection_id: str = ""
    representative: str = ""
    lon: float = 0.0
    lat: float = 0.0
    street_names: list[str] = field(default_factory=list)
    name: str = ""
    name_source: str = NAME_SOURCE_COORDINATES


# --- assignment -----------------------------------------------------------------------------


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


# --- merging --------------------------------------------------------------------------------


def reach_within(adjacency: Adjacency, start: str, cutoff: float) -> dict[str, float]:
    """Along-road distance from ``start`` to every node within ``cutoff`` metres."""
    heap = [(0.0, start)]
    settled: dict[str, float] = {}
    while heap:
        distance, node = heapq.heappop(heap)
        if node in settled:
            continue
        settled[node] = distance
        for neighbour, length in adjacency.get(node, []):
            if distance + length <= cutoff and neighbour not in settled:
                heapq.heappush(heap, (distance + length, neighbour))
    return settled


class CappedCase(BaseModel):
    node_a: str
    node_b: str
    lon_a: float
    lat_a: float
    lon_b: float
    lat_b: float
    distance_m: float
    group_a_size: int
    group_b_size: int
    would_be_diameter_m: float | None  # None: some member pair is more than twice the cap apart
    streets_a: list[str]
    streets_b: list[str]


@dataclass(slots=True)
class MergeResult:
    groups: list[list[str]]
    capped: list[CappedCase]
    candidate_pairs: int
    merges: int
    diameters_m: dict[tuple[str, ...], float]


def merge_junction_nodes(
    graph: nx.MultiDiGraph,
    adjacency: Adjacency,
    nodes: list[str],
    merge_distance_meters: float,
    max_diameter_meters: float,
) -> MergeResult:
    """Group nodes within ``merge_distance_meters`` along the road, closest pairs first.

    A merge is refused (and reported) when the group's diameter, the largest along-road distance
    between two members, would exceed ``max_diameter_meters``.
    """
    node_set = set(nodes)
    # Search twice the cap so a refused merge can report its real would-be diameter.
    cutoff = max(merge_distance_meters, 2 * max_diameter_meters)
    reach = {node: reach_within(adjacency, node, cutoff) for node in sorted(node_set)}
    pairs = sorted(
        (distance, a, b)
        for a in reach
        for b, distance in reach[a].items()
        if a < b and b in node_set and distance <= merge_distance_meters
    )
    members: dict[str, list[str]] = {node: [node] for node in node_set}
    diameter: dict[str, float] = {node: 0.0 for node in node_set}
    parent = {node: node for node in node_set}

    def find(item: str) -> str:
        while parent[item] != item:
            parent[item] = parent[parent[item]]
            item = parent[item]
        return item

    capped: list[CappedCase] = []
    refused: set[tuple[tuple[str, ...], tuple[str, ...]]] = set()
    merges = 0
    for distance, a, b in pairs:
        root_a, root_b = find(a), find(b)
        if root_a == root_b:
            continue
        cross = max(reach[x].get(y, float("inf")) for x in members[root_a] for y in members[root_b])
        would_be = max(diameter[root_a], diameter[root_b], cross)
        if would_be > max_diameter_meters:
            first, second = sorted((tuple(sorted(members[root_a])), tuple(sorted(members[root_b]))))
            key = (first, second)
            if key not in refused:
                refused.add(key)
                capped.append(
                    CappedCase(
                        node_a=a,
                        node_b=b,
                        lon_a=graph.nodes[a]["lon"],
                        lat_a=graph.nodes[a]["lat"],
                        lon_b=graph.nodes[b]["lon"],
                        lat_b=graph.nodes[b]["lat"],
                        distance_m=distance,
                        group_a_size=len(members[root_a]),
                        group_b_size=len(members[root_b]),
                        would_be_diameter_m=None if would_be == float("inf") else would_be,
                        streets_a=street_name_components(graph, members[root_a]),
                        streets_b=street_name_components(graph, members[root_b]),
                    )
                )
            continue
        keep, drop = sorted((root_a, root_b))
        parent[drop] = keep
        members[keep] += members.pop(drop)
        diameter[keep] = would_be
        diameter.pop(drop)
        merges += 1

    groups = sorted((sorted(m) for m in members.values()), key=lambda g: g[0])
    diameters = {tuple(sorted(members[root])): diameter[root] for root in members}
    return MergeResult(groups, capped, len(pairs), merges, diameters)


_CAP_SENSITIVITY_METERS = (30.0, 40.0, 50.0, 60.0, 80.0)


def capped_case_sensitivity(
    graph: nx.MultiDiGraph,
    adjacency: Adjacency,
    nodes: list[str],
    settings: GroupingSettings,
) -> dict[str, int]:
    """How many merges would be refused under other diameter caps (diagnostic)."""
    return {
        f"{cap:g}": len(
            merge_junction_nodes(
                graph, adjacency, nodes, settings.merge_distance_meters, cap
            ).capped
        )
        for cap in _CAP_SENSITIVITY_METERS
    }


_CAP_DETAIL_METERS = (50.0,)


def capped_case_details(
    graph: nx.MultiDiGraph,
    adjacency: Adjacency,
    nodes: list[str],
    settings: GroupingSettings,
) -> dict[str, list[CappedCase]]:
    """The refused merges under tighter caps than the configured one, for review."""
    return {
        f"{cap:g}": merge_junction_nodes(
            graph, adjacency, nodes, settings.merge_distance_meters, cap
        ).capped
        for cap in _CAP_DETAIL_METERS
        if cap < settings.merge_max_group_diameter_meters
    }


# --- grouping -------------------------------------------------------------------------------


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


def best_incident_class(graph: nx.MultiDiGraph, nodes: str | list[str]) -> str:
    """Most important road class at the node(s); links count as their parent class."""
    node_list = [nodes] if isinstance(nodes, str) else nodes
    classes = {
        data["highway"].removesuffix("_link")
        for node in node_list
        for _, _, data in [*graph.in_edges(node, data=True), *graph.out_edges(node, data=True)]
    }
    return min(classes, key=lambda c: _ROAD_RANK.get(c, 9)) if classes else "none"


def _centroid(graph: nx.MultiDiGraph, nodes: list[str]) -> tuple[float, float, str]:
    """Mean lon/lat of the nodes and the member node closest to the metric-CRS centroid."""
    xs = np.array([graph.nodes[n]["x_m"] for n in nodes])
    ys = np.array([graph.nodes[n]["y_m"] for n in nodes])
    nearest = nodes[int(np.argmin(np.hypot(xs - xs.mean(), ys - ys.mean())))]
    lon = float(np.mean([graph.nodes[n]["lon"] for n in nodes]))
    lat = float(np.mean([graph.nodes[n]["lat"] for n in nodes]))
    return lon, lat, nearest


def build_intersections(
    graph: nx.MultiDiGraph,
    adjacency: Adjacency,
    attachments: list[Attachment],
    assignments: list[Assignment],
    rings: list[Ring],
    settings: GroupingSettings | None = None,
) -> tuple[list[IntersectionRecord], GroupingReport]:
    settings = settings or GroupingSettings()
    ring_of_node: dict[str, int] = {}
    for ring in rings:
        for node in ring.nodes:
            ring_of_node.setdefault(node, ring.ring_id)

    within: list[Assignment] = []
    standalone: list[tuple[Assignment, str]] = []
    for assignment in assignments:
        if assignment.junction_node is None:
            standalone.append((assignment, REASON_NO_JUNCTION))
        elif (assignment.distance_m or 0.0) > settings.assignment_limit_meters:
            standalone.append((assignment, REASON_BEYOND_LIMIT))
        else:
            within.append(assignment)

    approaches_at: dict[str, list[int]] = defaultdict(list)
    for assignment in within:
        approaches_at[assignment.junction_node or ""].append(assignment.attachment_index)
    junction_nodes = sorted(approaches_at)

    records: list[IntersectionRecord] = []
    ring_nodes_by_id: dict[int, list[str]] = defaultdict(list)
    free_nodes: list[str] = []
    for node in junction_nodes:
        if node in ring_of_node:
            ring_nodes_by_id[ring_of_node[node]].append(node)
        else:
            free_nodes.append(node)
    for ring_id, nodes in sorted(ring_nodes_by_id.items()):
        records.append(
            IntersectionRecord(
                KIND_SIGNALISED_JUNCTION,
                nodes,
                [i for n in nodes for i in approaches_at[n]],
                ring_id=ring_id,
            )
        )

    merge = merge_junction_nodes(
        graph,
        adjacency,
        free_nodes,
        settings.merge_distance_meters,
        settings.merge_max_group_diameter_meters,
    )
    for group in merge.groups:
        records.append(
            IntersectionRecord(
                KIND_SIGNALISED_JUNCTION, group, [i for n in group for i in approaches_at[n]]
            )
        )

    midblock: dict[str, IntersectionRecord] = {}
    for assignment, _ in standalone:
        node = attachments[assignment.attachment_index].graph_node or ""
        record = midblock.setdefault(node, IntersectionRecord(KIND_MIDBLOCK_SIGNAL, [node]))
        record.approach_indices.append(assignment.attachment_index)
    crossing_approaches: dict[str, list[int]] = defaultdict(list)
    for index, attachment in enumerate(attachments):
        if attachment.graph_node is None or attachment.signal.node_type != "pedestrian_crossing":
            continue
        crossing_approaches[attachment.graph_node].append(index)
    crossing_merge = merge_junction_nodes(
        graph,
        adjacency,
        sorted(crossing_approaches),
        settings.crossing_merge_distance_meters,
        settings.merge_max_group_diameter_meters,
    )
    for group in crossing_merge.groups:
        records.append(
            IntersectionRecord(
                KIND_PEDESTRIAN_CROSSING, group, [i for n in group for i in crossing_approaches[n]]
            )
        )
    records.extend(midblock.values())

    ring_by_id = {ring.ring_id: ring for ring in rings}
    for record in records:
        record.lon, record.lat, record.representative = _centroid(graph, record.nodes)
    ordered = sorted(
        records, key=lambda r: (_KIND_ORDER.index(r.kind), round(r.lat, 9), round(r.lon, 9))
    )
    for index, record in enumerate(ordered, start=1):
        record.intersection_id = format_intersection_id(index, len(ordered))
        names = street_name_components(graph, record.nodes)
        named_ring = ring_by_id.get(record.ring_id) if record.ring_id is not None else None
        if named_ring is not None and named_ring.name:
            ring_key = normalise_street_name(named_ring.name)
            others = (n for n in names if normalise_street_name(n) != ring_key)
            names = [named_ring.name, *others][:3]
        record.street_names = names
        if names:
            record.name, record.name_source = " / ".join(names), NAME_SOURCE_STREETS
        else:
            record.name = coordinate_name(record.lat, record.lon)
            record.name_source = NAME_SOURCE_COORDINATES

    report = _grouping_report(
        graph, adjacency, attachments, assignments, within, standalone, junction_nodes,
        ring_nodes_by_id, free_nodes, merge, crossing_merge, len(crossing_approaches), ordered,
        rings, settings,
    )  # fmt: skip
    return ordered, report


def _grouping_report(
    graph: nx.MultiDiGraph,
    adjacency: Adjacency,
    attachments: list[Attachment],
    assignments: list[Assignment],
    within: list[Assignment],
    standalone: list[tuple[Assignment, str]],
    junction_nodes: list[str],
    ring_nodes_by_id: dict[int, list[str]],
    free_nodes: list[str],
    merge: MergeResult,
    crossing_merge: MergeResult,
    crossing_nodes: int,
    intersections: list[IntersectionRecord],
    rings: list[Ring],
    settings: GroupingSettings,
) -> GroupingReport:
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


# --- reports and frames -----------------------------------------------------------------------


class NameReport(BaseModel):
    by_source: dict[str, int]
    single_street_intersections: int
    components_total: int
    components_found_in_ulice: int
    share_found_in_ulice: float
    intersections_with_every_component_in_ulice: int
    intersections_with_streets: int
    components_not_in_ulice: dict[str, int]


def name_report(intersections: list[IntersectionRecord], ulice_names: set[str]) -> NameReport:
    with_streets = [i for i in intersections if i.street_names]
    flags = [
        [normalise_street_name(n) in ulice_names for n in i.street_names] for i in with_streets
    ]
    missing: Counter[str] = Counter(
        name
        for record, record_flags in zip(with_streets, flags, strict=True)
        for name, found in zip(record.street_names, record_flags, strict=True)
        if not found
    )
    total = sum(len(f) for f in flags)
    found = sum(sum(f) for f in flags)
    return NameReport(
        by_source=dict(Counter(i.name_source for i in intersections)),
        single_street_intersections=sum(len(i.street_names) == 1 for i in intersections),
        components_total=total,
        components_found_in_ulice=found,
        share_found_in_ulice=found / total if total else 0.0,
        intersections_with_every_component_in_ulice=sum(all(f) for f in flags),
        intersections_with_streets=len(with_streets),
        components_not_in_ulice=dict(missing.most_common(30)),
    )


def intersection_index(intersections: list[IntersectionRecord]) -> dict[int, str]:
    """Attachment index -> intersection id."""
    return {i: record.intersection_id for record in intersections for i in record.approach_indices}


def prepare_rings(graph: nx.MultiDiGraph, overrides: OverrideFile) -> tuple[list[Ring], list[str]]:
    tagged = tagged_rings(graph)
    from_overrides, problems = override_rings(graph, overrides, tagged)
    rings = [*tagged, *from_overrides]
    number_rings(rings)
    return rings, problems


def intersection_frame(
    graph: nx.MultiDiGraph,
    intersections: list[IntersectionRecord],
    attachments: list[Attachment],
    rings: list[Ring],
    ulice_names: set[str],
    reachable_nodes: set[str],
) -> pl.DataFrame:
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
