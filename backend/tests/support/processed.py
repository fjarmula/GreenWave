"""A real processed directory built from the tiny synthetic raw fixture (shared test support)."""

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import polars as pl

from greenwave.etl.geo import project_points
from greenwave.etl.graph_pipeline import ROUTES_FILENAME, STREET_TABLE_FILENAME
from greenwave.etl.intersections_pipeline import run_intersections_with_road_attributes
from greenwave.etl.io import REPORT_FILENAME, update_report_section
from greenwave.etl.manifest import MANIFEST_FILENAME
from greenwave.etl.neighbours_pipeline import run_neighbours
from greenwave.etl.places_pipeline import run_places
from greenwave.etl.quality import run_quality
from tests.support.osm_fixtures import point
from tests.support.pipeline_fixtures import at, emuia_feature, make_raw


@dataclass(frozen=True)
class Layout:
    processed: Path
    manifest: Path


def write_street_table(processed: Path, rows: list[dict[str, object]]) -> None:
    """``street_length_comparison.csv`` as the graph step writes it."""
    pl.DataFrame(
        rows,
        schema={
            "normalised_name": pl.String,
            "graph_name": pl.String,
            "ulice_name": pl.String,
            "graph_km": pl.Float64,
            "ulice_km": pl.Float64,
            "ratio": pl.Float64,
            "status": pl.String,
        },
    ).write_csv(processed / STREET_TABLE_FILENAME)


def write_route_checks(processed: Path, routes: list[tuple[str, str, float | None]]) -> None:
    """``route_sanity_checks.geojson`` with one route (plus start/end points) per tuple."""
    features: list[dict[str, object]] = []
    for origin, destination, ratio in routes:
        features.append(
            {
                "type": "Feature",
                "geometry": None,
                "properties": {
                    "kind": "route",
                    "from": origin,
                    "to": destination,
                    "route_found": ratio is not None,
                    "detour_ratio": ratio,
                },
            }
        )
        for kind, place in (("start", origin), ("end", destination)):
            features.append(
                {
                    "type": "Feature",
                    "geometry": None,
                    "properties": {"kind": kind, "place": place},
                }
            )
    (processed / ROUTES_FILENAME).write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False),
        encoding="utf-8",
    )


def write_graph_check_stubs(processed: Path) -> None:
    """The graph step's street and route checks (the tiny fixture does not run that step)."""
    write_street_table(
        processed,
        [
            {
                "normalised_name": "aleja testowa",
                "graph_name": "Aleja Testowa",
                "ulice_name": "Aleja Testowa",
                "graph_km": 0.3,
                "ulice_km": 0.1,
                "ratio": 3.0,
                "status": "graph_longer",
            }
        ],
    )
    write_route_checks(processed, [("Rondo A", "Rondo B", 1.2)])


def _metric(x: float, y: float) -> tuple[float, float]:
    lon, lat = at(x, y)
    mx, my = project_points(np.array([lon]), np.array([lat]))[0]
    return float(mx), float(my)


# One address of each provenance: "Poprzeczna 7" in both sources (matched), "Poprzeczna 5" only
# in EMUiA (municipal), "Poprzeczna 3" only in OSM (osm).
LAYOUT_OSM_ONLY_ADDRESS = point(
    *at(2, -0.4), **{"addr:street": "Poprzeczna", "addr:housenumber": "3"}
)
LAYOUT_EMUIA = (
    emuia_feature(1, "Poprzeczna", "7", *_metric(2, 0.41)),
    emuia_feature(2, "Poprzeczna", "5", *_metric(2, 0.8)),
)


def build_layout(root: Path) -> Layout:
    """Run intersections, neighbours, places and quality on the tiny raw fixture in ``root``."""
    raw = make_raw(root, (LAYOUT_OSM_ONLY_ADDRESS,), LAYOUT_EMUIA)
    processed = root / "processed"
    report = processed / REPORT_FILENAME
    section, road_attributes = run_intersections_with_road_attributes(
        raw, processed, root / "overrides"
    )
    update_report_section(report, "intersections", section)
    update_report_section(report, "road_attributes", road_attributes)
    update_report_section(report, "neighbours", run_neighbours(raw, processed))
    update_report_section(report, "places", run_places(raw, processed))
    write_graph_check_stubs(processed)
    update_report_section(report, "quality", run_quality(raw, processed))
    return Layout(processed, raw / MANIFEST_FILENAME)
