"""Helpers that write tiny OSM-extract-shaped GeoJSON files (compact JSON, one feature per line)."""

import json
from pathlib import Path


def _feature(geometry: dict[str, object], tags: dict[str, str]) -> str:
    return json.dumps(
        {"type": "Feature", "geometry": geometry, "properties": tags}, separators=(",", ":")
    )


def point(lon: float, lat: float, **tags: str) -> str:
    return _feature({"type": "Point", "coordinates": [lon, lat]}, tags)


def line(coordinates: list[tuple[float, float]], **tags: str) -> str:
    return _feature({"type": "LineString", "coordinates": [list(c) for c in coordinates]}, tags)


def write_osm(directory: Path, *features: str) -> Path:
    path = directory / "osm.geojson"
    header = '{"type":"FeatureCollection","features":['
    path.write_text(f"{header}\n" + ",\n".join(features) + "\n]}\n", encoding="utf-8")
    return path


def polygon(ring: list[tuple[float, float]], **tags: str) -> str:
    return _feature({"type": "Polygon", "coordinates": [[list(c) for c in ring]]}, tags)


def closed_way(ring: list[tuple[float, float]], **tags: str) -> str:
    """A closed OSM way as the real extract encodes it: a LineString ending at its first coord."""
    return line([*ring, ring[0]], **tags)
