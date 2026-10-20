"""Representative WGS84 points for OSM features."""

from typing import cast

from shapely.geometry import MultiPolygon, Polygon

from greenwave.etl.ingest_osm import OsmFeature


def feature_point(feature: OsmFeature) -> tuple[float, float] | None:
    """Return ``(lon, lat)``: the point itself, ``point_on_surface`` for polygons, else None.

    The extract encodes closed OSM ways (buildings, station outlines) as ``LineString`` with the
    first coordinate repeated last; those are polygon rings. Open lines have no point (None).
    """
    coordinates = cast("list[object]", feature.coordinates)
    try:
        if feature.geometry_type == "Point":
            lon, lat = cast("list[float]", coordinates)[:2]
            return float(lon), float(lat)
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
        geometry = geometry.buffer(0)
        if geometry.is_empty:
            return None
    surface = geometry.point_on_surface()
    return float(surface.x), float(surface.y)
