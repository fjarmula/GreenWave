"""Step T5 orchestration: neighbour pairs from the processed network and signal approaches."""

import hashlib
import json
import logging
from datetime import UTC, datetime
from pathlib import Path

import polars as pl
from pydantic import BaseModel

from greenwave import artifacts
from greenwave.etl.config import CASCADE_ALLOW_U_TURNS, CASCADE_THRESHOLD_METERS
from greenwave.etl.graph_io import read_graph
from greenwave.etl.intersections_pipeline import (
    APPROACHES_FILENAME,
    IDS_FILENAME,
    INTERSECTIONS_FILENAME,
    NETWORK_EDGES_FILENAME,
    NETWORK_NODES_FILENAME,
    T4_ARTIFACT_FILENAMES,
    artifact_hashes,
)
from greenwave.etl.io import REPORT_FILENAME
from greenwave.etl.manifest import MANIFEST_FILENAME
from greenwave.etl.neighbours import (
    NeighboursReport,
    approach_edges,
    find_neighbours,
    neighbour_frame,
    neighbours_report,
)

logger = logging.getLogger(__name__)

# Moved to greenwave.artifacts (shared with the dataset loader); still importable from here.
NEIGHBOURS_FILENAME = artifacts.NEIGHBOURS_FILENAME
StaleArtifactError = artifacts.StaleArtifactError


class NeighboursSection(BaseModel):
    """``artifact_sha256`` is this step's output; ``consumed_sha256`` the T4 files it read.

    Both are integrity checks against mixed runs (not security, not a reproducible-build claim).
    """

    generated_at_utc: str
    manifest_sha256: str
    artifact_sha256: dict[str, str]
    consumed_sha256: dict[str, str]
    report: NeighboursReport


def _recorded_t4_hashes(report_path: Path) -> dict[str, str]:
    """The hashes the intersections step recorded for its own artifacts."""
    rerun = "re-run the intersections step"
    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
        recorded = report["intersections"]["artifact_sha256"]
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise StaleArtifactError(
            f"{report_path} has no artifact_sha256 in its section 'intersections' ({error!r}); "
            f"{rerun}"
        ) from error
    if not isinstance(recorded, dict):
        raise StaleArtifactError(
            f"{report_path} section 'intersections' has a malformed artifact_sha256; {rerun}"
        )
    missing = [name for name in T4_ARTIFACT_FILENAMES if name not in recorded]
    if missing:
        raise StaleArtifactError(
            f"{report_path} section 'intersections' records no hash for {', '.join(missing)}; "
            f"{rerun}"
        )
    return {name: str(recorded[name]) for name in T4_ARTIFACT_FILENAMES}


def run_neighbours(
    raw_dir: Path,
    processed_dir: Path,
    threshold_meters: float = CASCADE_THRESHOLD_METERS,
    allow_u_turns: bool = CASCADE_ALLOW_U_TURNS,
) -> NeighboursSection:
    manifest_sha256 = hashlib.sha256((raw_dir / MANIFEST_FILENAME).read_bytes()).hexdigest()
    ids = json.loads((processed_dir / IDS_FILENAME).read_text(encoding="utf-8"))
    built_from = ids.get("valid_for", {}).get("manifest_sha256")
    if built_from != manifest_sha256:
        raise StaleArtifactError(
            f"processed intersections were built from manifest {(built_from or 'none')[:12]}..., "
            f"but the current manifest is {manifest_sha256[:12]}...; re-run the intersections step"
        )

    recorded = _recorded_t4_hashes(processed_dir / REPORT_FILENAME)
    consumed = artifact_hashes(processed_dir, T4_ARTIFACT_FILENAMES)  # hashed just before reading
    changed = [name for name in T4_ARTIFACT_FILENAMES if consumed[name] != recorded[name]]
    if changed:
        raise StaleArtifactError(
            f"{', '.join(changed)} differ from the hashes the intersections step recorded in "
            f"{REPORT_FILENAME}; the artifacts come from different runs, re-run the "
            "intersections step"
        )

    graph = read_graph(processed_dir, NETWORK_NODES_FILENAME, NETWORK_EDGES_FILENAME)
    approaches = approach_edges(pl.read_parquet(processed_dir / APPROACHES_FILENAME))
    kinds = dict(
        pl.read_parquet(processed_dir / INTERSECTIONS_FILENAME)
        .select("intersection_id", "kind")
        .iter_rows()
    )

    logger.info("searching neighbours for %d approach edges", len(approaches))
    search = find_neighbours(graph, approaches, threshold_meters, allow_u_turns)
    other = find_neighbours(graph, approaches, threshold_meters, not allow_u_turns)
    neighbour_frame(search.pairs).write_parquet(processed_dir / NEIGHBOURS_FILENAME)
    return NeighboursSection(
        generated_at_utc=datetime.now(UTC).isoformat(timespec="seconds"),
        manifest_sha256=manifest_sha256,
        artifact_sha256=artifact_hashes(processed_dir, (NEIGHBOURS_FILENAME,)),
        consumed_sha256=consumed,
        report=neighbours_report(
            search, approaches, kinds, threshold_meters, allow_u_turns, len(other.pairs)
        ),
    )
