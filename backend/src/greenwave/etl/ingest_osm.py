"""Stream the BBBike OSM GeoJSON, which holds one feature per line (~310 MB, ~1M features)."""

import json
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import cast

_FEATURE_PREFIX = '{"type":"Feature"'


@dataclass(frozen=True, slots=True)
class OsmFeature:
    line_number: int
    geometry_type: str
    coordinates: object
    properties: dict[str, object]


@dataclass(frozen=True, slots=True)
class MalformedRecord:
    line_number: int
    reason: str


def iter_osm_records(path: Path) -> Iterator[OsmFeature | MalformedRecord]:
    """Yield every feature line as an ``OsmFeature``, or a ``MalformedRecord`` saying why not.

    The first line (collection header) and the closing ``]}`` are skipped; any other line that is
    not a feature is reported rather than ignored.
    """
    with path.open(encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.strip()
            if not line or line == "]}" or line.startswith('{"type":"FeatureCollection"'):
                continue
            if not line.startswith(_FEATURE_PREFIX):
                yield MalformedRecord(line_number, "line is not a GeoJSON feature")
                continue
            yield _parse_feature(line_number, line.removesuffix(","))


def _parse_feature(line_number: int, text: str) -> OsmFeature | MalformedRecord:
    try:
        parsed: object = json.loads(text)
    except json.JSONDecodeError as error:
        return MalformedRecord(line_number, f"invalid JSON: {error.msg}")
    if not isinstance(parsed, dict):
        return MalformedRecord(line_number, "feature is not a JSON object")
    feature = cast("dict[str, object]", parsed)
    geometry = feature.get("geometry")
    properties = feature.get("properties")
    if not isinstance(geometry, dict):
        return MalformedRecord(line_number, "missing or null geometry")
    geometry_type = geometry.get("type")
    if not isinstance(geometry_type, str) or "coordinates" not in geometry:
        return MalformedRecord(line_number, "geometry has no type or coordinates")
    if properties is None:
        properties = {}
    if not isinstance(properties, dict):
        return MalformedRecord(line_number, "properties is not an object")
    return OsmFeature(
        line_number=line_number,
        geometry_type=geometry_type,
        coordinates=geometry["coordinates"],
        properties=cast("dict[str, object]", properties),
    )
