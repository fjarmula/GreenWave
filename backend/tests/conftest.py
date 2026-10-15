"""Shared fixtures. Session fixtures are built lazily, only when a test asks for them (no autouse).

``built_layout``: a real processed directory built once per session from the tiny synthetic raw
fixture. ``layout``: a private copy a test may corrupt. ``tiny_dataset``: that directory loaded
as a ``ProcessedDataset``, for tests of any area that need a loaded dataset.
"""

import shutil
from pathlib import Path

import pytest

from greenwave.dataset import ProcessedDataset, load_dataset
from greenwave.etl.manifest import MANIFEST_FILENAME
from tests.support.processed import Layout, build_layout


@pytest.fixture(scope="session")
def built_layout(tmp_path_factory: pytest.TempPathFactory) -> Layout:
    return build_layout(tmp_path_factory.mktemp("dataset_template"))


@pytest.fixture
def layout(built_layout: Layout, tmp_path: Path) -> Layout:
    """A private copy that a test may corrupt."""
    processed = tmp_path / "processed"
    shutil.copytree(built_layout.processed, processed)
    manifest = tmp_path / MANIFEST_FILENAME
    shutil.copy(built_layout.manifest, manifest)
    return Layout(processed, manifest)


@pytest.fixture(scope="session")
def tiny_dataset(built_layout: Layout) -> ProcessedDataset:
    """The tiny processed directory loaded once per session (read-only by convention)."""
    return load_dataset(built_layout.processed, built_layout.manifest)
