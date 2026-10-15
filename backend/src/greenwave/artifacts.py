"""Names of the processed artifacts the ETL writes and the server loads, and their hashing.

Neutral module: the ETL writers and the dataset loader both import from here, so loading the
dataset does not import the ETL pipelines. The ETL modules re-export these names.
"""

from pathlib import Path

from greenwave.etl.manifest import sha256_of_file

NETWORK_NODES_FILENAME = "network_nodes.parquet"
NETWORK_EDGES_FILENAME = "network_edges.parquet"
INTERSECTIONS_FILENAME = "intersections.parquet"
APPROACHES_FILENAME = "signal_approaches.parquet"
IDS_FILENAME = "intersection_ids.json"
NEIGHBOURS_FILENAME = "approach_neighbours.parquet"
REPORT_FILENAME = "etl_report.json"

# The artifacts the server loads from this step. Their hashes are recorded in the report section
# `intersections` (an integrity check against mixed runs, not a security measure).
T4_ARTIFACT_FILENAMES = (
    NETWORK_NODES_FILENAME,
    NETWORK_EDGES_FILENAME,
    INTERSECTIONS_FILENAME,
    APPROACHES_FILENAME,
    IDS_FILENAME,
)


def artifact_hashes(processed_dir: Path, filenames: tuple[str, ...]) -> dict[str, str]:
    """sha256 of each file as it is on disk now."""
    return {name: sha256_of_file(processed_dir / name) for name in filenames}
