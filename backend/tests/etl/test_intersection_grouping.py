import networkx as nx

from greenwave.etl.intersections import (
    NAME_SOURCE_COORDINATES,
    NAME_SOURCE_STREETS,
    REASON_BEYOND_LIMIT,
    REASON_NO_JUNCTION,
    Assignment,
    IntersectionRecord,
)
from greenwave.etl.intersections.grouping import partition_by_limit
from greenwave.etl.intersections.naming import assign_names
from greenwave.etl.junctions import KIND_SIGNALISED_JUNCTION, Ring, coordinate_name


def test_partition_by_limit_names_each_standalone_reason() -> None:
    no_junction = Assignment(0, None, None, "no_junction_reachable")
    too_far = Assignment(1, "n1", 60.0, "nearest_junction")
    at_limit = Assignment(2, "n2", 50.0, "nearest_junction")
    no_distance = Assignment(3, "n3", None, "nearest_junction")

    within, standalone = partition_by_limit([no_junction, too_far, at_limit, no_distance], 50.0)

    assert within == [at_limit, no_distance]
    assert standalone == [(no_junction, REASON_NO_JUNCTION), (too_far, REASON_BEYOND_LIMIT)]


def _star(names: list[str]) -> nx.MultiDiGraph:
    graph = nx.MultiDiGraph()
    graph.add_node("c")
    for index, name in enumerate(names):
        graph.add_edge("c", f"n{index}", name=name, highway="primary", length_m=40.0 - 10 * index)
    return graph


def test_ring_name_leads_and_duplicates_drop() -> None:
    record = IntersectionRecord(KIND_SIGNALISED_JUNCTION, ["c"], ring_id=1, lat=50.0, lon=19.9)
    ring = Ring(1, "override", "Rondo X", set(), {"c"})

    assign_names(record, _star(["Rondo X", "A", "B", "C"]), ring)

    assert record.street_names == ["Rondo X", "A", "B"]
    assert record.name == "Rondo X / A / B"
    assert record.name_source == NAME_SOURCE_STREETS


def test_unnamed_intersection_is_named_by_its_coordinates() -> None:
    record = IntersectionRecord(KIND_SIGNALISED_JUNCTION, ["c"], lat=50.0, lon=19.9)

    assign_names(record, _star([]), None)

    assert record.name == coordinate_name(50.0, 19.9)
    assert record.name_source == NAME_SOURCE_COORDINATES
