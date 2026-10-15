import numpy as np
import pytest

from greenwave.etl.clustering import single_linkage_labels


def _xy(*xs: float) -> np.ndarray:
    return np.array([[x, 0.0] for x in xs])


@pytest.mark.parametrize(
    ("second_point_m", "clusters"),
    [(29.999, 1), (30.0, 1), (30.001, 2)],  # the radius is inclusive
)
def test_clustering_boundary_below_at_above_radius(second_point_m: float, clusters: int) -> None:
    assert len(set(single_linkage_labels(_xy(0, second_point_m), 30.0))) == clusters


def test_clustering_singleton_and_empty() -> None:
    assert single_linkage_labels(_xy(5), 30.0).tolist() == [0]
    assert single_linkage_labels(np.empty((0, 2)), 30.0).tolist() == []


def test_clustering_chain_is_one_cluster_even_when_ends_exceed_radius() -> None:
    # A-B and B-C are 20 m apart, A-C is 40 m: single linkage joins all three at radius 30 m.
    assert len(set(single_linkage_labels(_xy(0, 20, 40), 30.0))) == 1
