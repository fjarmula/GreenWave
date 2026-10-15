"""Persist the road graph as two parquet files (nodes, edges with WKB geometry).

Parquet instead of a pickle: the artifact is inspectable and cannot execute code when loaded.
The server loader (T7) rebuilds the ``MultiDiGraph`` with ``read_graph``.
"""

from pathlib import Path

import networkx as nx
import polars as pl
import shapely

NODES_FILENAME = "road_nodes.parquet"
EDGES_FILENAME = "road_edges.parquet"

_NODE_COLUMNS = ("node_key", "lon", "lat", "x_m", "y_m")
_EDGE_ATTRIBUTES = (
    "edge_id",
    "base_edge_id",
    "length_m",
    "highway",
    "speed_kmh",
    "speed_source",
    "oneway_source",
    "lanes",
    "name",
    "junction",
    "source_line",
    "segment_index",
    "reverse_twin",
)


def write_graph(
    graph: nx.MultiDiGraph,
    directory: Path,
    nodes_filename: str = NODES_FILENAME,
    edges_filename: str = EDGES_FILENAME,
) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    nodes = pl.DataFrame(
        {
            "node_key": list(graph.nodes),
            **{col: [graph.nodes[n][col] for n in graph.nodes] for col in _NODE_COLUMNS[1:]},
        },
        schema={
            "node_key": pl.String,
            "lon": pl.Float64,
            "lat": pl.Float64,
            "x_m": pl.Float64,
            "y_m": pl.Float64,
        },
    )
    edges_rows = sorted(graph.edges(data=True), key=lambda edge: edge[2]["edge_id"])
    edges = pl.DataFrame(
        {
            "u": [u for u, _, _ in edges_rows],
            "v": [v for _, v, _ in edges_rows],
            **{attr: [data[attr] for _, _, data in edges_rows] for attr in _EDGE_ATTRIBUTES},
            "geometry_wkb": [shapely.to_wkb(data["geometry"]) for _, _, data in edges_rows],
        },
        schema={
            "u": pl.String,
            "v": pl.String,
            "edge_id": pl.String,
            "base_edge_id": pl.String,
            "length_m": pl.Float64,
            "highway": pl.String,
            "speed_kmh": pl.Int64,
            "speed_source": pl.String,
            "oneway_source": pl.String,
            "lanes": pl.Int64,
            "name": pl.String,
            "junction": pl.String,
            "source_line": pl.Int64,
            "segment_index": pl.Int64,
            "reverse_twin": pl.Boolean,
            "geometry_wkb": pl.Binary,
        },
    )
    nodes.write_parquet(directory / nodes_filename)
    edges.write_parquet(directory / edges_filename)


def read_graph(
    directory: Path,
    nodes_filename: str = NODES_FILENAME,
    edges_filename: str = EDGES_FILENAME,
) -> nx.MultiDiGraph:
    graph: nx.MultiDiGraph = nx.MultiDiGraph()
    for row in pl.read_parquet(directory / nodes_filename).iter_rows(named=True):
        graph.add_node(row["node_key"], **{c: row[c] for c in _NODE_COLUMNS[1:]})
    for row in pl.read_parquet(directory / edges_filename).iter_rows(named=True):
        attributes = {attr: row[attr] for attr in _EDGE_ATTRIBUTES}
        graph.add_edge(
            row["u"],
            row["v"],
            key=row["edge_id"],
            geometry=shapely.from_wkb(row["geometry_wkb"]),
            **attributes,
        )
    return graph
