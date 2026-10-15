import pytest

from greenwave.etl.graph import build_graph, node_key
from greenwave.etl.junctions import (
    find_junction_nodes,
    format_intersection_id,
    nearest_junctions,
    nearest_of,
    number_rings,
    override_rings,
    street_name_components,
    tagged_rings,
    undirected_adjacency,
)
from greenwave.etl.overrides import (
    OverrideFile,
    RoundaboutOverride,
    draft_override_entries,
    load_overrides,
    write_overrides,
)
from greenwave.etl.profile_osm import DrivableWay, LonLat

STEP = 0.001


def at(x: float, y: float) -> LonLat:
    return round(19.9 + x * STEP, 7), round(50.0 + y * STEP, 7)


def way(line: int, points: list[LonLat], highway: str = "residential", **tags: str) -> DrivableWay:
    return DrivableWay(line, highway, points, dict(tags))


def key(x: float, y: float) -> str:
    return node_key(*at(x, y))


# A plus-shaped crossing at (2, 0) with a bend at (4, 0) on the east arm and a far dead end.
def crossing_graph():  # type: ignore[no-untyped-def]
    return build_graph(
        [
            way(1, [at(0, 0), at(2, 0), at(4, 0)]),  # west-east through the junction
            way(2, [at(2, -2), at(2, 0), at(2, 2)]),  # south-north through it
            way(3, [at(4, 0), at(4, 1)]),  # bend at (4, 0)
        ]
    ).graph


def test_junction_nodes_need_three_distinct_neighbours() -> None:
    adjacency = undirected_adjacency(crossing_graph())

    assert find_junction_nodes(adjacency) == {key(2, 0)}
    assert key(4, 0) not in find_junction_nodes(adjacency)  # a bend (two neighbours)
    assert key(0, 0) not in find_junction_nodes(adjacency)  # a dead end (one neighbour)


def test_nearest_junction_distance_is_along_the_road_and_ignores_direction() -> None:
    graph = build_graph(
        [
            way(1, [at(0, 0), at(2, 0), at(4, 0)], oneway="yes"),
            way(2, [at(2, -2), at(2, 0), at(2, 2)]),
        ]
    ).graph
    adjacency = undirected_adjacency(graph)

    nearest = nearest_junctions(adjacency, {key(2, 0)})

    assert nearest[key(4, 0)][0] == key(2, 0)
    assert nearest[key(4, 0)][1] == pytest.approx(2 * 71.0, rel=0.03)  # two steps east
    assert nearest[key(2, 0)] == (key(2, 0), 0.0)


def test_equal_distance_ties_go_to_the_smaller_node_key() -> None:
    # Projected lengths are never exactly equal, so the tie rule is tested on a hand-built graph.
    adjacency = {
        "b": [("m", 10.0)],
        "a": [("m", 10.0)],
        "m": [("a", 10.0), ("b", 10.0)],
    }

    assert nearest_junctions(adjacency, {"a", "b"})["m"] == ("a", 10.0)
    assert nearest_junctions(adjacency, {"b", "a"})["m"] == ("a", 10.0)


def test_nearest_of_finds_the_closest_target_or_none() -> None:
    adjacency = undirected_adjacency(crossing_graph())

    assert nearest_of(adjacency, key(4, 1), {key(2, 0)})[0] == key(2, 0)  # type: ignore[index]
    assert nearest_of(adjacency, key(0, 0), {"nowhere"}) is None


def ring_ways() -> list[DrivableWay]:
    return [
        way(
            10,
            [at(0, 0), at(1, 0), at(1, 1)],
            junction="roundabout",
            name="Rondo Test",
            oneway="yes",
        ),
        way(
            11,
            [at(1, 1), at(0, 1), at(0, 0)],
            junction="roundabout",
            name="Rondo Test",
            oneway="yes",
        ),
        way(12, [at(0, 0), at(-2, 0)], name="Dojazd"),
        way(13, [at(5, 5), at(6, 5), at(6, 6), at(5, 6), at(5, 5)], junction="circular"),
    ]


def test_tagged_rings_group_ways_that_share_nodes() -> None:
    rings = tagged_rings(build_graph(ring_ways()).graph)
    number_rings(rings)

    assert len(rings) == 2
    named = next(r for r in rings if r.name == "Rondo Test")
    assert named.source == "junction_tag"
    assert named.nodes == {key(0, 0), key(1, 1)}
    assert [r.ring_id for r in rings] == [0, 1]


def test_override_ring_uses_listed_edges_and_reports_problems() -> None:
    graph = build_graph(
        [
            way(10, [at(0, 0), at(1, 0), at(1, 1)], name="Rondo Brak", oneway="yes"),
            way(11, [at(1, 1), at(0, 1), at(0, 0)], name="Rondo Brak", oneway="yes"),
            way(12, [at(0, 0), at(-2, 0)]),
        ]
    ).graph
    overrides = OverrideFile(
        entries=[
            RoundaboutOverride(
                name="Rondo Brak",
                verified=True,
                ring_edge_ids=["W10.0+", "W11.0+"],
                entry_arm_edge_ids=["W12.0+", "W12.0-"],
            ),
            RoundaboutOverride(name="Rondo Zle", ring_edge_ids=["W99.0+"]),
            RoundaboutOverride(name="Rondo Puste"),
        ]
    )

    rings, problems = override_rings(graph, overrides, existing=[])

    assert len(rings) == 1
    ring = rings[0]
    assert (ring.source, ring.name, ring.verified) == ("override", "Rondo Brak", True)
    assert ring.nodes == {key(0, 0), key(1, 1)}
    assert ring.arm_base_edge_ids == {"W12.0+", "W12.0-"}
    assert any("W99.0+" in p for p in problems)
    assert any("Rondo Puste" in p and "no ring edges" in p for p in problems)


def test_override_overlapping_a_tagged_ring_is_skipped() -> None:
    graph = build_graph(ring_ways()).graph
    existing = tagged_rings(graph)
    overrides = OverrideFile(entries=[RoundaboutOverride(name="Dup", ring_edge_ids=["W10.0+"])])

    rings, problems = override_rings(graph, overrides, existing)

    assert rings == [] and "overlaps" in problems[0]


def test_street_names_are_ordered_by_road_class_and_deduplicated() -> None:
    graph = build_graph(
        [
            way(1, [at(0, 0), at(2, 0), at(4, 0)], highway="primary", name="Aleja Mickiewicza"),
            way(2, [at(2, -2), at(2, 0), at(2, 2)], highway="residential", name="Czarnowiejska"),
            way(3, [at(2, 0), at(3, 3)], highway="residential", name="ul. Czarnowiejska"),
            way(4, [at(2, 0), at(1, 3)], highway="service"),  # unnamed
        ]
    ).graph

    assert street_name_components(graph, key(2, 0)) == ["Aleja Mickiewicza", "Czarnowiejska"]


@pytest.mark.parametrize(
    ("index", "total", "expected"),
    [(1, 500, "INT-0001"), (9999, 9999, "INT-9999"), (12, 10000, "INT-00012")],
)
def test_intersection_ids_are_zero_padded(index: int, total: int, expected: str) -> None:
    assert format_intersection_id(index, total) == expected


def test_draft_override_finds_the_ring_and_its_arms() -> None:
    ways = [
        way(10, [at(0, 0), at(1, 0), at(1, 1)], name="Rondo Brak", oneway="yes", highway="primary"),
        way(11, [at(1, 1), at(0, 1), at(0, 0)], name="Rondo Brak", oneway="yes", highway="primary"),
        way(12, [at(0, 0), at(-2, 0)], name="Dojazd"),
        way(13, [at(1, 1), at(3, 3)], name="Wylot"),
    ]
    graph = build_graph(ways).graph

    drafts, geojson = draft_override_entries(graph, ("Rondo Brak", "Rondo Nieistniejace"))

    found, missing = drafts.entries
    assert found.ring_edge_ids == ["W10.0+", "W11.0+"]
    assert set(found.entry_arm_edge_ids) == {"W12.0+", "W12.0-", "W13.0+", "W13.0-"}
    assert found.verified is False and found.notes is not None and "DRAFT" in found.notes
    assert missing.ring_edge_ids == [] and "fill in by hand" in (missing.notes or "")
    roles = {f["properties"]["role"] for f in geojson["features"]}  # type: ignore[index]
    assert roles == {"ring", "entry_arm"}


def test_override_file_roundtrip_and_missing_file(tmp_path) -> None:  # type: ignore[no-untyped-def]
    path = tmp_path / "roundabouts.json"
    original = OverrideFile(entries=[RoundaboutOverride(name="X", ring_edge_ids=["W1.0+"])])

    assert load_overrides(path) == OverrideFile()  # absent means no overrides
    write_overrides(original, path)
    assert load_overrides(path) == original
    path.write_text('{"entries": [{"name": "X", "typo_field": 1}]}', encoding="utf-8")
    with pytest.raises(ValueError, match="typo_field"):
        load_overrides(path)


def _ring_with_chord() -> list[DrivableWay]:
    corners = [at(0, 0), at(1, 0), at(1, 1), at(0, 1)]
    quarters = [
        way(10 + i, [corners[i], corners[(i + 1) % 4]], "primary", oneway="yes", name="Rondo Brak")
        for i in range(4)
    ]
    chord = way(20, [at(0, 0), at(1, 1)], "primary_link", oneway="yes", name="Rondo Brak")
    arm = way(21, [at(0, 0), at(-2, 0)], "primary", name="Zachodnia")
    return [*quarters, chord, arm]


def test_an_internal_edge_is_neither_ring_nor_arm_and_must_join_ring_nodes() -> None:
    graph = build_graph(_ring_with_chord()).graph
    ring_ids = ["W10.0+", "W11.0+", "W12.0+", "W13.0+"]
    overrides = OverrideFile(
        entries=[
            RoundaboutOverride(
                name="Rondo Brak",
                ring_edge_ids=ring_ids,
                entry_arm_edge_ids=["W21.0+", "W21.0-"],
                internal_edge_ids=["W20.0+"],
            ),
            RoundaboutOverride(name="Zle", ring_edge_ids=["W10.0+"], internal_edge_ids=["W21.0+"]),
        ]
    )

    rings, problems = override_rings(graph, overrides, existing=[])

    (ring,) = rings
    assert ring.internal_base_edge_ids == {"W20.0+"}
    assert ring.internal_edge_ids == {"W20.0+"}
    assert "W20.0+" not in ring.edge_ids and "W20.0+" not in ring.arm_base_edge_ids
    assert ring.nodes == {key(0, 0), key(1, 0), key(1, 1), key(0, 1)}
    assert any("Zle" in p for p in problems)


def test_an_unknown_internal_edge_id_skips_the_entry() -> None:
    graph = build_graph(_ring_with_chord()).graph
    overrides = OverrideFile(
        entries=[
            RoundaboutOverride(name="X", ring_edge_ids=["W10.0+"], internal_edge_ids=["W99.0+"])
        ]
    )

    rings, problems = override_rings(graph, overrides, existing=[])

    assert rings == [] and "W99.0+" in problems[0]


def test_internal_edges_ending_in_a_dead_end_are_dangling_and_rejected() -> None:
    graph = build_graph(_ring_with_chord()).graph
    # Both directions of the west arm are "internal" but lead nowhere: a dangling stub.
    overrides = OverrideFile(
        entries=[
            RoundaboutOverride(
                name="Rondo Brak",
                ring_edge_ids=["W10.0+", "W11.0+", "W12.0+", "W13.0+"],
                internal_edge_ids=["W21.0+", "W21.0-"],
            )
        ]
    )

    rings, problems = override_rings(graph, overrides, existing=[])

    assert rings == [] and "without dangling ends" in problems[0]
