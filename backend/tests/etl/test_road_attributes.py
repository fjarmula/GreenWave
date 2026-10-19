import pytest

from greenwave.etl.road_attributes import bus_lane_directions, lanes_per_direction, surface_class


@pytest.mark.parametrize(
    ("tags", "expected"),
    [
        ({"bus:lanes:forward": "|designated"}, (True, False)),
        ({"bus:lanes:backward": "designated|yes"}, (False, True)),
        ({"bus:lanes": "designated|"}, (True, True)),
        ({"bus:lanes": "yes|no"}, (False, False)),
        ({"busway:left": "lane"}, (False, True)),
        ({"busway:right": "lane"}, (True, False)),
        ({"busway:both": "lane"}, (True, True)),
        ({"busway": "lane"}, (True, True)),
        ({"busway": "no"}, (False, False)),
        ({"lanes:psv": "1"}, (True, True)),
        ({"lanes:psv": "0"}, (False, False)),
        ({"lanes:psv:forward": "1"}, (True, False)),
        ({"lanes:bus:backward": "1"}, (False, True)),
        ({"lanes:bus": "x"}, (False, False)),
        ({}, (False, False)),
    ],
)
def test_bus_lane_directions(tags: dict[str, object], expected: tuple[bool, bool]) -> None:
    assert bus_lane_directions(tags) == expected


@pytest.mark.parametrize(
    ("tags", "oneway", "expected"),
    [
        ({"lanes": "4"}, False, (2, 2)),
        ({"lanes": "3"}, False, (1, 1)),
        ({"lanes": "1"}, False, (1, 1)),
        ({"lanes": "2"}, True, (2, None)),
        ({"lanes:forward": "2", "lanes:backward": "1", "lanes": "3"}, False, (2, 1)),
        ({"lanes:forward": "2", "lanes": "4"}, False, (2, 2)),
        ({"lanes": "0"}, False, (None, None)),
        ({"lanes": "two"}, False, (None, None)),
        ({}, False, (None, None)),
    ],
)
def test_lanes_per_direction(
    tags: dict[str, object], oneway: bool, expected: tuple[int | None, int | None]
) -> None:
    assert lanes_per_direction(tags, oneway=oneway) == expected


@pytest.mark.parametrize(
    ("tags", "expected"),
    [
        ({"surface": "gravel"}, "unpaved"),
        ({"surface": "asphalt"}, "paved"),
        ({"surface": "weird"}, None),
        ({}, None),
    ],
)
def test_surface_class(tags: dict[str, object], expected: str | None) -> None:
    assert surface_class(tags) == expected
