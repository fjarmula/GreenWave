"""Step T3 orchestration: build the graph, write it, and run the connectivity and sanity checks."""

import json
import logging
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel

from greenwave.etl.connectivity import ConnectivityReport, analyse_connectivity
from greenwave.etl.graph import GraphBuildReport, build_graph
from greenwave.etl.graph_io import write_graph
from greenwave.etl.prepare import prepare_scan
from greenwave.etl.route_checks import RouteCheck, run_route_checks
from greenwave.etl.street_comparison import (
    StreetComparisonReport,
    compare_streets,
    graph_street_lengths,
    ulice_street_lengths,
)

logger = logging.getLogger(__name__)

STREET_TABLE_FILENAME = "street_length_comparison.csv"
ROUTES_FILENAME = "route_sanity_checks.geojson"


class GraphSection(BaseModel):
    generated_at_utc: str
    inputs_sha256: dict[str, str]
    welds_applied: int
    build: GraphBuildReport
    connectivity: ConnectivityReport
    street_comparison: StreetComparisonReport
    route_checks: list[RouteCheck]


def run_graph(raw_dir: Path, processed_dir: Path) -> GraphSection:
    prepared = prepare_scan(raw_dir)
    inputs_sha256, scan = prepared.inputs_sha256, prepared.scan

    logger.info("building graph")
    build = build_graph(scan.drivable_ways)
    write_graph(build.graph, processed_dir)

    logger.info("connectivity")
    connectivity = analyse_connectivity(build.graph)

    logger.info("street length comparison")
    graph_streets, unnamed_m = graph_street_lengths(build.graph)
    comparison = compare_streets(
        graph_streets, unnamed_m, ulice_street_lengths(raw_dir / "krakow" / "Ulice.geojson")
    )
    comparison.table.write_csv(processed_dir / STREET_TABLE_FILENAME)

    logger.info("route sanity checks")
    routes = run_route_checks(build.graph, scan.drivable_ways)
    (processed_dir / ROUTES_FILENAME).write_text(
        json.dumps(routes.geojson, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    return GraphSection(
        generated_at_utc=datetime.now(UTC).isoformat(timespec="seconds"),
        inputs_sha256=inputs_sha256,
        welds_applied=prepared.weld_report.welded,
        build=build.report,
        connectivity=connectivity,
        street_comparison=comparison.report,
        route_checks=routes.checks,
    )
