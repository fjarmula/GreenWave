"""Step T1 orchestration: verify inputs, scan the OSM extract, write the ``profile`` section."""

import logging
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path

import numpy as np
import shapely

from greenwave.etl.config import SAMPLE_LIMIT
from greenwave.etl.geo import project_points
from greenwave.etl.manifest import InputIntegrityError, verify_raw_inputs
from greenwave.etl.profile_krakow import profile_krakow
from greenwave.etl.profile_models import (
    ClaimCheck,
    GeometryProfile,
    ProfileSection,
    RoadsProfile,
    SignalsProfile,
    UliceProfile,
)
from greenwave.etl.profile_osm import OsmScan, scan_osm
from greenwave.etl.profile_roads import RoadAnalysis, analyse_roads, drivable_definition_text
from greenwave.etl.profile_signals import analyse_signals

logger = logging.getLogger(__name__)

OSM_RELATIVE_PATH = "osm/planet_19.792_50.012_71450a13.osm.geojson"
_ULICE_BBOX_MARGIN_METERS = 1000.0


def _geometry_profile(scan: OsmScan, outline: shapely.Geometry) -> GeometryProfile:
    xy = project_points(np.array(scan.point_lons), np.array(scan.point_lats))
    inside = shapely.contains_xy(outline, xy[:, 0], xy[:, 1])
    return GeometryProfile(
        total_features=scan.total_features,
        features_by_geometry_type=dict(scan.features_by_geometry_type.most_common()),
        malformed_lines=scan.malformed_count,
        malformed_samples=[f"line {m.line_number}: {m.reason}" for m in scan.malformed],
        invalid_geometry_count=scan.invalid_count,
        invalid_by_reason=dict(scan.invalid_by_reason.most_common()),
        invalid_samples=scan.invalid_samples[:SAMPLE_LIMIT],
        non_string_tag_values=scan.non_string_tag_values,
        bbox=scan.bbox_model(),
        points_total=len(xy),
        points_outside_city_proxy=int((~inside).sum()),
        city_outline_proxy=(
            "convex hull of Ulice.geojson street lines; the OSM extract has no city polygon "
            "(only some district polygons), so this is a rough proxy, not an official boundary"
        ),
    )


def _roads_profile(scan: OsmScan, roads: RoadAnalysis, outline: shapely.Geometry) -> RoadsProfile:
    return RoadsProfile(
        drivable_definition=drivable_definition_text(),
        linestrings_with_highway=scan.linestrings_with_highway,
        highway_tagged_polygons=scan.highway_tagged_polygons,
        highway_value_counts=dict(scan.highway_value_counts.most_common()),
        drivable_ways=len(scan.drivable_ways),
        drivable_ways_excluded_by_access=scan.drivable_excluded_by_access,
        drivable_length_km=float(roads.lengths_m.sum()) / 1000,
        drivable_distinct_vertices=len(roads.topology.ways_per_vertex),
        service_subtype_counts=dict(roads.service_subtypes.most_common()),
        maxspeed_unparsed_values=dict(roads.maxspeed_unparsed.most_common()),
        oneway_values=dict(roads.oneway_values.most_common()),
        overall=roads.overall,
        by_road_class=roads.by_class,
        drivable_ways_outside_city_proxy=int(
            (~shapely.intersects(outline, roads.projected_lines)).sum()
        ),
    )


def _check_ulice_matches_metric_crs(scan: OsmScan, ulice: UliceProfile) -> None:
    """Fail if Ulice.geojson is not where the projected OSM extract is (wrong CRS assumption)."""
    if scan.bbox is None:
        raise InputIntegrityError("OSM extract has no valid geometries")
    corners = project_points(
        np.array([scan.bbox[0], scan.bbox[2]]), np.array([scan.bbox[1], scan.bbox[3]])
    )
    low = corners.min(axis=0) - _ULICE_BBOX_MARGIN_METERS
    high = corners.max(axis=0) + _ULICE_BBOX_MARGIN_METERS
    u_min_x, u_min_y, u_max_x, u_max_y = ulice.bbox_in_metric_crs
    if not (low[0] <= u_min_x and u_max_x <= high[0] and low[1] <= u_min_y and u_max_y <= high[1]):
        raise InputIntegrityError(
            "Ulice.geojson extent is not inside the projected OSM extent; "
            "its CRS is not the assumed EPSG:2178 or the files cover different areas"
        )


def _claims(
    geometry: GeometryProfile,
    roads: RoadsProfile,
    signals: SignalsProfile,
    ulice: UliceProfile,
    bus_lane_rows: int,
    tram_line_rows: int,
) -> list[ClaimCheck]:
    """Compare measurements with the snapshot baselines defined below."""
    by_type = geometry.features_by_geometry_type
    clusters = {int(c.radius_m): c.clusters for c in signals.clustering_all}
    variants = signals.tag_variants
    cross = signals.crossings
    rows: list[tuple[str, float, float, bool]] = [
        ("total features", 1_022_742, geometry.total_features, False),
        ("LineString features", 458_955, by_type.get("LineString", 0), False),
        ("Point features", 316_164, by_type.get("Point", 0), False),
        ("MultiPolygon features", 247_623, by_type.get("MultiPolygon", 0), False),
        ("highway=traffic_signals points", 997, signals.signal_nodes, False),
        ("traffic_signals tag empty/absent", 779, variants.get("<absent>", 0), False),
        ("traffic_signals=signal", 169, variants.get("signal", 0), False),
        ("traffic_signals=traffic_lights", 34, variants.get("traffic_lights", 0), False),
        ("traffic_signals=blinker", 10, variants.get("blinker", 0), False),
        ("traffic_signals=tram_priority", 3, variants.get("tram_priority", 0), False),
        ("traffic_signals=controller", 2, variants.get("controller", 0), False),
        ("signals with traffic_signals:direction", 281, signals.with_direction, False),
        ("drivable ways", 50_107, roads.drivable_ways, False),
        ("drivable distinct vertices", 211_082, roads.drivable_distinct_vertices, False),
        ("signals on a drivable-road vertex", 976, signals.on_drivable_vertex, False),
        (
            "signals at a junction vertex (2+ ways)",
            168,
            signals.vertex_position.get("junction", 0),
            False,
        ),
        (
            "signals not at a junction vertex",
            808,
            signals.on_drivable_vertex - signals.vertex_position.get("junction", 0),
            False,
        ),
        ("signal groups at 15 m", 891, clusters.get(15, -1), False),
        ("signal groups at 30 m", 682, clusters.get(30, -1), False),
        ("signal groups at 50 m", 377, clusters.get(50, -1), False),
        ("points tagged crossing=traffic_signals (excl. signal nodes)", 1507, cross.total, False),
        (
            "crossings within 30 m of any signal node",
            1435,
            cross.within_radius_of_any_signal["30"],
            False,
        ),
        ("Ulice features", 3036, ulice.features, False),
        ("Ulice LineString", 2799, ulice.features_by_geometry_type.get("LineString", 0), False),
        (
            "Ulice MultiLineString",
            237,
            ulice.features_by_geometry_type.get("MultiLineString", 0),
            False,
        ),
        ("Ulice total length km (approx.)", 1596, ulice.total_length_km, True),
        ("bus lane CSV rows (approx.)", 300, bus_lane_rows, True),
        ("tram line CSV rows", 54, tram_line_rows, False),
    ]
    return [
        ClaimCheck(
            claim=claim,
            documented=documented,
            measured=measured,
            matches=(abs(measured - documented) <= 0.05 * documented)
            if approximate
            else measured == documented,
        )
        for claim, documented, measured, approximate in rows
    ]


def run_profile(raw_dir: Path) -> ProfileSection:
    inputs_sha256 = verify_raw_inputs(raw_dir)

    logger.info("profiling Kraków open data")
    krakow, outline = profile_krakow(raw_dir / "krakow")
    logger.info("scanning OSM extract")
    scan = scan_osm(raw_dir / OSM_RELATIVE_PATH)
    _check_ulice_matches_metric_crs(scan, krakow.ulice)

    logger.info("analysing roads")
    roads_analysis = analyse_roads(scan)
    geometry = _geometry_profile(scan, outline)
    roads = _roads_profile(scan, roads_analysis, outline)
    logger.info("analysing signals")
    signals = analyse_signals(scan, roads_analysis, outline)

    csv_rows = {csv_file.file: csv_file.rows for csv_file in krakow.csv_files}
    bus_rows = next((rows for name, rows in csv_rows.items() if name.startswith("Buspasy")), -1)
    tram_rows = next((rows for name, rows in csv_rows.items() if name.startswith("Linie_KMK")), -1)

    return ProfileSection(
        generated_at_utc=datetime.now(UTC).isoformat(timespec="seconds"),
        inputs_sha256=inputs_sha256,
        library_versions={
            name: version(name) for name in ("shapely", "geopandas", "pyproj", "numpy")
        },
        geometry=geometry,
        roads=roads,
        signals=signals,
        krakow=krakow,
        claims_check=_claims(geometry, roads, signals, krakow.ulice, bus_rows, tram_rows),
    )
