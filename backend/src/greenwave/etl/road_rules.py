"""Pure rules that turn OSM way tags into routing attributes (one-way direction, speed).

Defaults come from ``config.py`` (approved 2026-10-14). Every derived value carries its source so
a default is never mistaken for an OSM-supplied value.
"""

import re
from dataclasses import dataclass
from typing import Literal

from greenwave.etl.config import (
    CLASS_DEFAULT_SPEED_KMH,
    EXCLUDED_SERVICE_SUBTYPES,
    IMPLIED_ONEWAY_HIGHWAY_VALUES,
    IMPLIED_ONEWAY_JUNCTION_VALUES,
)
from greenwave.etl.profile_osm import DrivableWay, tag

OnewayDirection = Literal["forward", "backward", "both", "reversible"]
OnewaySource = Literal["explicit", "implied_highway", "implied_junction", "default_two_way"]
SpeedSource = Literal["osm_maxspeed", "class_default", "class_default_unparsed_maxspeed"]

_FORWARD_VALUES = frozenset({"yes", "true", "1"})
_BACKWARD_VALUES = frozenset({"-1", "reverse"})
_BOTH_VALUES = frozenset({"no", "false", "0"})
_REVERSIBLE_VALUES = frozenset({"reversible", "alternating"})
_MAXSPEED_KMH = re.compile(r"^(\d+)(\s*km/h)?$")


class UnrecognisedTagError(ValueError):
    """A tag value the rules do not understand; the caller must report it, not guess."""


@dataclass(frozen=True, slots=True)
class OnewayResolution:
    direction: OnewayDirection
    source: OnewaySource


@dataclass(frozen=True, slots=True)
class SpeedResolution:
    speed_kmh: int
    source: SpeedSource


def resolve_oneway(properties: dict[str, object], highway: str) -> OnewayResolution:
    """Direction of travel relative to the way's digitised direction.

    An explicit ``oneway`` tag wins (including ``oneway=no`` on a motorway or roundabout).
    Otherwise motorways and roundabouts are one-way forward, and everything else is two-way.
    """
    explicit = tag(properties, "oneway")
    if explicit is not None:
        value = explicit.strip().casefold()
        if value in _FORWARD_VALUES:
            return OnewayResolution("forward", "explicit")
        if value in _BACKWARD_VALUES:
            return OnewayResolution("backward", "explicit")
        if value in _BOTH_VALUES:
            return OnewayResolution("both", "explicit")
        if value in _REVERSIBLE_VALUES:
            return OnewayResolution("reversible", "explicit")
        raise UnrecognisedTagError(f"unrecognised oneway value: {explicit!r}")
    if tag(properties, "junction") in IMPLIED_ONEWAY_JUNCTION_VALUES:
        return OnewayResolution("forward", "implied_junction")
    if highway in IMPLIED_ONEWAY_HIGHWAY_VALUES:
        return OnewayResolution("forward", "implied_highway")
    return OnewayResolution("both", "default_two_way")


def resolve_speed(properties: dict[str, object], highway: str) -> SpeedResolution:
    """Speed limit in km/h from ``maxspeed``, else the class default, always with its source."""
    if highway not in CLASS_DEFAULT_SPEED_KMH:
        raise UnrecognisedTagError(f"no default speed configured for highway={highway!r}")
    default_kmh = CLASS_DEFAULT_SPEED_KMH[highway]
    maxspeed = tag(properties, "maxspeed")
    if maxspeed is None:
        return SpeedResolution(default_kmh, "class_default")
    match = _MAXSPEED_KMH.match(maxspeed.strip().casefold())
    if match is None or int(match.group(1)) == 0:
        # e.g. "PL:urban", "none", "50 mph", "50;30": not silently converted.
        return SpeedResolution(default_kmh, "class_default_unparsed_maxspeed")
    return SpeedResolution(int(match.group(1)), "osm_maxspeed")


def is_routable_way(way: DrivableWay) -> bool:
    """Drivable and not a driveway / parking aisle / drive-through (approved 2026-10-14)."""
    return tag(way.properties, "service") not in EXCLUDED_SERVICE_SUBTYPES
