"""Load ``data/processed/`` once at startup, validate it and expose it as one read-only object.

No fallback and no partial load: any missing, stale or inconsistent artifact raises a
``DatasetError`` that names the file and the ETL command to re-run. Nothing here runs ETL code.

Mixed runs: every artifact is tied to the committed MANIFEST.json and to each other, and each ETL
step records the sha256 of the files it wrote in ``etl_report.json`` (the neighbours step also
records the hashes of the files it read). The loader re-hashes the six files and compares them with
those records. This is an integrity check against artifacts from different runs (for example the
same manifest, a changed ETL config and a partial re-run), not a security measure: the records are
in ``etl_report.json``, which is itself not hashed, and nothing here claims reproducible builds.
"""

import hashlib
import logging
import time
from pathlib import Path

import networkx as nx

from greenwave.artifacts import (
    APPROACHES_FILENAME,
    IDS_FILENAME,
    INTERSECTIONS_FILENAME,
    NEIGHBOURS_FILENAME,
    REPORT_FILENAME,
)
from greenwave.dataset.artifact_io import (
    parse,
    read_json,
    read_network,
    read_parquet,
    report_section,
    require_files,
)
from greenwave.dataset.integrity import (
    check_artifact_hashes,
    check_counts,
    check_delays,
    check_ids_file,
    check_manifest_hashes,
    check_references,
)
from greenwave.dataset.models import (
    IdsDocument,
    IntersectionsSection,
    NeighboursSection,
    ProcessedDataset,
    Provenance,
)
from greenwave.etl.manifest import load_manifest

logger = logging.getLogger(__name__)


def load_dataset(processed_dir: Path, manifest_path: Path) -> ProcessedDataset:
    """Read, validate and return the processed data, or raise a ``DatasetError``."""
    started = time.perf_counter()

    require_files(processed_dir, manifest_path)  # check 1
    manifest_sha256 = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    ids = parse(read_json(processed_dir / IDS_FILENAME), IdsDocument, IDS_FILENAME)
    report = read_json(processed_dir / REPORT_FILENAME)
    intersections_section = report_section(report, "intersections", IntersectionsSection)
    neighbours_section = report_section(report, "neighbours", NeighboursSection)
    check_manifest_hashes(  # check 2
        manifest_path,
        manifest_sha256,
        {
            f"{IDS_FILENAME} (valid_for)": ids.valid_for.manifest_sha256,
            f"{REPORT_FILENAME} section 'intersections'": intersections_section.manifest_sha256,
            f"{REPORT_FILENAME} section 'neighbours'": neighbours_section.manifest_sha256,
        },
    )

    check_artifact_hashes(processed_dir, intersections_section, neighbours_section)  # check 2b

    graph = read_network(processed_dir)
    intersections = read_parquet(processed_dir, INTERSECTIONS_FILENAME)
    check_delays(processed_dir, intersections)
    approaches = read_parquet(processed_dir, APPROACHES_FILENAME)
    neighbours = read_parquet(processed_dir, NEIGHBOURS_FILENAME)

    check_references(graph, intersections, approaches, neighbours)  # check 3
    check_ids_file(ids.intersections, intersections)
    counts = check_counts(
        graph, intersections, approaches, neighbours, intersections_section, neighbours_section
    )

    manifest = load_manifest(manifest_path)
    dataset = ProcessedDataset(
        graph=nx.freeze(graph),
        intersections=intersections,
        signal_approaches=approaches,
        approach_neighbours=neighbours,
        intersection_ids=tuple(ids.intersections),
        cascade_threshold_m=neighbours_section.report.threshold_m,
        allow_u_turns=neighbours_section.report.allow_u_turns,
        counts=counts,
        provenance=Provenance(manifest_sha256=manifest_sha256, sources=tuple(manifest.entries)),
    )
    logger.info(
        "loaded processed data from %s in %.2f s: %d intersections, %d signal approaches, "
        "%d approach neighbours, graph with %d nodes and %d edges (manifest %s...)",
        processed_dir,
        time.perf_counter() - started,
        counts.intersections,
        counts.signal_approaches,
        counts.approach_neighbours,
        counts.graph_nodes,
        counts.graph_edges,
        manifest_sha256[:12],
    )
    return dataset
