"""Precomputed geometry of a planned route: edge lookup, ambulance speeds and positions."""

from bisect import bisect_right
from dataclasses import dataclass
from itertools import pairwise
from math import cos, hypot, radians
from typing import Self

from greenwave.routing.edge_times import ambulance_effective_speed_mps
from greenwave.routing.planner import PlannedRoute
from greenwave.schemas import Position
from greenwave.simulation_settings import SimulationSettings

_METERS_PER_DEGREE_LAT = 111_320.0


def _polyline_offsets_m(polyline: list[tuple[float, float]]) -> tuple[float, ...]:
    """Cumulative vertex offsets in local equirectangular metres (sub-metre error at city scale)."""
    lng_scale = cos(radians(polyline[0][1]))
    offsets = [0.0]
    for (lng_a, lat_a), (lng_b, lat_b) in pairwise(polyline):
        offsets.append(
            offsets[-1] + hypot((lng_b - lng_a) * lng_scale, lat_b - lat_a) * _METERS_PER_DEGREE_LAT
        )
    return tuple(offsets)


@dataclass(frozen=True, slots=True)
class RouteTrack:
    """Read-only per-route lookups the engine needs every simulated second."""

    total_distance_m: float
    _edge_ends_m: tuple[float, ...]
    _speeds_mps: tuple[float, ...]
    _speed_limits_mps: tuple[float, ...]
    _polyline: tuple[tuple[float, float], ...]
    _polyline_offsets_m: tuple[float, ...]

    @classmethod
    def from_route(cls, route: PlannedRoute, settings: SimulationSettings) -> Self:
        return cls(
            total_distance_m=route.total_distance_m,
            _edge_ends_m=tuple(
                start + length
                for start, length in zip(route.cumulative_m, route.edge_lengths_m, strict=True)
            ),
            _speeds_mps=tuple(
                ambulance_effective_speed_mps(edge, settings) for edge in route.edges
            ),
            _speed_limits_mps=tuple(edge.speed_kmh / 3.6 for edge in route.edges),
            _polyline=tuple(route.polyline_wgs84),
            _polyline_offsets_m=_polyline_offsets_m(route.polyline_wgs84),
        )

    def edge_at(self, distance_m: float) -> int:
        """The first edge whose end lies strictly beyond ``distance_m``, else the last edge."""
        return min(bisect_right(self._edge_ends_m, distance_m), len(self._edge_ends_m) - 1)

    def edge_end_m(self, index: int) -> float:
        return self._edge_ends_m[index]

    def speed_mps(self, index: int) -> float:
        return self._speeds_mps[index]

    def speed_limit_mps(self, index: int) -> float:
        """The edge's ordinary (unboosted) speed limit."""
        return self._speed_limits_mps[index]

    def position_at(self, distance_m: float) -> Position:
        """The point at the same share of polyline length as ``distance_m`` of route distance.

        Edge lengths come from the same geometry as the polyline, so the share of route distance
        travelled is the share of polyline length; this also tolerates small length mismatches.
        """
        offsets = self._polyline_offsets_m
        fraction = distance_m / self.total_distance_m
        target = min(max(fraction, 0.0), 1.0) * offsets[-1]
        index = min(bisect_right(offsets, target), len(self._polyline) - 1) - 1
        (lng_a, lat_a), (lng_b, lat_b) = self._polyline[index], self._polyline[index + 1]
        length = offsets[index + 1] - offsets[index]
        t = 0.0 if length == 0 else (target - offsets[index]) / length
        return Position(lat=lat_a + (lat_b - lat_a) * t, lng=lng_a + (lng_b - lng_a) * t)
