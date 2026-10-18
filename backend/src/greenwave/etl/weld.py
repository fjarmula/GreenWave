"""Weld way ends that stop just short of another way (near-misses within the weld tolerance).

The graph connects ways only at exactly shared vertices, so a way ending 0.3 m from another's body
is silently disconnected. Welding gives the two ways a shared vertex: the end moves onto the other
way's node, or onto a new vertex inserted into the other way. Ways on different layers, bridges or
tunnels are never welded. Every weld and every skipped candidate is logged.
"""

from collections.abc import Iterable
from dataclasses import dataclass, replace

import polars as pl
import shapely
from pydantic import BaseModel

from greenwave.etl.config import WELD_TOLERANCE_METERS
from greenwave.etl.graph import node_key
from greenwave.etl.near_misses import KIND_END_TO_NODE, KIND_END_TO_SEGMENT
from greenwave.etl.profile_osm import DrivableWay, LonLat, tag

_DECIMALS = 7
_LEVEL_SKIP = "different layer, bridge or tunnel"
ACTION_MOVED_TO_NODE = "moved_end_to_node"
ACTION_MOVED_TO_VERTEX = "moved_end_to_vertex"
ACTION_INSERTED_VERTEX = "inserted_vertex"


class WeldRecord(BaseModel):
    action: str
    kind: str
    distance_m: float
    way_line: int
    other_way_line: int
    street: str | None
    other_street: str | None
    highway: str
    other_highway: str
    old_lon: float
    old_lat: float
    new_lon: float
    new_lat: float


class SkippedWeld(BaseModel):
    reason: str
    kind: str
    distance_m: float
    way_line: int
    other_way_line: int
    street: str | None
    other_street: str | None
    highway: str
    other_highway: str
    lon: float
    lat: float


class WeldReport(BaseModel):
    tolerance_m: float
    candidates: int
    welded: int
    skipped: int
    welded_by_action: dict[str, int]
    skipped_by_reason: dict[str, int]
    welds: list[WeldRecord]
    skipped_candidates: list[SkippedWeld]


@dataclass(frozen=True, slots=True)
class _Candidate:
    """One row of the near-miss table (same columns as ``near_misses``)."""

    kind: str
    distance_m: float
    lon: float
    lat: float
    other_lon: float
    other_lat: float
    way_line: int
    other_way_line: int
    street: str | None
    other_street: str | None
    highway: str
    other_highway: str


def level_signature(way: DrivableWay) -> tuple[str, bool, bool]:
    """(layer, on a bridge, in a tunnel): two ways may only be welded when these are equal."""
    return (
        tag(way.properties, "layer") or "0",
        tag(way.properties, "bridge") not in (None, "no"),
        tag(way.properties, "tunnel") not in (None, "no"),
    )


def _rounded(point: tuple[float, float]) -> LonLat:
    return round(point[0], _DECIMALS), round(point[1], _DECIMALS)


def _insert_position(coordinates: list[LonLat], point: LonLat) -> tuple[int, LonLat]:
    """Index at which to insert the point nearest to ``point`` on the polyline, and that point."""
    line = shapely.LineString(coordinates)
    along = line.project(shapely.Point(point))
    nearest = _rounded((line.interpolate(along).x, line.interpolate(along).y))
    best_index, best_distance = 0, float("inf")
    for index in range(len(coordinates) - 1):
        segment = shapely.LineString([coordinates[index], coordinates[index + 1]])
        distance = segment.distance(shapely.Point(nearest))
        if distance < best_distance:
            best_index, best_distance = index, distance
    return best_index + 1, nearest


def weld_ways(
    ways: list[DrivableWay],
    near_misses: pl.DataFrame,
    tolerance_meters: float = WELD_TOLERANCE_METERS,
) -> tuple[list[DrivableWay], WeldReport]:
    """Return the ways with welds applied (inputs are not modified) and a log of every decision."""
    if tolerance_meters <= 0:
        raise ValueError("weld tolerance must be positive (metres)")
    candidates = near_misses.filter(pl.col("distance_m") <= tolerance_meters).sort(
        "distance_m", "way_line", "other_way_line"
    )
    welder = _Welder(ways)
    for row in candidates.iter_rows(named=True):
        welder.consider(_Candidate(**row))
    report = WeldReport(
        tolerance_m=tolerance_meters,
        candidates=candidates.height,
        welded=len(welder.welds),
        skipped=len(welder.skipped),
        welded_by_action=_count(w.action for w in welder.welds),
        skipped_by_reason=_count(s.reason for s in welder.skipped),
        welds=welder.welds,
        skipped_candidates=welder.skipped,
    )
    return welder.welded_ways(ways), report


@dataclass(frozen=True, slots=True)
class _Weld:
    action: str
    end_index: int  # 0 = the way's first vertex moves, -1 = its last
    end_point: LonLat
    new_point: LonLat
    moved: list[LonLat]  # the welded way's coordinates after the move
    insert_at: int | None  # where the new vertex goes into the other way, if one is inserted


class _Welder:
    """Applies welds closest-first to working copies of the ways' coordinates."""

    def __init__(self, ways: list[DrivableWay]) -> None:
        self.by_line = {way.line_number: way for way in ways}
        self.coordinates = {way.line_number: list(way.coordinates) for way in ways}
        self.lines_at_vertex: dict[str, set[int]] = {}
        for way in ways:
            for lon, lat in way.coordinates:
                self.lines_at_vertex.setdefault(node_key(lon, lat), set()).add(way.line_number)
        self.touched_ends: set[tuple[int, int]] = set()  # (way line, 0 = first / -1 = last)
        self.welds: list[WeldRecord] = []
        self.skipped: list[SkippedWeld] = []

    def consider(self, c: _Candidate) -> None:
        decision = self._decide(c)
        if isinstance(decision, str):
            self.skipped.append(_skip_record(c, decision))
        else:
            self._apply(c, decision)

    def _decide(self, c: _Candidate) -> _Weld | str:
        """The weld to make, or the reason to skip (checked in this order)."""
        way, other = self.by_line[c.way_line], self.by_line[c.other_way_line]
        end_point = _rounded((c.lon, c.lat))
        own = self.coordinates[c.way_line]
        end_index = 0 if own[0] == end_point else (-1 if own[-1] == end_point else None)
        if end_index is None or (c.way_line, end_index) in self.touched_ends:
            return "endpoint already moved by another weld"

        insert_at: int | None = None
        if c.kind == KIND_END_TO_NODE:
            new_point = _rounded((c.other_lon, c.other_lat))
            involved = self.lines_at_vertex.get(node_key(*new_point), {c.other_way_line})
            if any(level_signature(self.by_line[n]) != level_signature(way) for n in involved):
                return _LEVEL_SKIP
            action = ACTION_MOVED_TO_NODE
        elif c.kind == KIND_END_TO_SEGMENT:
            if level_signature(other) != level_signature(way):
                return _LEVEL_SKIP
            position, new_point = _insert_position(self.coordinates[c.other_way_line], end_point)
            if new_point in self.coordinates[c.other_way_line]:
                action = ACTION_MOVED_TO_VERTEX
            else:
                action, insert_at = ACTION_INSERTED_VERTEX, position
        else:
            return f"unknown near-miss kind {c.kind!r}"

        moved = list(own)
        moved[end_index] = new_point
        if len({*moved}) < 2:
            return "welding would collapse the way to a point"
        return _Weld(action, end_index, end_point, new_point, moved, insert_at)

    def _apply(self, c: _Candidate, weld: _Weld) -> None:
        self.coordinates[c.way_line] = weld.moved
        if weld.insert_at is not None:
            self.coordinates[c.other_way_line].insert(weld.insert_at, weld.new_point)
        self.touched_ends.add((c.way_line, weld.end_index))
        self.lines_at_vertex.setdefault(node_key(*weld.new_point), set()).update(
            {c.way_line, c.other_way_line}
        )
        self.welds.append(_weld_record(c, weld))

    def welded_ways(self, ways: list[DrivableWay]) -> list[DrivableWay]:
        changed = {
            line
            for line, coords in self.coordinates.items()
            if coords != self.by_line[line].coordinates
        }
        return [
            replace(way, coordinates=self.coordinates[way.line_number])
            if way.line_number in changed
            else way
            for way in ways
        ]


def _skip_record(c: _Candidate, reason: str) -> SkippedWeld:
    return SkippedWeld(
        reason=reason,
        kind=c.kind,
        distance_m=c.distance_m,
        way_line=c.way_line,
        other_way_line=c.other_way_line,
        street=c.street,
        other_street=c.other_street,
        highway=c.highway,
        other_highway=c.other_highway,
        lon=c.lon,
        lat=c.lat,
    )


def _weld_record(c: _Candidate, weld: _Weld) -> WeldRecord:
    return WeldRecord(
        action=weld.action,
        kind=c.kind,
        distance_m=c.distance_m,
        way_line=c.way_line,
        other_way_line=c.other_way_line,
        street=c.street,
        other_street=c.other_street,
        highway=c.highway,
        other_highway=c.other_highway,
        old_lon=weld.end_point[0],
        old_lat=weld.end_point[1],
        new_lon=weld.new_point[0],
        new_lat=weld.new_point[1],
    )


def _count(values: Iterable[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return dict(sorted(counts.items()))
