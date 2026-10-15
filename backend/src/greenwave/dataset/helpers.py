"""Helpers of the dataset loader: file reading, parsing, hashing and the consistency checks."""

import json
import math
from pathlib import Path

import networkx as nx
import polars as pl
import shapely.errors
from pydantic import BaseModel, ValidationError

from greenwave.dataset.constants import (
    CHAIN,
    COMMAND,
    EXAMPLES_IN_MESSAGE,
    NEIGHBOURS_COMMAND,
    PRODUCED_BY,
    REQUIRED_COLUMNS,
    STEP_INTERSECTIONS,
)
from greenwave.dataset.errors import (
    ArtifactHashMismatchError,
    CountMismatchError,
    MalformedArtifactError,
    ManifestMismatchError,
    MissingArtifactError,
    ReferentialIntegrityError,
)
from greenwave.dataset.models import (
    IntersectionIdRecord,
    IntersectionsSection,
    LoadedCounts,
    NeighboursSection,
)
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
from greenwave.etl.neighbours import approach_edges
from greenwave.etl.neighbours_pipeline import NEIGHBOURS_FILENAME


def require_files(processed_dir: Path, manifest_path: Path) -> None:
    for filename, step in PRODUCED_BY.items():
        if not (processed_dir / filename).is_file():
            raise MissingArtifactError(
                f"{processed_dir / filename} is missing; build it with "
                f"`{COMMAND.format(step=step)}` (run from backend/)"
            )
    if not manifest_path.is_file():
        raise MissingArtifactError(
            f"{manifest_path} is missing; it is committed to git, so restore it from the "
            "repository (the processed data is only valid for the committed version)"
        )


def read_json(path: Path) -> dict[str, object]:
    step = PRODUCED_BY[path.name]
    try:
        loaded: object = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise MalformedArtifactError(
            f"{path} cannot be read as JSON ({error}); rebuild it with "
            f"`{COMMAND.format(step=step)}`"
        ) from error
    if not isinstance(loaded, dict):
        raise MalformedArtifactError(
            f"{path} does not contain a JSON object; rebuild it with `{COMMAND.format(step=step)}`"
        )
    return loaded


def parse[Model: BaseModel](content: object, model: type[Model], label: str) -> Model:
    try:
        return model.model_validate(content)
    except ValidationError as error:
        raise MalformedArtifactError(
            f"{label} is missing a required key or has a wrong type ({error}); re-run {CHAIN}"
        ) from error


def report_section[Model: BaseModel](
    report: dict[str, object], section: str, model: type[Model]
) -> Model:
    if section not in report:
        raise MalformedArtifactError(
            f"{REPORT_FILENAME} has no section '{section}'; re-run {CHAIN}"
        )
    return parse(report[section], model, f"{REPORT_FILENAME} section '{section}'")


def check_manifest_hashes(
    manifest_path: Path, manifest_sha256: str, recorded: dict[str, str]
) -> None:
    stale = [where for where, recorded_hash in recorded.items() if recorded_hash != manifest_sha256]
    if stale:
        raise ManifestMismatchError(
            f"{manifest_path} has sha256 {manifest_sha256[:12]}..., but these were built from a "
            f"different manifest: {', '.join(stale)}; re-run {CHAIN}"
        )


def check_artifact_hashes(
    processed_dir: Path,
    intersections_section: IntersectionsSection,
    neighbours_section: NeighboursSection,
) -> None:
    recorded_t4 = intersections_section.artifact_sha256
    recorded_t5 = neighbours_section.artifact_sha256
    consumed = neighbours_section.consumed_sha256
    absent = [
        f"{REPORT_FILENAME} section '{section}' ({field})"
        for section, field, value in (
            ("intersections", "artifact_sha256", recorded_t4),
            ("neighbours", "artifact_sha256", recorded_t5),
            ("neighbours", "consumed_sha256", consumed),
        )
        if value is None
    ]
    if recorded_t4 is None or recorded_t5 is None or consumed is None:
        raise MalformedArtifactError(
            f"{', '.join(absent)} missing: the processed data was written by an older ETL "
            f"version; re-run {CHAIN}"
        )

    expected = {name: recorded_t4.get(name) for name in T4_ARTIFACT_FILENAMES} | {
        NEIGHBOURS_FILENAME: recorded_t5.get(NEIGHBOURS_FILENAME)
    }
    unrecorded = [name for name, value in expected.items() if value is None]
    if unrecorded:
        raise MalformedArtifactError(
            f"{REPORT_FILENAME} records no hash for {', '.join(unrecorded)}; re-run {CHAIN}"
        )

    actual = artifact_hashes(processed_dir, (*T4_ARTIFACT_FILENAMES, NEIGHBOURS_FILENAME))
    for name, on_disk in actual.items():
        if on_disk != expected[name]:
            rerun = NEIGHBOURS_COMMAND if name == NEIGHBOURS_FILENAME else CHAIN
            raise ArtifactHashMismatchError(
                f"{processed_dir / name} has sha256 {on_disk[:12]}..., but {REPORT_FILENAME} "
                f"recorded {str(expected[name])[:12]}... when the step wrote it; the artifacts "
                f"come from different runs or the file was changed, re-run {rerun}"
            )
    different = [name for name in T4_ARTIFACT_FILENAMES if consumed.get(name) != expected[name]]
    if different:
        raise ArtifactHashMismatchError(
            f"{NEIGHBOURS_FILENAME} was built from other versions of {', '.join(different)} than "
            f"the ones on disk now (hashes recorded by the neighbours step differ from section "
            f"'intersections' of {REPORT_FILENAME}); re-run {NEIGHBOURS_COMMAND}"
        )


def check_delays(processed_dir: Path, intersections: pl.DataFrame) -> None:
    bad = sum(
        value is None or not math.isfinite(value) or value < 0
        for value in intersections["delay_seconds"].to_list()
    )
    if bad:
        raise MalformedArtifactError(
            f"{processed_dir / INTERSECTIONS_FILENAME} column 'delay_seconds' has {bad} null, "
            f"negative or non-finite values; rebuild it with "
            f"`{COMMAND.format(step=STEP_INTERSECTIONS)}`"
        )


def read_parquet(processed_dir: Path, filename: str) -> pl.DataFrame:
    path = processed_dir / filename
    step = PRODUCED_BY[filename]
    try:
        schema = pl.read_parquet_schema(path)
    except (OSError, pl.exceptions.PolarsError) as error:
        raise MalformedArtifactError(
            f"{path} is not a readable parquet file ({error}); rebuild it with "
            f"`{COMMAND.format(step=step)}`"
        ) from error
    for column, dtype in REQUIRED_COLUMNS[filename].items():
        if column not in schema:
            raise MalformedArtifactError(
                f"{path} has no column '{column}'; rebuild it with `{COMMAND.format(step=step)}`"
            )
        if dtype is not None and schema[column] != dtype:
            raise MalformedArtifactError(
                f"{path} column '{column}' has type {schema[column]}, expected {dtype}; "
                f"rebuild it with `{COMMAND.format(step=step)}`"
            )
    try:
        return pl.read_parquet(path)
    except (OSError, pl.exceptions.PolarsError) as error:
        raise MalformedArtifactError(
            f"{path} cannot be read ({error}); rebuild it with `{COMMAND.format(step=step)}`"
        ) from error


def read_network(processed_dir: Path) -> nx.MultiDiGraph:
    for filename in (NETWORK_NODES_FILENAME, NETWORK_EDGES_FILENAME):
        read_parquet(processed_dir, filename)  # column and readability checks
    try:
        return read_graph(processed_dir, NETWORK_NODES_FILENAME, NETWORK_EDGES_FILENAME)
    except (
        OSError,
        KeyError,
        ValueError,
        pl.exceptions.PolarsError,
        shapely.errors.ShapelyError,
    ) as error:
        raise MalformedArtifactError(
            f"{processed_dir / NETWORK_NODES_FILENAME} / {NETWORK_EDGES_FILENAME} cannot be "
            f"turned into a graph ({type(error).__name__}: {error}); rebuild with "
            f"`{COMMAND.format(step=STEP_INTERSECTIONS)}`"
        ) from error


def _unknown(values: pl.Series, known: set[str]) -> list[str]:
    return sorted(v for v in values.drop_nulls().unique().to_list() if v not in known)


def _require_known(what: str, location: str, values: pl.Series, known: set[str]) -> None:
    missing = _unknown(values, known)
    if missing:
        shown = ", ".join(missing[:EXAMPLES_IN_MESSAGE])
        more = (
            f" (and {len(missing) - EXAMPLES_IN_MESSAGE} more)"
            if len(missing) > EXAMPLES_IN_MESSAGE
            else ""
        )
        raise ReferentialIntegrityError(
            f"{location} references {len(missing)} {what} that do not exist: {shown}{more}; "
            f"the artifacts come from different runs, re-run {CHAIN}"
        )


def check_references(
    graph: nx.MultiDiGraph,
    intersections: pl.DataFrame,
    approaches: pl.DataFrame,
    neighbours: pl.DataFrame,
) -> None:
    ids = intersections["intersection_id"]
    if ids.null_count() or ids.n_unique() != len(ids):
        raise ReferentialIntegrityError(
            f"{INTERSECTIONS_FILENAME} has null or duplicate intersection_id values; re-run {CHAIN}"
        )
    known_intersections = set(ids.to_list())
    known_edges = {data["edge_id"] for *_, data in graph.edges(data=True)}
    known_nodes = set(graph.nodes)

    for location, column in (
        (APPROACHES_FILENAME, approaches["intersection_id"]),
        (f"{NEIGHBOURS_FILENAME} (from_intersection_id)", neighbours["from_intersection_id"]),
        (f"{NEIGHBOURS_FILENAME} (to_intersection_id)", neighbours["to_intersection_id"]),
    ):
        _require_known(
            f"intersection ids of {INTERSECTIONS_FILENAME}",
            location,
            column,
            known_intersections,
        )
    for location, column in (
        (
            f"{APPROACHES_FILENAME} (controlled_edge_ids)",
            approaches["controlled_edge_ids"].explode(),
        ),
        (f"{NEIGHBOURS_FILENAME} (from_approach_edge_id)", neighbours["from_approach_edge_id"]),
        (f"{NEIGHBOURS_FILENAME} (to_approach_edge_id)", neighbours["to_approach_edge_id"]),
        (f"{NEIGHBOURS_FILENAME} (path_edge_ids)", neighbours["path_edge_ids"].explode()),
    ):
        _require_known(f"edge ids of {NETWORK_EDGES_FILENAME}", location, column, known_edges)
    _require_known(
        f"nodes of {NETWORK_NODES_FILENAME}",
        f"{INTERSECTIONS_FILENAME} (node_key)",
        intersections["node_key"],
        known_nodes,
    )


def check_ids_file(records: list[IntersectionIdRecord], intersections: pl.DataFrame) -> None:
    from_file = {r.id: (r.kind, r.node_key) for r in records}
    from_parquet = {
        row["intersection_id"]: (row["kind"], row["node_key"])
        for row in intersections.select("intersection_id", "kind", "node_key").iter_rows(named=True)
    }
    if len(from_file) != len(records) or from_file != from_parquet:
        differing = sorted(
            i
            for i in from_file.keys() | from_parquet.keys()
            if from_file.get(i) != from_parquet.get(i)
        )
        raise ReferentialIntegrityError(
            f"{IDS_FILENAME} and {INTERSECTIONS_FILENAME} disagree on id -> (kind, node_key) "
            f"for {len(differing)} ids, e.g. {', '.join(differing[:EXAMPLES_IN_MESSAGE])}; "
            f"re-run {CHAIN}"
        )


def check_counts(
    graph: nx.MultiDiGraph,
    intersections: pl.DataFrame,
    approaches: pl.DataFrame,
    neighbours: pl.DataFrame,
    intersections_section: IntersectionsSection,
    neighbours_section: NeighboursSection,
) -> LoadedCounts:
    snapping = intersections_section.snapping
    neighbour_report = neighbours_section.report
    approach_edge_count = len(approach_edges(approaches))
    expected = (
        (
            INTERSECTIONS_FILENAME,
            intersections.height,
            intersections_section.grouping.intersections_total,
        ),
        (
            APPROACHES_FILENAME,
            approaches.height,
            snapping.attached_signals + len(snapping.unsnapped),
        ),
        (NEIGHBOURS_FILENAME, neighbours.height, neighbour_report.pairs),
        (
            f"{APPROACHES_FILENAME} (approach edges)",
            approach_edge_count,
            neighbour_report.approach_edges,
        ),
    )
    for artifact, actual, recorded in expected:
        if actual != recorded:
            raise CountMismatchError(
                f"{artifact} has {actual} rows, but {REPORT_FILENAME} records {recorded}; "
                f"re-run {CHAIN}"
            )
    return LoadedCounts(
        intersections=intersections.height,
        signal_approaches=approaches.height,
        approach_neighbours=neighbours.height,
        approach_edges=approach_edge_count,
        graph_nodes=graph.number_of_nodes(),
        graph_edges=graph.number_of_edges(),
    )
