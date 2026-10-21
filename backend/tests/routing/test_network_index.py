from dataclasses import replace

import polars as pl
import pytest
from pydantic import ValidationError

from greenwave.simulation_settings import SimulationSettings


def test_settings_rejects_priority_after_clearing() -> None:
    """A priority phase that starts after clearing would make phase ordering impossible."""
    with pytest.raises(ValidationError, match="priority_green_tti_seconds"):
        SimulationSettings(priority_green_tti_seconds=41)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("clearing_tti_seconds", -1),
        ("max_snap_distance_meters", -1),
        ("ambulance_min_speed_kmh", -1),
        ("speed_ema_alpha", 0),
        ("speed_ema_alpha", 1.01),
    ],
)
def test_settings_reject_invalid_ranges(field: str, value: float) -> None:
    """Negative timing/distance/speed values and invalid EMA weights are unsafe."""
    with pytest.raises(ValidationError):
        SimulationSettings(**{field: value})


def test_index_resolves_dataset_approaches_intersections_and_nearby_nodes(tiny_dataset) -> None:
    """Dropping ETL approaches, intersection metadata, or nearest-node snapping breaks routing."""
    from greenwave.routing.network_index import build_routing_index

    index = build_routing_index(tiny_dataset, SimulationSettings())

    for edge_ids in tiny_dataset.signal_approaches["controlled_edge_ids"].to_list():
        for edge_id in edge_ids:
            assert index.approaches_on_edge(edge_id)
            assert index.edge(edge_id).edge_id == edge_id
    for record in tiny_dataset.intersection_ids:
        intersection = index.intersection(record.id)
        assert (intersection.lon, intersection.lat) == (record.lon, record.lat)
    node_key = next(iter(tiny_dataset.graph.nodes))
    node = tiny_dataset.graph.nodes[node_key]
    snapped = index.snap(node["x_m"] + 1, node["y_m"])
    assert snapped is not None
    assert snapped[0] == node_key
    assert snapped[1] == pytest.approx(1)


def test_index_does_not_snap_beyond_configured_limit(tiny_dataset) -> None:
    """Accepting distant positions would turn off-network requests into fabricated routes."""
    from greenwave.routing.network_index import build_routing_index

    settings = SimulationSettings(max_snap_distance_meters=150)
    index = build_routing_index(tiny_dataset, settings)
    node_key = next(iter(tiny_dataset.graph.nodes))
    node = tiny_dataset.graph.nodes[node_key]

    assert index.snap(node["x_m"] + 10_000, node["y_m"]) is None


def test_edge_view_exposes_road_attributes(tiny_dataset) -> None:
    from greenwave.routing.network_index import build_routing_index

    index = build_routing_index(tiny_dataset, SimulationSettings())

    for *_, data in tiny_dataset.graph.edges(data=True):
        view = index.edge(data["edge_id"])
        assert view.bus_lane is data["bus_lane"]
        assert view.tram_track is data["tram_track"]
        assert view.lanes_per_direction == data["lanes_per_direction"]
        assert view.surface_class == data["surface_class"]
        assert view.calming_count == data["calming_count"]
        assert isinstance(view.calming_count, int)


def test_index_exposes_signal_detail(tiny_dataset) -> None:
    from greenwave.routing.network_index import build_routing_index

    index = build_routing_index(tiny_dataset, SimulationSettings())
    row = tiny_dataset.intersections.row(0, named=True)

    assert index.intersection(row["intersection_id"]).signal_count == row["signal_count"]
    assert index.intersection(row["intersection_id"]).approach_count == row["approaches"]
    assert index.intersection(row["intersection_id"]).needs_review is row["needs_review"]


def test_neighbour_candidate_returns_min_distance_or_none(tiny_dataset) -> None:
    from greenwave.routing.network_index import build_routing_index

    row = tiny_dataset.approach_neighbours.row(0, named=True)
    shorter = pl.DataFrame([row], schema=tiny_dataset.approach_neighbours.schema).with_columns(
        pl.lit(row["distance_m"] - 1.0).alias("distance_m")
    )
    dataset = replace(
        tiny_dataset,
        approach_neighbours=pl.concat([tiny_dataset.approach_neighbours, shorter]),
    )

    index = build_routing_index(dataset, SimulationSettings())

    assert index.neighbour_candidate(
        row["from_approach_edge_id"], row["to_approach_edge_id"]
    ) == pytest.approx(row["distance_m"] - 1.0)
    assert index.neighbour_candidate("missing-from", "missing-to") is None


def test_index_exposes_signal_positions_per_intersection(tiny_dataset) -> None:
    """Phase markers must sit on real signal nodes, in a stable per-intersection order."""
    from greenwave.routing.network_index import build_routing_index

    index = build_routing_index(tiny_dataset, SimulationSettings())
    rows = tiny_dataset.signal_approaches.filter(pl.col("intersection_id").is_not_null())
    assert rows.height

    rows = rows.filter(pl.col("node_type").is_in(["traffic_signals", "pedestrian_crossing"]))
    for intersection_id in rows["intersection_id"].unique().to_list():
        expected = rows.filter(pl.col("intersection_id") == intersection_id).sort("signal_key")
        refs = index.signal_approaches(intersection_id)
        assert [ref.signal_key for ref in refs] == expected["signal_key"].to_list()
        assert [(ref.lon, ref.lat) for ref in refs] == list(
            zip(expected["lon"].to_list(), expected["lat"].to_list(), strict=True)
        )
        assert [ref.node_type for ref in refs] == expected["node_type"].to_list()
        assert [list(ref.controlled_edge_ids) for ref in refs] == expected[
            "controlled_edge_ids"
        ].to_list()
        assert all(ref.intersection_id == intersection_id for ref in refs)


def test_index_returns_no_signal_positions_for_an_intersection_without_approaches(
    tiny_dataset,
) -> None:
    from greenwave.routing.network_index import build_routing_index

    index = build_routing_index(tiny_dataset, SimulationSettings())

    assert index.signal_approaches("INT-NO-APPROACHES") == ()


@pytest.mark.parametrize(
    ("node_type", "kinds"),
    [
        ("traffic_signals", ("VEHICLE", "PEDESTRIAN")),
        ("pedestrian_crossing", ("PEDESTRIAN",)),
        ("other_crossing", ()),
    ],
)
def test_signal_movement_kinds_follow_the_source_node_type(
    node_type: str, kinds: tuple[str, ...]
) -> None:
    """A pedestrian-only crossing must never be drawn as a vehicle light."""
    from greenwave.routing.network_index import SignalApproachRef

    ref = SignalApproachRef("INT", "sig", node_type, 19.9, 50.0, ("e1",))
    assert ref.movement_kinds == kinds


@pytest.mark.parametrize(
    ("edge_ids", "group"),
    [(("b", "a"), "a|b"), (("a",), "a"), ((), None)],
)
def test_signal_movement_group_is_the_sorted_controlled_edge_identity(
    edge_ids: tuple[str, ...], group: str | None
) -> None:
    from greenwave.routing.network_index import SignalApproachRef

    ref = SignalApproachRef("INT", "sig", "traffic_signals", 19.9, 50.0, edge_ids)
    assert ref.movement_group == group


def test_index_omits_signal_nodes_of_unknown_type_but_keeps_their_approaches(
    tiny_dataset,
) -> None:
    from greenwave.routing.network_index import build_routing_index

    rows = tiny_dataset.signal_approaches.filter(pl.col("intersection_id").is_not_null())
    target = rows.row(0, named=True)
    dataset = replace(
        tiny_dataset,
        signal_approaches=tiny_dataset.signal_approaches.with_columns(
            node_type=pl.when(pl.col("signal_key") == target["signal_key"])
            .then(pl.lit("mystery_node"))
            .otherwise(pl.col("node_type"))
        ),
    )

    index = build_routing_index(dataset, SimulationSettings())

    keys = [ref.signal_key for ref in index.signal_approaches(target["intersection_id"])]
    assert target["signal_key"] not in keys
    for edge_id in target["controlled_edge_ids"]:
        assert index.approaches_on_edge(edge_id)


def test_index_signal_order_is_independent_of_source_row_order(tiny_dataset) -> None:
    from greenwave.routing.network_index import build_routing_index

    reversed_rows = replace(
        tiny_dataset, signal_approaches=tiny_dataset.signal_approaches.reverse()
    )
    first = build_routing_index(tiny_dataset, SimulationSettings())
    second = build_routing_index(reversed_rows, SimulationSettings())

    for intersection_id in tiny_dataset.signal_approaches["intersection_id"].drop_nulls().unique():
        assert first.signal_approaches(intersection_id) == second.signal_approaches(intersection_id)
