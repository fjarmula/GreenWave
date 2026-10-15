"""A real processed directory built from the tiny synthetic raw fixture (shared test support)."""

from dataclasses import dataclass
from pathlib import Path

from greenwave.etl.intersections_pipeline import run_intersections
from greenwave.etl.io import REPORT_FILENAME, update_report_section
from greenwave.etl.manifest import MANIFEST_FILENAME
from greenwave.etl.neighbours_pipeline import run_neighbours
from tests.support.pipeline_fixtures import make_raw


@dataclass(frozen=True)
class Layout:
    processed: Path
    manifest: Path


def build_layout(root: Path) -> Layout:
    """Run the intersections and neighbours steps on the tiny raw fixture under ``root``."""
    raw = make_raw(root)
    processed = root / "processed"
    report = processed / REPORT_FILENAME
    update_report_section(
        report, "intersections", run_intersections(raw, processed, root / "overrides")
    )
    update_report_section(report, "neighbours", run_neighbours(raw, processed))
    return Layout(processed, raw / MANIFEST_FILENAME)
