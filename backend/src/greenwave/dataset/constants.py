"""Constants of the dataset loader: ETL command templates, step names, the file -> step map and
the columns the loader requires."""

import polars as pl

from greenwave.artifacts import (
    APPROACHES_FILENAME,
    IDS_FILENAME,
    INTERSECTIONS_FILENAME,
    NEIGHBOURS_FILENAME,
    NETWORK_EDGES_FILENAME,
    NETWORK_NODES_FILENAME,
    REPORT_FILENAME,
)

COMMAND = "uv run python scripts/run_etl.py {step}"
STEP_INTERSECTIONS = "intersections"
STEP_NEIGHBOURS = "neighbours"
NEIGHBOURS_COMMAND = f"`{COMMAND.format(step=STEP_NEIGHBOURS)}`"
CHAIN = (
    f"`{COMMAND.format(step=STEP_INTERSECTIONS)}` and then `{COMMAND.format(step=STEP_NEIGHBOURS)}`"
)
EXAMPLES_IN_MESSAGE = 5

# file -> step that writes it
PRODUCED_BY = {
    NETWORK_NODES_FILENAME: STEP_INTERSECTIONS,
    NETWORK_EDGES_FILENAME: STEP_INTERSECTIONS,
    INTERSECTIONS_FILENAME: STEP_INTERSECTIONS,
    APPROACHES_FILENAME: STEP_INTERSECTIONS,
    IDS_FILENAME: STEP_INTERSECTIONS,
    NEIGHBOURS_FILENAME: STEP_NEIGHBOURS,
    REPORT_FILENAME: STEP_INTERSECTIONS,
}

# Columns the loader reads by name (dtype None: presence only). Other columns are carried through.
REQUIRED_COLUMNS: dict[str, dict[str, pl.DataType | type[pl.DataType] | None]] = {
    NETWORK_NODES_FILENAME: {"node_key": pl.String},
    NETWORK_EDGES_FILENAME: {
        "u": pl.String,
        "v": pl.String,
        "edge_id": pl.String,
        "geometry_wkb": pl.Binary,
        "bus_lane": pl.Boolean,
        "tram_track": pl.Boolean,
        "lanes_per_direction": pl.Int64,
        "surface_class": pl.String,
        "calming_count": pl.Int64,
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
