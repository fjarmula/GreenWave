"""Coordinate helpers. WGS84 is converted to the metric CRS once; distances use the result."""

import geopandas as gpd
import numpy as np
import shapely
from numpy.typing import NDArray

from greenwave.etl.config import METRIC_CRS, SOURCE_CRS


def project_points(lons: NDArray[np.float64], lats: NDArray[np.float64]) -> NDArray[np.float64]:
    """Return an ``(n, 2)`` array of metric-CRS ``(x, y)`` for WGS84 lon/lat arrays."""
    if len(lons) == 0:
        return np.empty((0, 2), dtype=np.float64)
    series = gpd.GeoSeries(gpd.points_from_xy(lons, lats), crs=SOURCE_CRS).to_crs(METRIC_CRS)
    return np.asarray(shapely.get_coordinates(series.values), dtype=np.float64)


def project_lines(lines: list[shapely.LineString]) -> NDArray[np.object_]:
    """Project WGS84 line geometries to the metric CRS; returns an array of shapely geometries."""
    if not lines:
        return np.empty(0, dtype=object)
    series = gpd.GeoSeries(lines, crs=SOURCE_CRS).to_crs(METRIC_CRS)
    return np.asarray(series.values, dtype=object)


def unproject_points(xy: NDArray[np.float64]) -> NDArray[np.float64]:
    """Return an ``(n, 2)`` array of WGS84 ``(lon, lat)`` for metric-CRS ``(x, y)`` points."""
    if len(xy) == 0:
        return np.empty((0, 2), dtype=np.float64)
    series = gpd.GeoSeries(shapely.points(xy), crs=METRIC_CRS).to_crs(SOURCE_CRS)
    return np.asarray(shapely.get_coordinates(series.values), dtype=np.float64)
