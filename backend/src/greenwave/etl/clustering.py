"""Distance clustering of points in the metric CRS."""

import numpy as np
import shapely
from numpy.typing import NDArray


def single_linkage_labels(xy: NDArray[np.float64], radius_meters: float) -> NDArray[np.int64]:
    """Connected components of the "within radius_meters (inclusive)" graph.

    Single linkage means chains (A-B and B-C within the radius, A-C not) end up in one cluster.
    """
    count = len(xy)
    parent = list(range(count))

    def find(item: int) -> int:
        while parent[item] != item:
            parent[item] = parent[parent[item]]
            item = parent[item]
        return item

    if count:
        points = shapely.points(xy)
        pairs = shapely.STRtree(points).query(points, predicate="dwithin", distance=radius_meters)
        for left, right in zip(pairs[0].tolist(), pairs[1].tolist(), strict=True):
            root_left, root_right = find(left), find(right)
            if root_left != root_right:
                parent[max(root_left, root_right)] = min(root_left, root_right)
    roots = np.array([find(item) for item in range(count)], dtype=np.int64)
    _, labels = np.unique(roots, return_inverse=True)
    return np.asarray(labels, dtype=np.int64)
