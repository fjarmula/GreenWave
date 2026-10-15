"""Constants of the dataset loader: ETL command templates, step names, the file -> step map and
the columns the loader requires."""

import polars as pl

from greenwave.etl.intersections_pipeline import (
    APPROACHES_FILENAME,
    IDS_FILENAME,
    INTERSECTIONS_FILENAME,
    NETWORK_EDGES_FILENAME,
    NETWORK_NODES_FILENAME,
)
from greenwave.etl.io import REPORT_FILENAME
from greenwave.etl.neighbours_pipeline import NEIGHBOURS_FILENAME

_COMMAND = "uv run python scripts/run_etl.py {step}"
_STEP_INTERSECTIONS = "intersections"
_STEP_NEIGHBOURS = "neighbours"
_NEIGHBOURS_COMMAND = f"`{_COMMAND.format(step=_STEP_NEIGHBOURS)}`"
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
        "delay_seconds": pl.Float64,
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
