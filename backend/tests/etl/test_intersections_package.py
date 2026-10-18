import greenwave.etl.intersections as intersections

PUBLIC_NAMES = (
    "AssignmentDistribution", "Assignment", "CappedCase", "GroupingReport", "GroupingSettings",
    "IntersectionRecord", "MergeResult", "NameReport", "METHOD_NEAREST", "METHOD_OVERRIDE_ARM",
    "METHOD_NONE", "REASON_BEYOND_LIMIT", "REASON_NO_JUNCTION", "NAME_SOURCE_STREETS",
    "NAME_SOURCE_COORDINATES", "approach_frame", "assign_approaches", "best_incident_class",
    "build_intersections", "capped_case_details", "capped_case_sensitivity",
    "distance_distribution", "intersection_frame", "intersection_index", "kind_delay_seconds",
    "merge_junction_nodes", "name_report", "prepare_rings", "reach_within",
)  # fmt: skip


def test_public_names_stay_importable_from_the_package() -> None:
    missing = [name for name in PUBLIC_NAMES if not hasattr(intersections, name)]

    assert missing == []
    assert sorted(intersections.__all__) == sorted(PUBLIC_NAMES)


def test_submodules_own_their_parts() -> None:
    from greenwave.etl.intersections.grouping import build_intersections
    from greenwave.etl.intersections.merge import merge_junction_nodes

    assert build_intersections is intersections.build_intersections
    assert merge_junction_nodes is intersections.merge_junction_nodes
