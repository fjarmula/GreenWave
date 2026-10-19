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
        ({"psv:lanes": "||designated"}, (True, True)),
        ({"psv:lanes:forward": "designated|"}, (True, False)),
        ({"psv:lanes:backward": "yes|no"}, (False, False)),
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


@pytest.mark.parametrize(
    ("tags", "direction", "expected"),
    [
        # Pawia: oneway=yes with busway:left=lane is a with-flow bus lane on the left side.
        ({"busway:left": "lane"}, "forward", (True, False)),
        ({"busway:right": "lane"}, "forward", (True, False)),
        ({"busway:both": "lane"}, "forward", (True, False)),
        ({"busway:left": "opposite_lane"}, "forward", (False, True)),
        ({"busway:right": "lane"}, "backward", (False, True)),
        ({"busway:left": "lane"}, "backward", (False, True)),
        ({"busway:right": "opposite_lane"}, "backward", (True, False)),
        # forward/backward suffixes keep the digitised direction on one-way roads.
        ({"bus:lanes:forward": "designated"}, "forward", (True, False)),
        ({"bus:lanes:backward": "designated"}, "backward", (False, True)),
        # Two-way roads keep the side rule (right = digitised, left = reverse).
        ({"busway:left": "lane"}, "both", (False, True)),
    ],
)
def test_side_suffixes_on_one_way_roads_follow_the_travel_direction(
    tags: dict[str, object], direction: str, expected: tuple[bool, bool]
) -> None:
    assert bus_lane_directions(tags, direction) == expected
