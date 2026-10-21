import networkx as nx
import numpy as np
import polars as pl
import pytest

from greenwave.etl.config import (
    MIDBLOCK_SIGNAL_DELAY_SECONDS,
    PEDESTRIAN_CROSSING_DELAY_SECONDS,
    SIGNAL_DELAY_SECONDS,
)
from greenwave.etl.geo import project_points
from greenwave.etl.graph import build_graph, node_key
from greenwave.etl.intersections import (
    GroupingSettings,
    approach_frame,
    assign_approaches,
    best_incident_class,
    build_intersections,
    distance_distribution,
    intersection_frame,
    intersection_index,
    kind_delay_seconds,
    merge_junction_nodes,
    name_report,
    prepare_rings,
    reach_within,
)
from greenwave.etl.junctions import find_junction_nodes, undirected_adjacency
from greenwave.etl.network import Attachment, SignalPoint, attach_signals
from greenwave.etl.overrides import OverrideFile, RoundaboutOverride
from greenwave.etl.profile_osm import DrivableWay, LonLat

STEP = 0.001  # about 71 m east-west


def at(x: float, y: float) -> LonLat:
    return round(19.9 + x * STEP, 7), round(50.0 + y * STEP, 7)


def way(line: int, points: list[LonLat], highway: str = "residential", **tags: str) -> DrivableWay:
    return DrivableWay(line, highway, points, dict(tags))


def signal(
    point: LonLat, key: str, node_type: str = "traffic_signals", cluster: int | None = None
) -> SignalPoint:
    x, y = project_points(np.array([point[0]]), np.array([point[1]]))[0]
    return SignalPoint(key, node_type, point[0], point[1], float(x), float(y), None, 35.0, cluster)


def run(  # type: ignore[no-untyped-def]
    ways: list[DrivableWay],
    signals: list[SignalPoint],
    overrides: OverrideFile | None = None,
    settings: GroupingSettings | None = None,
):
    attached = attach_signals(build_graph(ways).graph, signals, 30.0)
    graph = attached.graph
    adjacency = undirected_adjacency(graph)
    junctions = find_junction_nodes(adjacency)
    rings, problems = prepare_rings(graph, overrides or OverrideFile())
    assignments = assign_approaches(attached.attachments, adjacency, junctions, rings, graph)
    intersections, report = build_intersections(
        graph, adjacency, attached.attachments, assignments, rings, settings
    )
    return attached, adjacency, rings, problems, assignments, intersections, report


def two_junction_ways() -> list[DrivableWay]:
    # A main road crossed by two streets at x=2 (junction A) and x=6 (junction B).
    return [
        way(
            1,
            [at(0, 0), at(1, 0), at(2, 0), at(4, 0), at(6, 0), at(7, 0)],
            "primary",
            name="Aleja Testowa",
        ),
        way(2, [at(2, -2), at(2, 0), at(2, 2)], name="Poprzeczna"),
        way(3, [at(6, -2), at(6, 0), at(6, 2)]),  # unnamed
    ]


# --- assignment and the 50 m limit ------------------------------------------------------------


def test_each_approach_goes_to_its_nearest_junction_along_the_road() -> None:
    # Half a step is about 36 m: inside the 50 m limit.
    signals = [signal(at(1.5, 0), "OSM-L10"), signal(at(5.5, 0), "OSM-L11")]

    attached, _, _, _, assignments, intersections, _ = run(two_junction_ways(), signals)

    by_signal = {attached.attachments[a.attachment_index].signal.node_key: a for a in assignments}
    assert by_signal["OSM-L10"].junction_node == node_key(*at(2, 0))
    assert by_signal["OSM-L11"].junction_node == node_key(*at(6, 0))
    assert by_signal["OSM-L10"].distance_m == pytest.approx(35.7, rel=0.03)
    assert [i.kind for i in intersections] == ["signalised_junction"] * 2


def test_an_approach_beyond_the_limit_becomes_a_standalone_midblock_signal() -> None:
    near = signal(at(1.5, 0), "OSM-L10")  # ~36 m from junction A
    far = signal(at(4, 0), "OSM-L11")  # ~143 m from A and from B

    attached, _, _, _, _, intersections, report = run(two_junction_ways(), [near, far])

    kinds = {i.intersection_id: i.kind for i in intersections}
    assert sorted(kinds.values()) == ["midblock_signal", "signalised_junction"]
    midblock = next(i for i in intersections if i.kind == "midblock_signal")
    assert midblock.nodes == [attached.attachments[1].graph_node]
    assert report.approaches_standalone_midblock == 1
    assert report.standalone_reasons == {"beyond_assignment_limit": 1}


def test_the_assignment_limit_boundary_is_inclusive() -> None:
    signals = [signal(at(1.5, 0), "OSM-L10")]
    exact = run(two_junction_ways(), signals)[4][0].distance_m
    assert exact is not None

    at_limit = run(
        two_junction_ways(), signals, settings=GroupingSettings(assignment_limit_meters=exact)
    )
    below = run(
        two_junction_ways(),
        signals,
        settings=GroupingSettings(assignment_limit_meters=exact - 1e-6),
    )

    assert at_limit[-1].approaches_within_limit == 1
    assert below[-1].approaches_within_limit == 0


def test_a_signal_on_the_junction_node_has_distance_zero() -> None:
    attached, _, _, _, assignments, _, _ = run(two_junction_ways(), [signal(at(2, 0), "OSM-L10")])

    assert assignments[0].distance_m == 0.0
    assert attached.attachments[0].snap_kind == "graph_node"


@pytest.mark.parametrize(
    "kwargs",
    [
        {"assignment_limit_meters": 0.0},
        {"merge_distance_meters": -1.0},
        {"merge_max_group_diameter_meters": 0.0},
    ],
)
def test_invalid_grouping_settings_are_rejected(kwargs: dict[str, float]) -> None:
    with pytest.raises(ValueError, match="positive"):
        GroupingSettings(**kwargs)


# --- merging junction nodes -------------------------------------------------------------------


def _chain(
    distances: list[float],
) -> tuple[nx.MultiDiGraph, dict[str, list[tuple[str, float]]], list[str]]:
    """Nodes n0, n1, ... along a line with the given gaps (metres); no edges needed for names."""
    graph: nx.MultiDiGraph = nx.MultiDiGraph()
    names = [f"n{i}" for i in range(len(distances) + 1)]
    adjacency: dict[str, list[tuple[str, float]]] = {n: [] for n in names}
    for i, name in enumerate(names):
        graph.add_node(name, lon=19.9 + i * 0.0001, lat=50.0)
    for i, gap in enumerate(distances):
        adjacency[names[i]].append((names[i + 1], gap))
        adjacency[names[i + 1]].append((names[i], gap))
    return graph, adjacency, names


def test_nodes_within_the_merge_distance_merge_and_farther_ones_do_not() -> None:
    graph, adjacency, names = _chain([30.0, 30.0001, 10.0])

    result = merge_junction_nodes(graph, adjacency, names, 30.0, 200.0)

    assert result.groups == [["n0", "n1"], ["n2", "n3"]]  # 30.0001 m is just beyond
    assert result.merges == 2 and result.capped == []


def test_a_chain_merges_transitively_when_the_diameter_allows() -> None:
    graph, adjacency, names = _chain([25.0, 25.0])

    result = merge_junction_nodes(graph, adjacency, names, 30.0, 60.0)

    assert result.groups == [["n0", "n1", "n2"]]
    assert result.diameters_m[("n0", "n1", "n2")] == pytest.approx(50.0)


def test_the_diameter_cap_refuses_the_merge_and_reports_the_case() -> None:
    graph, adjacency, names = _chain([25.0, 25.0])  # ends are 50 m apart

    result = merge_junction_nodes(graph, adjacency, names, 30.0, 40.0)

    assert result.groups == [["n0", "n1"], ["n2"]]
    (case,) = result.capped
    assert case.distance_m == 25.0
    assert case.would_be_diameter_m == pytest.approx(50.0)
    assert {case.group_a_size, case.group_b_size} == {1, 2}


def test_the_cap_boundary_is_inclusive() -> None:
    graph, adjacency, names = _chain([25.0, 25.0])

    assert merge_junction_nodes(graph, adjacency, names, 30.0, 50.0).capped == []
    assert len(merge_junction_nodes(graph, adjacency, names, 30.0, 50.0 - 1e-6).capped) == 1


def test_closest_pairs_merge_first_and_the_result_is_deterministic() -> None:
    graph, adjacency, names = _chain([29.0, 20.0, 29.0])

    first = merge_junction_nodes(graph, adjacency, names, 30.0, 45.0)
    again = merge_junction_nodes(graph, adjacency, list(reversed(names)), 30.0, 45.0)

    # The 20 m pair merges first; the two 29 m pairs would then span 49 m, beyond the 45 m cap.
    assert first.groups == again.groups == [["n0"], ["n1", "n2"], ["n3"]]
    assert [case.would_be_diameter_m for case in first.capped] == [pytest.approx(49.0)] * 2


def test_a_chain_cut_by_the_cap_reports_the_real_would_be_diameter() -> None:
    graph, adjacency, names = _chain([10.0, 10.0, 10.0])

    result = merge_junction_nodes(graph, adjacency, names, 10.0, 15.0)

    assert result.groups == [["n0", "n1"], ["n2", "n3"]]
    (case,) = result.capped
    assert case.would_be_diameter_m == pytest.approx(20.0)


# --- grouping on a network --------------------------------------------------------------------


def test_close_junctions_with_signals_merge_into_one_intersection() -> None:
    # Junctions at x = 0.4, 0.8 and 1.4 along the main road: gaps of ~28.6 m and ~42.8 m.
    ways = [
        way(1, [at(0, 0), at(0.4, 0), at(0.8, 0), at(1.4, 0), at(2, 0)], "primary", name="Aleja"),
        way(2, [at(0.4, -1), at(0.4, 0), at(0.4, 1)], name="Pierwsza"),
        way(3, [at(0.8, -1), at(0.8, 0), at(0.8, 1)], name="Druga"),
        way(4, [at(1.4, -1), at(1.4, 0), at(1.4, 1)], name="Trzecia"),
    ]
    signals = [
        signal(at(0.4, 0), "OSM-L10"),
        signal(at(0.8, 0), "OSM-L11"),
        signal(at(1.4, 0), "OSM-L12"),
    ]

    *_, intersections, report = run(ways, signals)

    assert sorted(len(i.nodes) for i in intersections) == [1, 2]  # 28.6 m merges, 42.8 m does not
    assert report.merges_performed == 1
    merged = next(i for i in intersections if len(i.nodes) == 2)
    assert len(merged.approach_indices) == 2
    assert merged.street_names[0] == "Aleja"


def four_corner_ring(name: str | None = None, first_line: int = 10) -> list[DrivableWay]:
    corners = [at(0, 0), at(1, 0), at(1, 1), at(0, 1)]
    tags = {"oneway": "yes", **({"name": name} if name else {"junction": "roundabout"})}
    quarters = [
        way(first_line + i, [corners[i], corners[(i + 1) % 4]], "primary", **tags) for i in range(4)
    ]
    west_arm = way(first_line + 4, [at(0, 0), at(-1, 0), at(-3, 0)], "primary", name="Zachodnia")
    east_arm = way(first_line + 5, [at(1, 1), at(2, 1), at(4, 1)], "primary", name="Polnocna")
    return [*quarters, west_arm, east_arm]


def test_a_ring_is_one_intersection_with_all_its_approaches() -> None:
    signals = [
        signal(at(-0.5, 0), "OSM-L30", cluster=0),  # on the west arm, next to ring node (0,0)
        signal(at(1.5, 1), "OSM-L31", cluster=1),  # on the east arm, next to ring node (1,1)
    ]

    _, _, rings, _, _, intersections, report = run(four_corner_ring(), signals)

    (only,) = intersections
    assert only.ring_id == rings[0].ring_id
    assert len(only.nodes) == 2 and len(only.approach_indices) == 2
    assert report.ring_groups == 1 and report.ring_member_nodes == 2
    assert report.intersections_signalised_junction == 1
    assert report.intersections_with_several_provisional_clusters == 1


def test_a_named_ring_leads_the_intersection_name() -> None:
    ways = four_corner_ring(name="Rondo Brak")
    overrides = OverrideFile(
        entries=[
            RoundaboutOverride(
                name="Rondo Brak", ring_edge_ids=["W10.0+", "W11.0+", "W12.0+", "W13.0+"]
            )
        ]
    )

    *_, intersections, _ = run(ways, [signal(at(-0.5, 0), "OSM-L30")], overrides)

    assert intersections[0].name.startswith("Rondo Brak")
    assert intersections[0].name_source == "osm_street_names"


def test_override_entry_arm_assigns_the_approach_to_the_ring() -> None:
    ways = [
        *four_corner_ring(name="Rondo Brak"),
        way(20, [at(-1, 0), at(-1, 2)], "primary", name="Boczna"),
    ]
    overrides = OverrideFile(
        entries=[
            RoundaboutOverride(
                name="Rondo Brak",
                ring_edge_ids=["W10.0+", "W11.0+", "W12.0+", "W13.0+"],
                entry_arm_edge_ids=["W14.0+", "W14.0-"],
            )
        ]
    )
    point = at(-0.8, 0)  # on the arm, closer to the side street than to the ring

    _, _, rings, problems, assignments, _, _ = run(ways, [signal(point, "OSM-L40")], overrides)
    plain = run(ways, [signal(point, "OSM-L40")])[4]

    assert problems == []
    assert [r.source for r in rings] == ["override"]
    assert plain[0].junction_node == node_key(*at(-1, 0))
    assert assignments[0].method == "override_entry_arm"
    assert assignments[0].junction_node == node_key(*at(0, 0))


# --- ids, names, kinds ------------------------------------------------------------------------


def test_ids_follow_kind_then_position_and_names_are_never_invented() -> None:
    signals = [
        signal(at(5.5, 0), "OSM-L20"),  # junction B (east)
        signal(at(1.5, 0), "OSM-L21"),  # junction A (west)
        signal(at(4, 0), "OSM-L22"),  # ~143 m from both: standalone mid-block
        signal(at(4.2, 0), "OSM-L23", node_type="pedestrian_crossing"),
    ]

    *_, intersections, _ = run(two_junction_ways(), signals)

    assert [(i.intersection_id, i.kind) for i in intersections] == [
        ("INT-0001", "signalised_junction"),
        ("INT-0002", "signalised_junction"),
        ("INT-0003", "midblock_signal"),
        ("INT-0004", "pedestrian_crossing"),
    ]
    first, second, midblock, crossing = intersections
    assert first.name == "Aleja Testowa / Poprzeczna"
    assert second.street_names == ["Aleja Testowa"]  # the cross street has no name
    assert midblock.name == crossing.name == "Aleja Testowa"


def test_a_node_without_any_street_name_falls_back_to_coordinates() -> None:
    ways = [way(1, [at(0, 0), at(2, 0), at(4, 0)]), way(2, [at(2, -2), at(2, 0), at(2, 2)])]

    *_, intersections, _ = run(ways, [signal(at(2, 0), "OSM-L10")])

    (only,) = intersections
    assert (only.name_source, only.name) == ("coordinates", "50.00000, 19.90200")


def test_ids_are_deterministic_for_the_same_input_in_any_signal_order() -> None:
    signals = [signal(at(1.5, 0), "OSM-L1"), signal(at(5.5, 0), "OSM-L2")]

    first = run(two_junction_ways(), signals)[-2]
    second = run(two_junction_ways(), list(reversed(signals)))[-2]

    assert [(i.intersection_id, i.representative) for i in first] == [
        (i.intersection_id, i.representative) for i in second
    ]


def test_distance_distribution_reports_the_histogram_and_the_limit() -> None:
    signals = [
        signal(at(2, 0), "OSM-L50"),
        signal(at(1.5, 0), "OSM-L51"),
        signal(at(4, 0), "OSM-L52"),
    ]

    attached, _, _, _, assignments, intersections, _ = run(two_junction_ways(), signals)
    report = distance_distribution(
        attached.attachments, assignments, intersection_index(intersections)
    )

    assert report.approaches == 3 and report.limit_m == 50.0
    assert report.histogram["0 (at the junction)"] == 1
    assert report.beyond_limit == 1
    assert sum(report.histogram.values()) == 3


def test_best_incident_class_treats_links_as_their_parent_class() -> None:
    graph = build_graph(
        [
            way(1, [at(0, 0), at(2, 0), at(4, 0)], "secondary_link"),
            way(2, [at(2, 0), at(2, 2)], "service"),
        ]
    ).graph

    assert best_incident_class(graph, node_key(*at(2, 0))) == "secondary"
    assert best_incident_class(graph, [node_key(*at(2, 0)), node_key(*at(0, 0))]) == "secondary"


def test_name_report_cross_checks_components_against_ulice() -> None:
    signals = [signal(at(1.5, 0), "OSM-L60"), signal(at(5.5, 0), "OSM-L61")]
    *_, intersections, _ = run(two_junction_ways(), signals)

    report = name_report(intersections, {"aleja testowa"})

    assert report.components_total == 3
    assert report.components_found_in_ulice == 2
    assert report.components_not_in_ulice == {"Poprzeczna": 1}


def test_output_frames_have_stable_schemas_and_roundtrip(tmp_path) -> None:  # type: ignore[no-untyped-def]
    signals = [
        signal(at(1.5, 0), "OSM-L70", cluster=3),
        signal(at(4, 0), "OSM-L71"),  # standalone mid-block
        signal(at(4.2, 0), "OSM-L72", node_type="pedestrian_crossing"),
    ]
    attached, _, rings, _, assignments, intersections, _ = run(two_junction_ways(), signals)
    nodes = set(attached.graph.nodes)

    ix = intersection_frame(
        attached.graph,
        intersections,
        attached.attachments,
        rings,
        {"aleja testowa"},
        nodes,
        _signal_review_frame(attached.attachments),
    )
    ap = approach_frame(attached.attachments, assignments, intersections, nodes)

    for name, frame in (("ix", ix), ("ap", ap)):
        frame.write_parquet(tmp_path / f"{name}.parquet")
        assert pl.read_parquet(tmp_path / f"{name}.parquet").equals(frame)
    assert ix["intersection_id"].to_list() == ["INT-0001", "INT-0002", "INT-0003"]
    assert ix["kind"].to_list() == ["signalised_junction", "midblock_signal", "pedestrian_crossing"]
    rows = {r["signal_key"]: r for r in ap.iter_rows(named=True)}
    assert (
        rows["OSM-L70"]["intersection_id"] == "INT-0001"
        and rows["OSM-L70"]["provisional_cluster_id"] == 3
    )
    assert rows["OSM-L71"]["standalone_reason"] == "beyond_assignment_limit"
    assert rows["OSM-L71"]["intersection_kind"] == "midblock_signal"
    assert rows["OSM-L72"]["intersection_kind"] == "pedestrian_crossing"
    assert rows["OSM-L70"]["controlled_edge_ids"]
    # The map draws simulated phases at these points; they must be the source signal's WGS84 node.
    assert ap.schema["lon"] == pl.Float64 and ap.schema["lat"] == pl.Float64
    assert (rows["OSM-L70"]["lon"], rows["OSM-L70"]["lat"]) == at(1.5, 0)
    assert (rows["OSM-L72"]["lon"], rows["OSM-L72"]["lat"]) == at(4.2, 0)


def test_an_internal_edge_belongs_to_the_intersection_and_its_approaches_join_the_ring() -> None:
    corners = [at(0, 0), at(1, 0), at(1, 1), at(0, 1)]
    quarters = [
        way(10 + i, [corners[i], corners[(i + 1) % 4]], "primary", oneway="yes", name="Rondo Brak")
        for i in range(4)
    ]
    # A one-way bypass between two ring corners, plus an arm west of the ring.
    chord = way(
        20, [at(0, 0), at(0.5, 0.5), at(1, 1)], "primary_link", oneway="yes", name="Rondo Brak"
    )
    arm = way(21, [at(0, 0), at(-1, 0), at(-3, 0)], "primary", name="Zachodnia")
    side = way(22, [at(-1, 0), at(-1, 2)], "primary", name="Boczna")
    overrides = OverrideFile(
        entries=[
            RoundaboutOverride(
                name="Rondo Brak",
                ring_edge_ids=[f"W{10 + i}.0+" for i in range(4)],
                entry_arm_edge_ids=["W21.0+", "W21.0-"],
                internal_edge_ids=["W20.0+"],
            )
        ]
    )
    # A signal on the bypass edge: only the override ties that edge to the ring.
    on_chord = signal(at(0.25, 0.25), "OSM-L50")  # ~33 m along the bypass: inside the 50 m limit

    attached, _, rings, problems, assignments, intersections, _ = run(
        [*quarters, chord, arm, side], [on_chord], overrides
    )
    frame = intersection_frame(
        attached.graph,
        intersections,
        attached.attachments,
        rings,
        set(),
        set(attached.graph.nodes),
        _signal_review_frame(attached.attachments),
    )

    assert problems == []
    assert assignments[0].method == "override_entry_arm"
    row = frame.to_dicts()[0]
    assert row["ring_id"] == rings[0].ring_id
    assert any(edge.startswith("W20.0+") for edge in row["internal_edge_ids"])
    assert not any(edge.startswith("W20.0+") for edge in row["ring_edge_ids"])
    assert set(row["ring_edge_ids"]) <= set(row["internal_edge_ids"])


def test_the_report_lists_the_refused_merges_for_a_tighter_cap() -> None:
    # Junctions at x = 0.4, 0.8, 1.2: gaps of about 28.6 m, so the ends are about 57 m apart.
    ways = [
        way(1, [at(0, 0), at(0.4, 0), at(0.8, 0), at(1.2, 0), at(2, 0)], "primary", name="Aleja"),
        way(2, [at(0.4, -1), at(0.4, 0), at(0.4, 1)], name="Pierwsza"),
        way(3, [at(0.8, -1), at(0.8, 0), at(0.8, 1)], name="Druga"),
        way(4, [at(1.2, -1), at(1.2, 0), at(1.2, 1)], name="Trzecia"),
    ]
    signals = [signal(at(x, 0), f"OSM-L{i}") for i, x in enumerate((0.4, 0.8, 1.2), start=10)]

    *_, merged_report = run(
        ways, signals, settings=GroupingSettings(merge_max_group_diameter_meters=60.0)
    )
    *_, tight_report = run(
        ways, signals, settings=GroupingSettings(merge_max_group_diameter_meters=50.0)
    )

    assert merged_report.intersections_signalised_junction == 1
    assert merged_report.capped_cases == []
    detail = merged_report.capped_case_details_for_tighter_caps["50"]
    assert len(detail) == 1
    assert detail[0].would_be_diameter_m == pytest.approx(57.2, rel=0.03)
    assert detail[0].streets_a and detail[0].streets_b
    assert tight_report.intersections_signalised_junction == 2
    assert len(tight_report.capped_cases) == 1
    assert tight_report.capped_case_details_for_tighter_caps == {}  # nothing tighter than 50


# --- pedestrian crossings merge on their own distance ------------------------------------------


def _crossings(*positions: float) -> list[SignalPoint]:
    return [
        signal(at(x, 0), f"OSM-L{i}", node_type="pedestrian_crossing")
        for i, x in enumerate(positions, start=10)
    ]


def crossing_road() -> list[DrivableWay]:
    return [
        way(1, [at(0, 0), at(0.3, 0), at(0.4, 0), at(0.5, 0), at(1.5, 0)], "primary", name="Aleja")
    ]


def test_crossings_within_the_crossing_merge_distance_merge_into_one_intersection() -> None:
    # 0.1 step is about 7.1 m: the first two merge, the third (28.6 m on) stays alone.
    *_, intersections, report = run(crossing_road(), _crossings(0.3, 0.4, 1.5))

    assert sorted(len(i.nodes) for i in intersections) == [1, 2]
    assert all(i.kind == "pedestrian_crossing" for i in intersections)
    assert report.pedestrian_crossing_nodes == 3
    assert report.crossing_merges_performed == 1
    assert report.intersections_pedestrian_crossing == 2


def test_the_crossing_merge_distance_is_inclusive_and_separate_from_the_junction_one() -> None:
    crossings = _crossings(0.3, 0.5)
    attached, adjacency, *_ = run(crossing_road(), crossings)
    first, second = (a.graph_node for a in attached.attachments)
    assert first is not None and second is not None
    distance = reach_within(adjacency, first, 1000.0)[second]

    def intersections_for(crossing_distance: float, junction_distance: float) -> int:
        settings = GroupingSettings(
            crossing_merge_distance_meters=crossing_distance,
            merge_distance_meters=junction_distance,
        )
        return len(run(crossing_road(), crossings, settings=settings)[-2])

    assert intersections_for(distance, 1.0) == 1  # at the limit: merged, junction distance unused
    assert intersections_for(distance - 1e-6, 1000.0) == 2  # just below: not merged


def test_the_crossing_merge_respects_the_diameter_cap_and_reports_the_refusal() -> None:
    settings = GroupingSettings(
        crossing_merge_distance_meters=10.0, merge_max_group_diameter_meters=12.0
    )

    *_, intersections, report = run(crossing_road(), _crossings(0.3, 0.4, 0.5), settings=settings)

    # 0.1 step ~ 7.1 m: neighbours merge, but all three would span ~14 m, beyond the 12 m cap.
    assert sorted(len(i.nodes) for i in intersections) == [1, 2]
    assert len(report.crossing_capped_cases) == 1
    assert report.crossing_capped_cases[0].would_be_diameter_m == pytest.approx(14.3, rel=0.05)


def test_delay_by_kind_comes_from_config_and_an_unknown_kind_raises() -> None:
    delays = kind_delay_seconds(
        signal_delay_seconds=11.0,
        midblock_signal_delay_seconds=9.0,
        pedestrian_crossing_delay_seconds=7.0,
    )

    assert delays == {
        "signalised_junction": 11.0,
        "midblock_signal": 9.0,
        "pedestrian_crossing": 7.0,
    }
    assert kind_delay_seconds() == {
        "signalised_junction": SIGNAL_DELAY_SECONDS,
        "midblock_signal": MIDBLOCK_SIGNAL_DELAY_SECONDS,
        "pedestrian_crossing": PEDESTRIAN_CROSSING_DELAY_SECONDS,
    }


def test_kind_delay_seconds_has_independent_midblock_key() -> None:
    delays = kind_delay_seconds(
        signal_delay_seconds=35.0,
        midblock_signal_delay_seconds=20.0,
        pedestrian_crossing_delay_seconds=35.0,
    )

    assert delays["signalised_junction"] == 35.0
    assert delays["midblock_signal"] == 20.0


def _signal_review_frame(
    attachments: list[Attachment], reviewed_keys: set[str] | None = None
) -> pl.DataFrame:
    reviewed_keys = reviewed_keys or set()
    return pl.DataFrame(
        {
            "node_key": [attachment.signal.node_key for attachment in attachments],
            "needs_review": [
                attachment.signal.node_key in reviewed_keys for attachment in attachments
            ],
        },
        schema={"node_key": pl.String, "needs_review": pl.Boolean},
    )


def _detail_frame(
    signal_points: list[SignalPoint],
    reviewed_keys: set[str] | None = None,
    issue_keys: set[str] | None = None,
) -> pl.DataFrame:
    attached, _, rings, _, _, intersections, _ = run(two_junction_ways(), signal_points)
    issue_keys = issue_keys or set()
    for attachment in attached.attachments:
        if attachment.signal.node_key in issue_keys:
            attachment.issue = "ambiguous direction"
    return intersection_frame(
        attached.graph,
        intersections,
        attached.attachments,
        rings,
        set(),
        set(attached.graph.nodes),
        signals=_signal_review_frame(attached.attachments, reviewed_keys),
    )


def test_intersection_frame_counts_distinct_member_signals() -> None:
    frame = _detail_frame([signal(at(1.5, 0), "OSM-L70"), signal(at(2, 0), "OSM-L71")])

    assert frame["signal_count"].to_list() == [2]
    assert frame.schema["signal_count"] == pl.Int64


def test_needs_review_true_when_member_signal_flagged() -> None:
    frame = _detail_frame([signal(at(1.5, 0), "OSM-L70")], {"OSM-L70"})

    assert frame["needs_review"].to_list() == [True]


def test_needs_review_true_when_approach_has_issue() -> None:
    frame = _detail_frame([signal(at(1.5, 0), "OSM-L70")], issue_keys={"OSM-L70"})

    assert frame["needs_review"].to_list() == [True]


def test_needs_review_false_otherwise() -> None:
    frame = _detail_frame([signal(at(1.5, 0), "OSM-L70")])

    assert frame["needs_review"].to_list() == [False]
    assert frame.schema["needs_review"] == pl.Boolean


def test_the_frame_has_a_delay_per_intersection_and_refuses_an_unmapped_kind() -> None:
    signals = [
        signal(at(1.5, 0), "OSM-L70"),
        signal(at(4, 0), "OSM-L71"),  # standalone mid-block
        signal(at(4.2, 0), "OSM-L72", node_type="pedestrian_crossing"),
    ]
    attached, _, rings, _, _, intersections, _ = run(two_junction_ways(), signals)
    nodes = set(attached.graph.nodes)

    frame = intersection_frame(
        attached.graph,
        intersections,
        attached.attachments,
        rings,
        set(),
        nodes,
        _signal_review_frame(attached.attachments),
        kind_delay_seconds(
            signal_delay_seconds=30.0,
            midblock_signal_delay_seconds=20.0,
            pedestrian_crossing_delay_seconds=12.0,
        ),
    )
    assert dict(frame.select("kind", "delay_seconds").iter_rows()) == {
        "signalised_junction": 30.0,
        "midblock_signal": 20.0,
        "pedestrian_crossing": 12.0,
    }
    assert frame.schema["delay_seconds"] == pl.Float64
    with pytest.raises(ValueError, match="midblock_signal"):
        intersection_frame(
            attached.graph,
            intersections,
            attached.attachments,
            rings,
            set(),
            nodes,
            _signal_review_frame(attached.attachments),
            {"signalised_junction": 30.0, "pedestrian_crossing": 12.0},
        )
