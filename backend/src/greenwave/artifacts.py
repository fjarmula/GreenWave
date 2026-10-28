"""Names of the processed artifacts the ETL writes and the server loads, and their hashing.

Neutral module: the ETL writers and the dataset loader both import from here, so loading the
dataset does not import the ETL pipelines. The ETL modules re-export these names.
"""

from collections.abc import Iterable, Mapping
from pathlib import Path

from greenwave.etl.manifest import sha256_of_file

# Curated inputs (PRM base coordinates, roundabout overrides) are keyed relative to this.
BACKEND_ROOT = Path(__file__).resolve().parents[2]

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
# The PRM ambulance teams in scope, one row per team, each at a `prm_base` station.
RESOURCES_FILENAME = "resources.parquet"
PLACES_ARTIFACT_FILENAMES = (STATIONS_FILENAME, ADDRESSES_FILENAME, RESOURCES_FILENAME)
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


class StaleArtifactError(RuntimeError):
    """The processed artifacts come from different raw inputs or from different runs."""


def input_key(path: Path) -> str:
    """``path`` relative to ``backend/`` when it is inside it, else absolute (test fixtures)."""
    resolved = path.resolve()
    try:
        return resolved.relative_to(BACKEND_ROOT).as_posix()
    except ValueError:
        return str(resolved)


def input_hashes(paths: Iterable[Path]) -> dict[str, str]:
    """sha256 of each curated input file that exists, keyed by :func:`input_key`."""
    return {input_key(path): sha256_of_file(path) for path in paths if path.is_file()}


def verify_input_hashes(recorded: Mapping[str, str], rerun: str) -> None:
    """Raise ``StaleArtifactError`` when a recorded curated input changed or vanished since its
    step ran; ``rerun`` names the command that rebuilds from it."""
    for key, sha in recorded.items():
        path = BACKEND_ROOT / key  # an absolute key stays absolute
        if not path.is_file() or sha256_of_file(path) != sha:
            raise StaleArtifactError(
                f"{key} changed since the processed data was built from it; re-run {rerun}"
            )
