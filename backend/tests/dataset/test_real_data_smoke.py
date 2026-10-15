import pytest

from greenwave.dataset import DatasetSettings, load_dataset


def test_real_processed_data_loads() -> None:
    """Skipped where data/processed is absent (CI, demo machines without a build)."""
    settings = DatasetSettings()
    if not (settings.processed_dir / "intersection_ids.json").is_file():
        pytest.skip("processed data not present on this machine")

    dataset = load_dataset(settings.processed_dir, settings.raw_manifest_path)

    assert dataset.counts.intersections == dataset.intersections.height > 0
    assert dataset.provenance.sources
