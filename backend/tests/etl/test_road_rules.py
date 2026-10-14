import pytest

from greenwave.etl.config import CLASS_DEFAULT_SPEED_KMH, DRIVABLE_HIGHWAY_VALUES
from greenwave.etl.road_rules import (
    OnewayResolution,
    SpeedResolution,
    UnrecognisedTagError,
    resolve_oneway,
    resolve_speed,
)


@pytest.mark.parametrize(
    ("properties", "highway", "expected"),
    [
        ({"oneway": "yes"}, "residential", OnewayResolution("forward", "explicit")),
        ({"oneway": "-1"}, "residential", OnewayResolution("backward", "explicit")),
        ({"oneway": "no"}, "residential", OnewayResolution("both", "explicit")),
        ({"oneway": "reversible"}, "primary", OnewayResolution("reversible", "explicit")),
        ({}, "residential", OnewayResolution("both", "default_two_way")),
        ({}, "motorway", OnewayResolution("forward", "implied_highway")),
        ({}, "motorway_link", OnewayResolution("forward", "implied_highway")),
        ({"junction": "roundabout"}, "tertiary", OnewayResolution("forward", "implied_junction")),
        ({"junction": "circular"}, "residential", OnewayResolution("forward", "implied_junction")),
        # explicit oneway=no overrides every implied rule
        ({"oneway": "no"}, "motorway", OnewayResolution("both", "explicit")),
        (
            {"junction": "roundabout", "oneway": "no"},
            "tertiary",
            OnewayResolution("both", "explicit"),
        ),
        # trunk is not implied one-way in OSM
        ({}, "trunk", OnewayResolution("both", "default_two_way")),
    ],
)
def test_resolve_oneway(
    properties: dict[str, object], highway: str, expected: OnewayResolution
) -> None:
    assert resolve_oneway(properties, highway) == expected


def test_resolve_oneway_rejects_unknown_value_instead_of_guessing() -> None:
    with pytest.raises(UnrecognisedTagError):
        resolve_oneway({"oneway": "sometimes"}, "residential")


def test_other_junction_values_do_not_imply_oneway() -> None:
    assert resolve_oneway({"junction": "jughandle"}, "primary").direction == "both"


@pytest.mark.parametrize(
    ("properties", "highway", "expected"),
    [
        ({"maxspeed": "50"}, "residential", SpeedResolution(50, "osm_maxspeed")),
        ({"maxspeed": "70 km/h"}, "primary", SpeedResolution(70, "osm_maxspeed")),
        ({}, "residential", SpeedResolution(30, "class_default")),
        (
            {"maxspeed": "PL:urban"},
            "tertiary",
            SpeedResolution(50, "class_default_unparsed_maxspeed"),
        ),
        (
            {"maxspeed": "50 mph"},
            "tertiary",
            SpeedResolution(50, "class_default_unparsed_maxspeed"),
        ),
        ({"maxspeed": "0"}, "tertiary", SpeedResolution(50, "class_default_unparsed_maxspeed")),
    ],
)
def test_resolve_speed_reports_where_the_value_came_from(
    properties: dict[str, object], highway: str, expected: SpeedResolution
) -> None:
    assert resolve_speed(properties, highway) == expected


def test_every_drivable_class_has_a_default_speed() -> None:
    assert set(CLASS_DEFAULT_SPEED_KMH) >= DRIVABLE_HIGHWAY_VALUES


def test_resolve_speed_fails_loudly_for_class_without_default() -> None:
    with pytest.raises(UnrecognisedTagError):
        resolve_speed({}, "footway")
