"""Scan the OSM extract once and weld near-miss way ends, so every ETL step sees the same ways."""

import logging
from dataclasses import dataclass, replace
from pathlib import Path

import polars as pl

from greenwave.etl.graph import build_graph
from greenwave.etl.manifest import verify_raw_inputs
from greenwave.etl.near_misses import MAIN_ROAD_CLASSES, NearMissReport, find_near_misses
from greenwave.etl.profile import OSM_RELATIVE_PATH
from greenwave.etl.profile_osm import OsmScan, scan_osm
from greenwave.etl.road_rules import is_routable_way
from greenwave.etl.weld import WeldReport, weld_ways

logger = logging.getLogger(__name__)

TERTIARY_PLUS_FILENAME = "near_misses_tertiary_plus.csv"
WELDS_FILENAME = "welds.csv"


@dataclass(slots=True)
class PreparedScan:
    scan: OsmScan  # drivable_ways are the welded ways
    inputs_sha256: dict[str, str]
    near_misses_before: pl.DataFrame
    near_miss_report_before: NearMissReport
    weld_report: WeldReport


def prepare_scan(raw_dir: Path) -> PreparedScan:
    inputs_sha256 = verify_raw_inputs(raw_dir)
    scan = scan_osm(raw_dir / OSM_RELATIVE_PATH)
    routable = [way for way in scan.drivable_ways if is_routable_way(way)]
    near_frame, near_report = find_near_misses(build_graph(routable).graph, routable)
    welded_routable, weld_report = weld_ways(routable, near_frame)
    welded_by_line = {way.line_number: way for way in welded_routable}
    ways = [welded_by_line.get(way.line_number, way) for way in scan.drivable_ways]
    logger.info(
        "welded %d of %d near-miss candidates (%d near-misses within the check tolerance)",
        weld_report.welded,
        weld_report.candidates,
        near_report.near_misses,
    )
    return PreparedScan(
        scan=replace(scan, drivable_ways=ways),
        inputs_sha256=inputs_sha256,
        near_misses_before=near_frame,
        near_miss_report_before=near_report,
        weld_report=weld_report,
    )


def tertiary_plus_cases(near_frame: pl.DataFrame, weld_report: WeldReport) -> pl.DataFrame:
    """Near-misses that involve a road of class tertiary or above, with what the weld step did."""
    status: dict[tuple[int, int], str] = {}
    for weld in weld_report.welds:
        status[(weld.way_line, weld.other_way_line)] = f"welded ({weld.action})"
    for skipped in weld_report.skipped_candidates:
        status[(skipped.way_line, skipped.other_way_line)] = f"not welded: {skipped.reason}"
    main = near_frame.filter(
        pl.col("highway").is_in(MAIN_ROAD_CLASSES)
        | pl.col("other_highway").is_in(MAIN_ROAD_CLASSES)
    )
    return main.with_columns(
        pl.struct("way_line", "other_way_line", "distance_m")
        .map_elements(
            lambda row: status.get(
                (row["way_line"], row["other_way_line"]),
                f"not welded: {row['distance_m']:.2f} m is beyond the weld tolerance",
            ),
            return_dtype=pl.String,
        )
        .alias("weld_status")
    )


def welds_frame(weld_report: WeldReport) -> pl.DataFrame:
    return pl.DataFrame([w.model_dump() for w in weld_report.welds])
