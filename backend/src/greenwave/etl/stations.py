"""Rescue-station extraction from OSM features: classify, name, dedupe and number."""

import json
import math
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

import numpy as np
import polars as pl

from greenwave.etl.config import (
    MERGE_SAME_NAME_AT_ANY_DISTANCE,
    POLICE_EXCLUDED_NAME_FRAGMENTS,
    STATION_DEDUP_RADIUS_M,
)
from greenwave.etl.feature_points import feature_point
from greenwave.etl.geo import project_points
from greenwave.etl.ingest_osm import OsmFeature
from greenwave.etl.street_names import normalise_street_name

# Representative points of two encodings of one way coincide; 1 m allows float noise only.
ENCODING_TWIN_MAX_APART_M = 1.0
_ID_KEYS = ("@id", "id", "osm_id")
_UNNAMED = {
    "AMBULANCE": "Ambulance station (unnamed)",
    "FIRE_TRUCK": "Fire station (unnamed)",
    "POLICE_CAR": "Police station (unnamed)",
}
_ID_LETTER = {"AMBULANCE": "A", "FIRE_TRUCK": "F", "POLICE_CAR": "P"}
_STATE_FIRE = re.compile(r"\bpsp\b|\bjednostka ratowniczo gasnicza\b")
_VOLUNTEER_FIRE = re.compile(r"\bosp\b|\bochotnicza\b")


@dataclass(frozen=True)
class StationCandidate:
    vehicle_type: str
    source_kind: str
    name: str
    lon: float
    lat: float
    osm_ref: str
    is_point: bool
    properties_key: str = ""


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _fire_kind(name: str) -> str:
    folded = normalise_street_name(name)
    if _STATE_FIRE.search(folded):
        return "fire_state"
    if _VOLUNTEER_FIRE.search(folded):
        return "fire_volunteer"
    return "fire_other"


def classify_station(properties: Mapping[str, object]) -> tuple[str, str] | None:
    """Return ``(vehicle_type, source_kind)`` for a station-tagged feature, else None."""
    if properties.get("emergency") == "ambulance_station":
        return "AMBULANCE", "ambulance_base"
    amenity = properties.get("amenity")
    if amenity == "hospital" and properties.get("emergency") == "yes":
        return "AMBULANCE", "hospital_ed"
    if amenity == "fire_station":
        return "FIRE_TRUCK", _fire_kind(_text(properties.get("name")))
    if amenity == "police":
        return "POLICE_CAR", "police"
    return None


def _osm_ref(feature: OsmFeature) -> str:
    ref = f"line:{feature.line_number}"
    for key in _ID_KEYS:
        value = feature.properties.get(key)
        if isinstance(value, str | int) and str(value):
            return f"{ref}|osm:{value}"
    return ref


def _excluded_police(name: str) -> bool:
    folded = normalise_street_name(name)
    return any(normalise_street_name(f) in folded for f in POLICE_EXCLUDED_NAME_FRAGMENTS)


def extract_station_candidates(
    features: Iterable[OsmFeature],
    no_point: list[str] | None = None,
    excluded: list[str] | None = None,
) -> list[StationCandidate]:
    """Station candidates in input order.

    Station features without a usable point are left out; their names are appended to
    ``no_point`` when given. Police features matching ``POLICE_EXCLUDED_NAME_FRAGMENTS`` are left
    out; their names are appended to ``excluded`` when given. Both lists feed the ETL report.
    """
    candidates: list[StationCandidate] = []
    for feature in features:
        classified = classify_station(feature.properties)
        if classified is None:
            continue
        vehicle_type, source_kind = classified
        name = _text(feature.properties.get("name")) or _text(feature.properties.get("operator"))
        if vehicle_type == "POLICE_CAR" and name and _excluded_police(name):
            if excluded is not None:
                excluded.append(name)
            continue
        coords = feature_point(feature)
        if coords is None:
            if no_point is not None:
                no_point.append(name or _UNNAMED[vehicle_type])
            continue
        candidates.append(
            StationCandidate(
                vehicle_type=vehicle_type,
                source_kind=source_kind,
                name=name or _UNNAMED[vehicle_type],
                lon=coords[0],
                lat=coords[1],
                osm_ref=_osm_ref(feature),
                is_point=feature.geometry_type == "Point",
                properties_key=json.dumps(feature.properties, sort_keys=True, default=str),
            )
        )
    return candidates


def _sort_key(c: StationCandidate) -> tuple[str, float, float, str]:
    return (c.vehicle_type, c.lat, c.lon, c.osm_ref)


def collapse_encoding_twins(
    candidates: Sequence[StationCandidate], max_apart_m: float = ENCODING_TWIN_MAX_APART_M
) -> tuple[list[StationCandidate], int]:
    """Collapse one closed way emitted twice (LineString and MultiPolygon) into one candidate.

    Twins have the same classification, identical properties and representative points within
    ``max_apart_m``. Applies to named and unnamed stations. Returns ``(kept, twins_collapsed)``.
    """
    groups: dict[tuple[str, str, str], list[StationCandidate]] = {}
    for cand in candidates:
        groups.setdefault((cand.vehicle_type, cand.source_kind, cand.properties_key), []).append(
            cand
        )
    kept: list[StationCandidate] = []
    twins = 0
    for group in groups.values():
        ordered = sorted(group, key=lambda c: (c.osm_ref, c.lat, c.lon))
        xy = project_points(
            np.array([c.lon for c in ordered], dtype=np.float64),
            np.array([c.lat for c in ordered], dtype=np.float64),
        )
        kept_idx: list[int] = []
        for i, cand in enumerate(ordered):
            if any(float(np.hypot(*(xy[i] - xy[j]))) <= max_apart_m for j in kept_idx):
                twins += 1
            else:
                kept_idx.append(i)
                kept.append(cand)
    return sorted(kept, key=_sort_key), twins


def dedupe_stations(
    candidates: Sequence[StationCandidate], radius_m: float = STATION_DEDUP_RADIUS_M
) -> tuple[list[StationCandidate], int]:
    """Merge same-type, same-folded-name candidates within ``radius_m``; keep points first.

    Types in ``MERGE_SAME_NAME_AT_ANY_DISTANCE`` merge same-name candidates at any distance.
    Unnamed (fallback-labelled) candidates are never merged. Returns ``(kept, merged_count)``.
    """
    unnamed = set(_UNNAMED.values())
    groups: dict[tuple[str, str], list[StationCandidate]] = {}
    kept: list[StationCandidate] = []
    for cand in candidates:
        folded = normalise_street_name(cand.name)
        if cand.name in unnamed or not folded:
            kept.append(cand)
        else:
            groups.setdefault((cand.vehicle_type, folded), []).append(cand)
    merged = 0
    for (vehicle_type, _), group in groups.items():
        limit = math.inf if vehicle_type in MERGE_SAME_NAME_AT_ANY_DISTANCE else radius_m
        ordered = sorted(group, key=lambda c: (not c.is_point, c.osm_ref, c.lat, c.lon))
        xy = project_points(
            np.array([c.lon for c in ordered], dtype=np.float64),
            np.array([c.lat for c in ordered], dtype=np.float64),
        )
        kept_idx: list[int] = []
        for i, cand in enumerate(ordered):
            if any(float(np.hypot(*(xy[i] - xy[j]))) <= limit for j in kept_idx):
                merged += 1
            else:
                kept_idx.append(i)
                kept.append(cand)
    return sorted(kept, key=_sort_key), merged


def assign_station_ids(candidates: Sequence[StationCandidate]) -> pl.DataFrame:
    """Number stations per vehicle type by (lat, lng, osm_ref): ``STN-F-0001`` etc."""
    rows: list[dict[str, object]] = []
    counters: dict[str, int] = {}
    for c in sorted(candidates, key=_sort_key):
        counters[c.vehicle_type] = counters.get(c.vehicle_type, 0) + 1
        rows.append(
            {
                "station_id": f"STN-{_ID_LETTER[c.vehicle_type]}-{counters[c.vehicle_type]:04d}",
                "vehicle_type": c.vehicle_type,
                "source_kind": c.source_kind,
                "name": c.name,
                "lat": c.lat,
                "lng": c.lon,
                "osm_ref": c.osm_ref,
            }
        )
    schema = {
        "station_id": pl.Utf8, "vehicle_type": pl.Utf8, "source_kind": pl.Utf8, "name": pl.Utf8,
        "lat": pl.Float64, "lng": pl.Float64, "osm_ref": pl.Utf8,
    }  # fmt: skip
    return pl.DataFrame(rows, schema=schema)
