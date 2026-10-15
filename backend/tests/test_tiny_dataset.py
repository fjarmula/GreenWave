from greenwave.dataset import ProcessedDataset


def test_tiny_dataset_fixture_loads(tiny_dataset: ProcessedDataset) -> None:
    assert tiny_dataset.counts.intersections == tiny_dataset.intersections.height == 2
