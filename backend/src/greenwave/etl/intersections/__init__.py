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
D_v (per type via config) is applied once per unique intersection INT-xxxx whose controlled
approach the route passes; a route crossing two approaches of one intersection pays it once. The
delay of an intersection is ``delay_seconds`` in ``intersections.parquet`` (by kind, from config).
``signal_approaches.delay_seconds`` is a property of the signal node and must not be summed along a
route.
"""

from greenwave.etl.intersections.assignment import (
    AssignmentDistribution,
    assign_approaches,
    distance_distribution,
)
from greenwave.etl.intersections.frames import (
    approach_frame,
    intersection_frame,
    kind_delay_seconds,
)
from greenwave.etl.intersections.grouping import (
    build_intersections,
    intersection_index,
    prepare_rings,
)
from greenwave.etl.intersections.grouping_report import GroupingReport
from greenwave.etl.intersections.merge import (
    CappedCase,
    MergeResult,
    capped_case_details,
    capped_case_sensitivity,
    merge_junction_nodes,
    reach_within,
)
from greenwave.etl.intersections.model import (
    METHOD_NEAREST,
    METHOD_NONE,
    METHOD_OVERRIDE_ARM,
    NAME_SOURCE_COORDINATES,
    NAME_SOURCE_STREETS,
    REASON_BEYOND_LIMIT,
    REASON_NO_JUNCTION,
    Assignment,
    GroupingSettings,
    IntersectionRecord,
)
from greenwave.etl.intersections.naming import NameReport, name_report
from greenwave.etl.intersections.node_queries import best_incident_class

__all__ = [
    "METHOD_NEAREST",
    "METHOD_NONE",
    "METHOD_OVERRIDE_ARM",
    "NAME_SOURCE_COORDINATES",
    "NAME_SOURCE_STREETS",
    "REASON_BEYOND_LIMIT",
    "REASON_NO_JUNCTION",
    "Assignment",
    "AssignmentDistribution",
    "CappedCase",
    "GroupingReport",
    "GroupingSettings",
    "IntersectionRecord",
    "MergeResult",
    "NameReport",
    "approach_frame",
    "assign_approaches",
    "best_incident_class",
    "build_intersections",
    "capped_case_details",
    "capped_case_sensitivity",
    "distance_distribution",
    "intersection_frame",
    "intersection_index",
    "kind_delay_seconds",
    "merge_junction_nodes",
    "name_report",
    "prepare_rings",
    "reach_within",
]
