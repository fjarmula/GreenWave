"""Pure rules that turn OSM way tags into per-direction road attributes (bus lane, lanes, surface).

"Forward" is the way's digitised direction, "backward" the reverse. Unknown or unparseable tags
give ``False`` / ``None``: they never imply the property.
"""

from greenwave.etl.config import PAVED_SURFACE_VALUES, UNPAVED_SURFACE_VALUES
from greenwave.etl.profile_osm import tag

# Suffix -> (applies forward, applies backward) on a two-way road (right-hand traffic: the right
# side is the digitised direction). The unsuffixed tag applies to both directions.
_DIRECTION_SUFFIXES: dict[str, tuple[bool, bool]] = {
    "": (True, True),
    ":both": (True, True),
    ":forward": (True, False),
    ":right": (True, False),
    ":backward": (False, True),
    ":left": (False, True),
}
# On a one-way road a side (left/right/both) lane runs with the traffic unless it is a contraflow
# lane: OSM `busway:left=lane` on `oneway=yes` is a with-flow bus lane on the left.
_SIDE_SUFFIXES = frozenset({":left", ":right", ":both"})
_CONTRAFLOW = "opposite_lane"


def _positive_int(value: str | None) -> int | None:
    return int(value) if value is not None and value.isdigit() and int(value) > 0 else None


def _busway(value: str) -> bool:
    return value != "no"


def _designated_lane(value: str) -> bool:
    return "designated" in value.split("|")


def _positive_lane_count(value: str) -> bool:
    return _positive_int(value) is not None


_BUS_LANE_TAGS = (
    ("busway", _busway),
    ("bus:lanes", _designated_lane),
    ("psv:lanes", _designated_lane),
    ("lanes:bus", _positive_lane_count),
    ("lanes:psv", _positive_lane_count),
)


def _applies(suffix: str, value: str, oneway_direction: str) -> tuple[bool, bool]:
    if oneway_direction == "both" or suffix not in _SIDE_SUFFIXES:
        return _DIRECTION_SUFFIXES[suffix]
    with_traffic = oneway_direction == "forward"
    if value == _CONTRAFLOW:
        with_traffic = not with_traffic
    return with_traffic, not with_traffic


def bus_lane_directions(
    properties: dict[str, object], oneway_direction: str = "both"
) -> tuple[bool, bool]:
    """(bus lane along the digitised direction, bus lane against it).

    ``oneway_direction`` is the way's resolved direction (``forward`` / ``backward`` / ``both``);
    on a one-way way, side suffixes follow the travel direction.
    """
    forward = backward = False
    for base, has_lane in _BUS_LANE_TAGS:
        for suffix in _DIRECTION_SUFFIXES:
            value = tag(properties, base + suffix)
            if value is not None and has_lane(value):
                applies_forward, applies_backward = _applies(suffix, value, oneway_direction)
                forward |= applies_forward
                backward |= applies_backward
    return forward, backward


def lanes_per_direction(
    properties: dict[str, object], oneway: bool
) -> tuple[int | None, int | None]:
    """(lanes forward, lanes backward); a one-way way has no backward value unless tagged."""
    total = _positive_int(tag(properties, "lanes"))
    forward = _positive_int(tag(properties, "lanes:forward"))
    backward = _positive_int(tag(properties, "lanes:backward"))
    if oneway:
        return (forward if forward is not None else total), backward
    split = None if total is None else max(1, total // 2)
    return (
        forward if forward is not None else split,
        backward if backward is not None else split,
    )


def surface_class(properties: dict[str, object]) -> str | None:
    """``"paved"``, ``"unpaved"`` or ``None`` (missing or unknown surface)."""
    value = tag(properties, "surface")
    if value in PAVED_SURFACE_VALUES:
        return "paved"
    if value in UNPAVED_SURFACE_VALUES:
        return "unpaved"
    return None
