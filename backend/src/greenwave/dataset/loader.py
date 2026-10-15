"""Load ``data/processed/`` once at startup, validate it and expose it as one read-only object.

No fallback and no partial load: any missing, stale or inconsistent artifact raises a
``DatasetError`` that names the file and the ETL command to re-run. Nothing here runs ETL code.

Known residual risk: the checks tie every artifact to the committed MANIFEST.json and to each
other, but the ETL does not record per-artifact hashes. The same manifest with a changed ETL
config and a partial re-run can therefore pass every check.
"""

import hashlib
import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path

import networkx as nx
import polars as pl
import shapely.errors
from pydantic import BaseModel, ConfigDict, ValidationError

from greenwave.dataset.errors import (
    CountMismatchError,
    MalformedArtifactError,
    ManifestMismatchError,
    MissingArtifactError,
    ReferentialIntegrityError,
)
from greenwave.etl.graph_io import read_graph
from greenwave.etl.intersections_pipeline import (
    APPROACHES_FILENAME,
    IDS_FILENAME,
    INTERSECTIONS_FILENAME,
    NETWORK_EDGES_FILENAME,
    NETWORK_NODES_FILENAME,
)
from greenwave.etl.manifest import ManifestEntry, load_manifest
from greenwave.etl.neighbours import approach_edges
from greenwave.etl.neighbours_pipeline import NEIGHBOURS_FILENAME

logger = logging.getLogger(__name__)

REPORT_FILENAME = "etl_report.json"

_COMMAND = "uv run python scripts/run_etl.py {step}"
_STEP_INTERSECTIONS = "intersections"
_STEP_NEIGHBOURS = "neighbours"
_CHAIN = (
    f"`{_COMMAND.format(step=_STEP_INTERSECTIONS)}` "
    f"and then `{_COMMAND.format(step=_STEP_NEIGHBOURS)}`"
)
_EXAMPLES_IN_MESSAGE = 5

# file -> step that writes it
_PRODUCED_BY = {
    NETWORK_NODES_FILENAME: _STEP_INTERSECTIONS,
    NETWORK_EDGES_FILENAME: _STEP_INTERSECTIONS,
    INTERSECTIONS_FILENAME: _STEP_INTERSECTIONS,
    APPROACHES_FILENAME: _STEP_INTERSECTIONS,
    IDS_FILENAME: _STEP_INTERSECTIONS,
    NEIGHBOURS_FILENAME: _STEP_NEIGHBOURS,
    REPORT_FILENAME: _STEP_INTERSECTIONS,
}

# Columns the loader reads by name (dtype None: presence only). Other columns are carried through.
_REQUIRED_COLUMNS: dict[str, dict[str, pl.DataType | type[pl.DataType] | None]] = {
    NETWORK_NODES_FILENAME: {"node_key": pl.String},
    NETWORK_EDGES_FILENAME: {
        "u": pl.String,
        "v": pl.String,
        "edge_id": pl.String,
        "geometry_wkb": pl.Binary,
    },
    INTERSECTIONS_FILENAME: {
        "intersection_id": pl.String,
        "kind": pl.String,
        "node_key": pl.String,
    },
    APPROACHES_FILENAME: {
        "signal_key": pl.String,
        "intersection_id": pl.String,
        "controlled_edge_ids": pl.List(pl.String),
        "delay_seconds": None,
    },
    NEIGHBOURS_FILENAME: {
        "from_signal_key": pl.String,
        "from_approach_edge_id": pl.String,
        "from_intersection_id": pl.String,
        "to_signal_key": pl.String,
        "to_approach_edge_id": pl.String,
        "to_intersection_id": pl.String,
        "distance_m": pl.Float64,
        "path_edge_ids": pl.List(pl.String),
    },
}


class IntersectionIdRecord(BaseModel):
    """One entry of ``intersection_ids.json``, as written by the ETL."""

    model_config = ConfigDict(frozen=True)

    id: str
    kind: str
    node_key: str
    member_nodes: tuple[str, ...]
    lon: float
    lat: float
    name: str | None


class _ValidFor(BaseModel):
    manifest_sha256: str


class _IdsDocument(BaseModel):
    valid_for: _ValidFor
    intersections: list[IntersectionIdRecord]


class _Grouping(BaseModel):
    intersections_total: int


class _Snapping(BaseModel):
    attached_signals: int
    unsnapped: list[dict[str, object]]


class _IntersectionsSection(BaseModel):
    manifest_sha256: str
    grouping: _Grouping
    snapping: _Snapping


class _NeighboursReport(BaseModel):
    threshold_m: float
    allow_u_turns: bool
    approach_edges: int
    pairs: int


class _NeighboursSection(BaseModel):
    manifest_sha256: str
    report: _NeighboursReport


class Provenance(BaseModel):
    """Where the data came from, as recorded in the committed MANIFEST.json (not edited here)."""

    model_config = ConfigDict(frozen=True)

    manifest_sha256: str
    sources: tuple[ManifestEntry, ...]


class LoadedCounts(BaseModel):
    """Row counts that were checked against ``etl_report.json`` (plus graph sizes)."""

    model_config = ConfigDict(frozen=True)

    intersections: int
    signal_approaches: int
    approach_neighbours: int
    approach_edges: int
    graph_nodes: int
    graph_edges: int


@dataclass(frozen=True, slots=True, eq=False)
class ProcessedDataset:
    """The validated processed data. Values and units are exactly as the ETL stored them.

    ``graph`` is frozen with ``nx.freeze``: that blocks structural changes (adding or removing
    nodes and edges) only. Node and edge attribute dicts, the DataFrames and the other fields are
    read-only by convention, not enforced.

    ``signal_approaches`` keeps unsnapped rows (null ``intersection_id``, empty
    ``controlled_edge_ids``). ``delay_seconds`` is carried per approach; how delays aggregate per
    route is not decided here. ``approach_neighbours`` is a candidate set only: its distance is not
    an along-route distance.
    """

    graph: nx.MultiDiGraph
    intersections: pl.DataFrame
    signal_approaches: pl.DataFrame
    approach_neighbours: pl.DataFrame
    intersection_ids: tuple[IntersectionIdRecord, ...]
    cascade_threshold_m: float
    allow_u_turns: bool
    counts: LoadedCounts
    provenance: Provenance


def load_dataset(processed_dir: Path, manifest_path: Path) -> ProcessedDataset:
    """Read, validate and return the processed data, or raise a ``DatasetError``."""
    started = time.perf_counter()

    _require_files(processed_dir, manifest_path)  # check 1
    manifest_sha256 = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    ids = _parse(_read_json(processed_dir / IDS_FILENAME), _IdsDocument, IDS_FILENAME)
    report = _read_json(processed_dir / REPORT_FILENAME)
    intersections_section = _report_section(report, "intersections", _IntersectionsSection)
    neighbours_section = _report_section(report, "neighbours", _NeighboursSection)
    _check_manifest_hashes(  # check 2
        manifest_path,
        manifest_sha256,
        {
            f"{IDS_FILENAME} (valid_for)": ids.valid_for.manifest_sha256,
            f"{REPORT_FILENAME} section 'intersections'": intersections_section.manifest_sha256,
            f"{REPORT_FILENAME} section 'neighbours'": neighbours_section.manifest_sha256,
        },
    )

    graph = _read_network(processed_dir)
    intersections = _read_parquet(processed_dir, INTERSECTIONS_FILENAME)
    approaches = _read_parquet(processed_dir, APPROACHES_FILENAME)
    neighbours = _read_parquet(processed_dir, NEIGHBOURS_FILENAME)

    _check_references(graph, intersections, approaches, neighbours)  # check 3
    _check_ids_file(ids.intersections, intersections)
    counts = _check_counts(
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


def _require_files(processed_dir: Path, manifest_path: Path) -> None:
    for filename, step in _PRODUCED_BY.items():
        if not (processed_dir / filename).is_file():
            raise MissingArtifactError(
                f"{processed_dir / filename} is missing; build it with "
                f"`{_COMMAND.format(step=step)}` (run from backend/)"
            )
    if not manifest_path.is_file():
        raise MissingArtifactError(
            f"{manifest_path} is missing; it is committed to git, so restore it from the "
            "repository (the processed data is only valid for the committed version)"
        )


def _read_json(path: Path) -> dict[str, object]:
    step = _PRODUCED_BY[path.name]
    try:
        loaded: object = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise MalformedArtifactError(
            f"{path} cannot be read as JSON ({error}); rebuild it with "
            f"`{_COMMAND.format(step=step)}`"
        ) from error
    if not isinstance(loaded, dict):
        raise MalformedArtifactError(
            f"{path} does not contain a JSON object; rebuild it with `{_COMMAND.format(step=step)}`"
        )
    return loaded


def _parse[Model: BaseModel](content: object, model: type[Model], label: str) -> Model:
    try:
        return model.model_validate(content)
    except ValidationError as error:
        raise MalformedArtifactError(
            f"{label} is missing a required key or has a wrong type ({error}); re-run {_CHAIN}"
        ) from error


def _report_section[Model: BaseModel](
    report: dict[str, object], section: str, model: type[Model]
) -> Model:
    if section not in report:
        raise MalformedArtifactError(
            f"{REPORT_FILENAME} has no section '{section}'; re-run {_CHAIN}"
        )
    return _parse(report[section], model, f"{REPORT_FILENAME} section '{section}'")


def _check_manifest_hashes(
    manifest_path: Path, manifest_sha256: str, recorded: dict[str, str]
) -> None:
    stale = [where for where, recorded_hash in recorded.items() if recorded_hash != manifest_sha256]
    if stale:
        raise ManifestMismatchError(
            f"{manifest_path} has sha256 {manifest_sha256[:12]}..., but these were built from a "
            f"different manifest: {', '.join(stale)}; re-run {_CHAIN}"
        )


def _read_parquet(processed_dir: Path, filename: str) -> pl.DataFrame:
    path = processed_dir / filename
    step = _PRODUCED_BY[filename]
    try:
        schema = pl.read_parquet_schema(path)
    except (OSError, pl.exceptions.PolarsError) as error:
        raise MalformedArtifactError(
            f"{path} is not a readable parquet file ({error}); rebuild it with "
            f"`{_COMMAND.format(step=step)}`"
        ) from error
    for column, dtype in _REQUIRED_COLUMNS[filename].items():
        if column not in schema:
            raise MalformedArtifactError(
                f"{path} has no column '{column}'; rebuild it with `{_COMMAND.format(step=step)}`"
            )
        if dtype is not None and schema[column] != dtype:
            raise MalformedArtifactError(
                f"{path} column '{column}' has type {schema[column]}, expected {dtype}; "
                f"rebuild it with `{_COMMAND.format(step=step)}`"
            )
    try:
        return pl.read_parquet(path)
    except (OSError, pl.exceptions.PolarsError) as error:
        raise MalformedArtifactError(
            f"{path} cannot be read ({error}); rebuild it with `{_COMMAND.format(step=step)}`"
        ) from error


def _read_network(processed_dir: Path) -> nx.MultiDiGraph:
    for filename in (NETWORK_NODES_FILENAME, NETWORK_EDGES_FILENAME):
        _read_parquet(processed_dir, filename)  # column and readability checks
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
            f"`{_COMMAND.format(step=_STEP_INTERSECTIONS)}`"
        ) from error


def _unknown(values: pl.Series, known: set[str]) -> list[str]:
    return sorted(v for v in values.drop_nulls().unique().to_list() if v not in known)


def _require_known(what: str, location: str, values: pl.Series, known: set[str]) -> None:
    missing = _unknown(values, known)
    if missing:
        shown = ", ".join(missing[:_EXAMPLES_IN_MESSAGE])
        more = (
            f" (and {len(missing) - _EXAMPLES_IN_MESSAGE} more)"
            if len(missing) > _EXAMPLES_IN_MESSAGE
            else ""
        )
        raise ReferentialIntegrityError(
            f"{location} references {len(missing)} {what} that do not exist: {shown}{more}; "
            f"the artifacts come from different runs, re-run {_CHAIN}"
        )


def _check_references(
    graph: nx.MultiDiGraph,
    intersections: pl.DataFrame,
    approaches: pl.DataFrame,
    neighbours: pl.DataFrame,
) -> None:
    ids = intersections["intersection_id"]
    if ids.null_count() or ids.n_unique() != len(ids):
        raise ReferentialIntegrityError(
            f"{INTERSECTIONS_FILENAME} has null or duplicate intersection_id values; "
            f"re-run {_CHAIN}"
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


def _check_ids_file(records: list[IntersectionIdRecord], intersections: pl.DataFrame) -> None:
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
            f"for {len(differing)} ids, e.g. {', '.join(differing[:_EXAMPLES_IN_MESSAGE])}; "
            f"re-run {_CHAIN}"
        )


def _check_counts(
    graph: nx.MultiDiGraph,
    intersections: pl.DataFrame,
    approaches: pl.DataFrame,
    neighbours: pl.DataFrame,
    intersections_section: _IntersectionsSection,
    neighbours_section: _NeighboursSection,
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
                f"re-run {_CHAIN}"
            )
    return LoadedCounts(
        intersections=intersections.height,
        signal_approaches=approaches.height,
        approach_neighbours=neighbours.height,
        approach_edges=approach_edge_count,
        graph_nodes=graph.number_of_nodes(),
        graph_edges=graph.number_of_edges(),
    )
