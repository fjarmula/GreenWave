"""Step T5 orchestration: neighbour pairs from the processed network and signal approaches."""

import hashlib
import json
import logging
from datetime import UTC, datetime
from pathlib import Path

import polars as pl
from pydantic import BaseModel

from greenwave.etl.config import CASCADE_ALLOW_U_TURNS, CASCADE_THRESHOLD_METERS
from greenwave.etl.graph_io import read_graph
from greenwave.etl.intersections_pipeline import (
    APPROACHES_FILENAME,
    IDS_FILENAME,
    INTERSECTIONS_FILENAME,
    NETWORK_EDGES_FILENAME,
    NETWORK_NODES_FILENAME,
)
from greenwave.etl.manifest import MANIFEST_FILENAME
from greenwave.etl.neighbours import (
    NeighboursReport,
    approach_edges,
    find_neighbours,
    neighbour_frame,
    neighbours_report,
)

logger = logging.getLogger(__name__)

NEIGHBOURS_FILENAME = "approach_neighbours.parquet"


class StaleArtifactError(RuntimeError):
    """The processed artifacts were built from different raw inputs than the manifest says."""


class NeighboursSection(BaseModel):
    generated_at_utc: str
    manifest_sha256: str
    report: NeighboursReport


def run_neighbours(
    raw_dir: Path,
    processed_dir: Path,
    threshold_meters: float = CASCADE_THRESHOLD_METERS,
    allow_u_turns: bool = CASCADE_ALLOW_U_TURNS,
) -> NeighboursSection:
    manifest_sha256 = hashlib.sha256((raw_dir / MANIFEST_FILENAME).read_bytes()).hexdigest()
    ids = json.loads((processed_dir / IDS_FILENAME).read_text(encoding="utf-8"))
    built_from = ids["valid_for"]["manifest_sha256"]
    if built_from != manifest_sha256:
        raise StaleArtifactError(
            f"processed intersections were built from manifest {built_from[:12]}..., but the "
            f"current manifest is {manifest_sha256[:12]}...; re-run the intersections step"
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
        report=neighbours_report(
            search, approaches, kinds, threshold_meters, allow_u_turns, len(other.pairs)
        ),
    )
