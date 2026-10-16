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
