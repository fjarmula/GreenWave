"""Read and parse the processed artifacts, failing with a dataset error that names the file."""

import json
from pathlib import Path

import networkx as nx
import polars as pl
import shapely.errors
from pydantic import BaseModel, ValidationError

from greenwave.artifacts import (
    NETWORK_EDGES_FILENAME,
    NETWORK_NODES_FILENAME,
    REPORT_FILENAME,
)
from greenwave.dataset.constants import (
    CHAIN,
    COMMAND,
    PRODUCED_BY,
    REQUIRED_COLUMNS,
    STEP_INTERSECTIONS,
)
from greenwave.dataset.errors import (
    MalformedArtifactError,
    MissingArtifactError,
)
from greenwave.etl.graph_io import read_graph


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
