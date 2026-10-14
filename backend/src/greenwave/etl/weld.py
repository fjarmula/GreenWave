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
    by_line = {way.line_number: way for way in ways}
    coordinates = {way.line_number: list(way.coordinates) for way in ways}
    lines_at_vertex: dict[str, set[int]] = {}
    for way in ways:
        for lon, lat in way.coordinates:
            lines_at_vertex.setdefault(node_key(lon, lat), set()).add(way.line_number)

    candidates = near_misses.filter(pl.col("distance_m") <= tolerance_meters).sort(
        "distance_m", "way_line", "other_way_line"
    )
    welds: list[WeldRecord] = []
    skipped: list[SkippedWeld] = []
    touched_ends: set[tuple[int, int]] = set()  # (way line, 0 = first vertex / -1 = last)

    for row in candidates.iter_rows(named=True):
        c = _Candidate(**row)
        way, other = by_line[c.way_line], by_line[c.other_way_line]
        end_point = _rounded((c.lon, c.lat))

        def skip(reason: str, c: _Candidate = c) -> None:
            skipped.append(
                SkippedWeld(
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
            )

        own = coordinates[c.way_line]
        end_index = 0 if own[0] == end_point else (-1 if own[-1] == end_point else None)
        if end_index is None or (c.way_line, end_index) in touched_ends:
            skip("endpoint already moved by another weld")
            continue

        insert_at: int | None = None
        if c.kind == KIND_END_TO_NODE:
            new_point = _rounded((c.other_lon, c.other_lat))
            involved = lines_at_vertex.get(node_key(*new_point), {c.other_way_line})
            if any(level_signature(by_line[n]) != level_signature(way) for n in involved):
                skip(_LEVEL_SKIP)
                continue
            action = ACTION_MOVED_TO_NODE
        elif c.kind == KIND_END_TO_SEGMENT:
            if level_signature(other) != level_signature(way):
                skip(_LEVEL_SKIP)
                continue
            position, new_point = _insert_position(coordinates[c.other_way_line], end_point)
            if new_point in coordinates[c.other_way_line]:
                action = ACTION_MOVED_TO_VERTEX
            else:
                action, insert_at = ACTION_INSERTED_VERTEX, position
        else:
            skip(f"unknown near-miss kind {c.kind!r}")
            continue

        moved = list(own)
        moved[end_index] = new_point
        if len({*moved}) < 2:
            skip("welding would collapse the way to a point")
            continue
        coordinates[c.way_line] = moved
        if insert_at is not None:
            coordinates[c.other_way_line].insert(insert_at, new_point)
        touched_ends.add((c.way_line, end_index))
        lines_at_vertex.setdefault(node_key(*new_point), set()).update(
            {c.way_line, c.other_way_line}
        )
        welds.append(
            WeldRecord(
                action=action,
                kind=c.kind,
                distance_m=c.distance_m,
                way_line=c.way_line,
                other_way_line=c.other_way_line,
                street=c.street,
                other_street=c.other_street,
                highway=c.highway,
                other_highway=c.other_highway,
                old_lon=end_point[0],
                old_lat=end_point[1],
                new_lon=new_point[0],
                new_lat=new_point[1],
            )
        )

    changed = {line for line, coords in coordinates.items() if coords != by_line[line].coordinates}
    welded_ways = [
        replace(way, coordinates=coordinates[way.line_number])
        if way.line_number in changed
        else way
        for way in ways
    ]
    report = WeldReport(
        tolerance_m=tolerance_meters,
        candidates=candidates.height,
        welded=len(welds),
        skipped=len(skipped),
        welded_by_action=_count(w.action for w in welds),
        skipped_by_reason=_count(s.reason for s in skipped),
        welds=welds,
        skipped_candidates=skipped,
    )
    return welded_ways, report


def _count(values: Iterable[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return dict(sorted(counts.items()))
