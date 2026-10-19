"""T1 pass over the OSM extract: geometry validation, bbox, and collection of roads and signals."""

import logging
import math
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import cast

import shapely
from shapely.geometry import shape
from shapely.validation import explain_validity

from greenwave.etl.config import (
    DRIVABLE_HIGHWAY_VALUES,
    EXCLUDED_ACCESS_VALUES,
    SAMPLE_LIMIT,
)
from greenwave.etl.ingest_osm import MalformedRecord, OsmFeature, iter_osm_records
from greenwave.etl.profile_models import Bbox, InvalidGeometrySample

logger = logging.getLogger(__name__)

LonLat = tuple[float, float]


@dataclass(slots=True)
class DrivableWay:
    line_number: int
    highway: str
    coordinates: list[LonLat]
    properties: dict[str, object]


@dataclass(slots=True)
class PointFeature:
    line_number: int
    lon: float
    lat: float
    properties: dict[str, object]


@dataclass(slots=True)
class OsmScan:
    features_by_geometry_type: Counter[str] = field(default_factory=Counter)
    malformed: list[MalformedRecord] = field(default_factory=list)
    malformed_count: int = 0
    invalid_by_reason: Counter[str] = field(default_factory=Counter)
    invalid_samples: list[InvalidGeometrySample] = field(default_factory=list)
    non_string_tag_values: int = 0
    bbox: list[float] | None = None  # min_lon, min_lat, max_lon, max_lat
    point_lons: list[float] = field(default_factory=list)
    point_lats: list[float] = field(default_factory=list)
    highway_value_counts: Counter[str] = field(default_factory=Counter)
    linestrings_with_highway: int = 0
    highway_tagged_polygons: int = 0
    drivable_excluded_by_access: int = 0
    drivable_ways: list[DrivableWay] = field(default_factory=list)
    signal_nodes: list[PointFeature] = field(default_factory=list)
    signal_features_not_points: int = 0
    # Points tagged crossing=traffic_signals that are not also highway=traffic_signals.
    signalised_crossings: list[PointFeature] = field(default_factory=list)
    signal_nodes_also_tagged_crossing: int = 0
    # Points tagged traffic_calming (any value except "no").
    calming_points: list[PointFeature] = field(default_factory=list)
    # Valid LineStrings tagged railway=tram, with or without a highway tag.
    tram_lines: list[list[LonLat]] = field(default_factory=list)

    @property
    def total_features(self) -> int:
        return sum(self.features_by_geometry_type.values())

    @property
    def invalid_count(self) -> int:
        return sum(self.invalid_by_reason.values())

    def bbox_model(self) -> Bbox | None:
        if self.bbox is None:
            return None
        return Bbox(
            min_lon=self.bbox[0], min_lat=self.bbox[1], max_lon=self.bbox[2], max_lat=self.bbox[3]
        )

    def _extend_bbox(self, min_lon: float, min_lat: float, max_lon: float, max_lat: float) -> None:
        if self.bbox is None:
            self.bbox = [min_lon, min_lat, max_lon, max_lat]
            return
        self.bbox[0] = min(self.bbox[0], min_lon)
        self.bbox[1] = min(self.bbox[1], min_lat)
        self.bbox[2] = max(self.bbox[2], max_lon)
        self.bbox[3] = max(self.bbox[3], max_lat)


def tag(properties: dict[str, object], key: str) -> str | None:
    value = properties.get(key)
    return value if isinstance(value, str) else None


def crossing_kind(crossing: PointFeature) -> str:
    """``highway=crossing``, ``railway=tram_crossing``, ... for a crossing=traffic_signals node."""
    for key in ("highway", "railway"):
        value = tag(crossing.properties, key)
        if value is not None:
            return f"{key}={value}"
    return "<no highway/railway tag>"


def _lon_lat_in_range(lon: float, lat: float) -> bool:
    return math.isfinite(lon) and math.isfinite(lat) and -180 <= lon <= 180 and -90 <= lat <= 90


def _record_invalid(scan: OsmScan, feature: OsmFeature, reason: str) -> None:
    scan.invalid_by_reason[reason] += 1
    if len(scan.invalid_samples) < SAMPLE_LIMIT:
        scan.invalid_samples.append(
            InvalidGeometrySample(
                line_number=feature.line_number,
                geometry_type=feature.geometry_type,
                reason=reason,
            )
        )


def _point_lon_lat(coordinates: object) -> LonLat | None:
    if (
        isinstance(coordinates, list)
        and len(coordinates) >= 2
        and all(isinstance(value, int | float) for value in coordinates[:2])
    ):
        lon, lat = float(coordinates[0]), float(coordinates[1])
        if _lon_lat_in_range(lon, lat):
            return lon, lat
    return None


def _validate_non_point(scan: OsmScan, feature: OsmFeature) -> shapely.Geometry | None:
    """Return the shapely geometry when it is valid and in lon/lat range, else record why not."""
    try:
        geometry = shape({"type": feature.geometry_type, "coordinates": feature.coordinates})
    except (ValueError, TypeError, IndexError, shapely.errors.GEOSException) as error:
        _record_invalid(scan, feature, f"unparseable geometry: {type(error).__name__}")
        return None
    if geometry.is_empty:
        _record_invalid(scan, feature, "empty geometry")
        return None
    min_lon, min_lat, max_lon, max_lat = geometry.bounds
    if not (_lon_lat_in_range(min_lon, min_lat) and _lon_lat_in_range(max_lon, max_lat)):
        _record_invalid(scan, feature, "coordinates outside lon/lat range")
        return None
    scan._extend_bbox(min_lon, min_lat, max_lon, max_lat)
    if not geometry.is_valid:
        # explain_validity looks like "Self-intersection[19.9 50.0]"; keep only the reason.
        _record_invalid(scan, feature, explain_validity(geometry).split("[")[0])
        return None
    return cast("shapely.Geometry", geometry)


def _handle_linestring_with_highway(scan: OsmScan, feature: OsmFeature, highway: str) -> None:
    scan.linestrings_with_highway += 1
    scan.highway_value_counts[highway] += 1
    if highway not in DRIVABLE_HIGHWAY_VALUES:
        return
    if tag(feature.properties, "access") in EXCLUDED_ACCESS_VALUES:
        scan.drivable_excluded_by_access += 1
        return
    raw = cast("list[list[float]]", feature.coordinates)
    scan.drivable_ways.append(
        DrivableWay(
            line_number=feature.line_number,
            highway=highway,
            coordinates=[(float(c[0]), float(c[1])) for c in raw],
            properties=feature.properties,
        )
    )


def _scan_point(scan: OsmScan, feature: OsmFeature, highway: str | None) -> None:
    """Point bookkeeping: bbox, point coordinates, signals, signalised crossings, calming."""
    lon_lat = _point_lon_lat(feature.coordinates)
    if lon_lat is None:
        _record_invalid(scan, feature, "point with non-numeric or out-of-range coordinates")
        return
    lon, lat = lon_lat
    scan._extend_bbox(lon, lat, lon, lat)
    scan.point_lons.append(lon)
    scan.point_lats.append(lat)
    is_signalised_crossing = tag(feature.properties, "crossing") == "traffic_signals"
    if highway == "traffic_signals":
        scan.signal_nodes.append(PointFeature(feature.line_number, lon, lat, feature.properties))
        scan.signal_nodes_also_tagged_crossing += is_signalised_crossing
    elif is_signalised_crossing:
        scan.signalised_crossings.append(
            PointFeature(feature.line_number, lon, lat, feature.properties)
        )
    calming = tag(feature.properties, "traffic_calming")
    if calming is not None and calming != "no":
        scan.calming_points.append(PointFeature(feature.line_number, lon, lat, feature.properties))


def scan_osm(path: Path) -> OsmScan:
    """Single streaming pass; keeps what later steps need (roads, signals, points, trams)."""
    scan = OsmScan()
    for record in iter_osm_records(path):
        if isinstance(record, MalformedRecord):
            scan.malformed_count += 1
            if len(scan.malformed) < SAMPLE_LIMIT:
                scan.malformed.append(record)
            continue
        scan.features_by_geometry_type[record.geometry_type] += 1
        scan.non_string_tag_values += sum(
            1 for value in record.properties.values() if not isinstance(value, str)
        )
        highway = tag(record.properties, "highway")

        if record.geometry_type == "Point":
            _scan_point(scan, record, highway)
            continue

        geometry = _validate_non_point(scan, record)
        if highway == "traffic_signals":
            scan.signal_features_not_points += 1
        if (
            geometry is not None
            and record.geometry_type == "LineString"
            and tag(record.properties, "railway") == "tram"
        ):
            raw = cast("list[list[float]]", record.coordinates)
            scan.tram_lines.append([(float(c[0]), float(c[1])) for c in raw])
        if geometry is None or highway is None:
            continue
        if record.geometry_type == "LineString":
            _handle_linestring_with_highway(scan, record, highway)
        else:
            scan.highway_tagged_polygons += 1
    logger.info(
        "scanned %d features (%d malformed, %d invalid)",
        scan.total_features,
        scan.malformed_count,
        scan.invalid_count,
    )
    return scan
