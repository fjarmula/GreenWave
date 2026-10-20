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
# Analysis only (not loaded by the server): Kraków bus-lane register matched against OSM.
BUS_LANE_CROSSCHECK_FILENAME = "bus_lane_crosscheck.csv"
# Step `places`: rescue stations and address points, both snapped to the network.
STATIONS_FILENAME = "stations.parquet"
ADDRESSES_FILENAME = "addresses.parquet"
PLACES_ARTIFACT_FILENAMES = (STATIONS_FILENAME, ADDRESSES_FILENAME)
# Step `quality`: a summary of the ETL diagnostics, served at /api/v1/dataset/quality.
QUALITY_FILENAME = "data_quality.json"

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
