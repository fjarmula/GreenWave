"""A real processed directory built once per session from the tiny synthetic raw fixture."""

import shutil
from dataclasses import dataclass
from pathlib import Path

import pytest
from pipeline_fixtures import make_raw

from greenwave.etl.intersections_pipeline import run_intersections
from greenwave.etl.io import update_report_section
from greenwave.etl.manifest import MANIFEST_FILENAME
from greenwave.etl.neighbours_pipeline import run_neighbours

REPORT_FILENAME = "etl_report.json"


@dataclass(frozen=True)
class Layout:
    processed: Path
    manifest: Path


@pytest.fixture(scope="session")
def built_layout(tmp_path_factory: pytest.TempPathFactory) -> Layout:
    root = tmp_path_factory.mktemp("dataset_template")
    raw = make_raw(root)
    processed = root / "processed"
    report = processed / REPORT_FILENAME
    update_report_section(
        report, "intersections", run_intersections(raw, processed, root / "overrides")
    )
    update_report_section(report, "neighbours", run_neighbours(raw, processed))
    return Layout(processed, raw / MANIFEST_FILENAME)


@pytest.fixture
def layout(built_layout: Layout, tmp_path: Path) -> Layout:
    """A private copy that a test may corrupt."""
    processed = tmp_path / "processed"
    shutil.copytree(built_layout.processed, processed)
    manifest = tmp_path / MANIFEST_FILENAME
    shutil.copy(built_layout.manifest, manifest)
    return Layout(processed, manifest)
