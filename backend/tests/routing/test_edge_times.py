import pytest
from pydantic import ValidationError
from shapely.geometry import LineString
from tests.support.route_fixtures import neutral_settings

from greenwave.routing.edge_times import (
    ambulance_boost,
    ambulance_edge_seconds,
    ambulance_effective_speed_mps,
    ambulance_speed_kmh,
    normal_edge_seconds,
)
from greenwave.routing.network_index import EdgeView
from greenwave.simulation_settings import SimulationSettings


def _edge(length: float = 250.0, speed: float = 50.0, **attributes: object) -> EdgeView:
    return EdgeView(
        edge_id="e",
        source_node="a",
        target_node="b",
        length_m=length,
        speed_kmh=speed,
        geometry=LineString([(0, 0), (length, 0)]),
        **attributes,  # type: ignore[arg-type]
    )


_ALL_ATTRIBUTES = {
    "bus_lane": True,
    "tram_track": True,
    "lanes_per_direction": 1,
    "surface_class": "unpaved",
    "calming_count": 4,
}


def test_neutral_factors_reproduce_the_attribute_free_formulas_exactly() -> None:
    settings = neutral_settings()
    edge = _edge(length=123.4, speed=50.0, **_ALL_ATTRIBUTES)

    assert normal_edge_seconds(edge, 1.7, settings) == 123.4 * 1.7 / (50.0 / 3.6)
    assert ambulance_edge_seconds(edge, settings) == 123.4 / (
        min(max(1.3 * 50.0, 30.0), 90.0) / 3.6
    )
    assert ambulance_speed_kmh(50.0, settings) == min(max(1.3 * 50.0, 30.0), 90.0)


@pytest.mark.parametrize(("lanes", "applies"), [(1, True), (None, False), (2, False)])
def test_single_lane_factor_applies_only_to_one_lane(lanes: int | None, applies: bool) -> None:
    settings = SimulationSettings(normal_single_lane_factor=1.5)
    base = 100 / (36 / 3.6)

    seconds = normal_edge_seconds(_edge(100, 36, lanes_per_direction=lanes), 1.0, settings)

    assert seconds == pytest.approx(base * 1.5 if applies else base)


@pytest.mark.parametrize(
    ("surface", "applies"), [("unpaved", True), ("paved", False), (None, False)]
)
def test_unpaved_factor_applies_only_to_unpaved(surface: str | None, applies: bool) -> None:
    settings = SimulationSettings(normal_unpaved_factor=1.4)
    base = 100 / (36 / 3.6)

    seconds = normal_edge_seconds(_edge(100, 36, surface_class=surface), 1.0, settings)

    assert seconds == pytest.approx(base * 1.4 if applies else base)


def test_calming_seconds_are_added_per_feature_to_each_mode_independently() -> None:
    edge = _edge(100, 36, calming_count=3)
    normal_only = neutral_settings(normal_calming_seconds=2.0)
    ambulance_only = neutral_settings(ambulance_calming_seconds=1.5)
    normal_base = 100 / (36 / 3.6)
    ambulance_base = 100 / (min(max(1.3 * 36, 30), 90) / 3.6)

    assert normal_edge_seconds(edge, 1.0, normal_only) == pytest.approx(normal_base + 6.0)
    assert ambulance_edge_seconds(edge, normal_only) == pytest.approx(ambulance_base)
    assert ambulance_edge_seconds(edge, ambulance_only) == pytest.approx(ambulance_base + 4.5)
    assert normal_edge_seconds(edge, 1.0, ambulance_only) == pytest.approx(normal_base)


def test_bus_lane_and_tram_boosts_take_the_max_not_the_product() -> None:
    settings = SimulationSettings(ambulance_bus_lane_factor=1.2, ambulance_tram_track_factor=1.1)

    assert ambulance_boost(_edge(bus_lane=True, tram_track=True), settings) == 1.2
    assert ambulance_boost(_edge(tram_track=True), settings) == 1.1
    assert ambulance_boost(_edge(), settings) == 1.0
    assert ambulance_edge_seconds(_edge(100, 40, bus_lane=True), settings) == pytest.approx(
        100 / (1.3 * 40 * 1.2 / 3.6)
    )


def test_boost_applies_before_the_clamp() -> None:
    settings = SimulationSettings(ambulance_bus_lane_factor=1.2)
    edge = _edge(900, 80, bus_lane=True)

    assert ambulance_speed_kmh(80, settings, ambulance_boost(edge, settings)) == 90
    assert ambulance_edge_seconds(edge, settings) == pytest.approx(900 / (90 / 3.6))


def test_effective_speed_spreads_calming_seconds_over_the_edge() -> None:
    settings = SimulationSettings(ambulance_calming_seconds=2.0)
    edge = _edge(100, 36, calming_count=3)

    speed = ambulance_effective_speed_mps(edge, settings)

    assert edge.length_m / speed == pytest.approx(ambulance_edge_seconds(edge, settings))


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("ambulance_bus_lane_factor", 0.9),
        ("ambulance_tram_track_factor", 0.99),
        ("normal_single_lane_factor", 0.5),
        ("normal_unpaved_factor", 0.9),
        ("normal_calming_seconds", -1),
        ("ambulance_calming_seconds", -0.1),
    ],
)
def test_settings_reject_factors_below_neutral(field: str, value: float) -> None:
    with pytest.raises(ValidationError):
        SimulationSettings(**{field: value})


def test_zero_length_edge_moves_at_the_ambulance_speed() -> None:
    settings = SimulationSettings(ambulance_calming_seconds=2.0)
    edge = _edge(0.0, 36, calming_count=1)

    assert ambulance_effective_speed_mps(edge, settings) == pytest.approx(1.3 * 36 / 3.6)


def test_defaults_are_the_approved_values() -> None:
    """APPROVED 2026-10-19 (ADR 0005); changing a default needs a new approval."""
    settings = SimulationSettings()

    assert (
        settings.normal_single_lane_factor,
        settings.normal_unpaved_factor,
        settings.normal_calming_seconds,
        settings.ambulance_calming_seconds,
        settings.ambulance_bus_lane_factor,
        settings.ambulance_tram_track_factor,
    ) == (1.15, 1.3, 3.0, 2.0, 1.05, 1.05)


def test_neutral_road_factors_cover_every_road_factor_and_remove_all_effects() -> None:
    from greenwave.routing.edge_times import NEUTRAL_ROAD_FACTORS

    settings = SimulationSettings(**NEUTRAL_ROAD_FACTORS)
    edge = _edge(100, 36, **_ALL_ATTRIBUTES)

    assert set(NEUTRAL_ROAD_FACTORS) == {
        name
        for name in SimulationSettings.model_fields
        if name.startswith(("normal_", "ambulance_"))
        and name.endswith(("_factor", "_seconds"))
        and name != "ambulance_speed_factor"
    }
    assert normal_edge_seconds(edge, 1.0, settings) == 100 / (36 / 3.6)
    assert ambulance_edge_seconds(edge, settings) == 100 / (1.3 * 36 / 3.6)
