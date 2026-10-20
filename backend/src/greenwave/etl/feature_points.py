"""Representative WGS84 points and outlines for OSM features."""

from typing import cast

from shapely.geometry import MultiPolygon, Polygon

from greenwave.etl.ingest_osm import OsmFeature


def feature_outline(feature: OsmFeature) -> Polygon | MultiPolygon | None:
    """The ``(lon, lat)`` area of a polygonal feature, repaired if invalid; None otherwise.

    The extract encodes closed OSM ways (buildings, station outlines) as ``LineString`` with the
    first coordinate repeated last; those are polygon rings. Points and open lines have no outline.
    """
    coordinates = cast("list[object]", feature.coordinates)
    geometry: Polygon | MultiPolygon
    try:
        if feature.geometry_type == "Polygon":
            geometry = Polygon(
                cast("list[float]", coordinates[0]), cast("list[list[float]]", coordinates[1:])
            )
        elif feature.geometry_type == "LineString":
            ring = cast("list[list[float]]", coordinates)
            if len(ring) < 4 or ring[0] != ring[-1]:
                return None
            geometry = Polygon(ring)
        elif feature.geometry_type == "MultiPolygon":
            geometry = MultiPolygon(
                [
                    (cast("list[float]", rings[0]), cast("list[list[float]]", rings[1:]))
                    for rings in cast("list[list[object]]", coordinates)
                ]
            )
        else:
            return None
    except (ValueError, TypeError, IndexError):
        return None
    if geometry.is_empty:
        return None
    if not geometry.is_valid:
        geometry = cast("Polygon | MultiPolygon", geometry.buffer(0))
        if geometry.is_empty:
            return None
    return geometry


def feature_point(feature: OsmFeature) -> tuple[float, float] | None:
    """Return ``(lon, lat)``: the point itself, ``point_on_surface`` of an outline, else None."""
    if feature.geometry_type == "Point":
        try:
            lon, lat = cast("list[float]", feature.coordinates)[:2]
        except (ValueError, TypeError):
            return None
        return float(lon), float(lat)
    outline = feature_outline(feature)
    if outline is None:
        return None
    surface = outline.point_on_surface()
    return float(surface.x), float(surface.y)
