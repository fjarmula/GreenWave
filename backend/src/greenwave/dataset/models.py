"""Models of the dataset loader: the validated shapes of the ETL JSON files and the read-only
``ProcessedDataset`` it returns."""

from dataclasses import dataclass

import networkx as nx
import polars as pl
from pydantic import BaseModel, ConfigDict

from greenwave.etl.manifest import ManifestEntry


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


class IdsDocument(BaseModel):
    valid_for: _ValidFor
    intersections: list[IntersectionIdRecord]


class _Grouping(BaseModel):
    intersections_total: int


class _Snapping(BaseModel):
    attached_signals: int
    unsnapped: list[dict[str, object]]


class IntersectionsSection(BaseModel):
    manifest_sha256: str
    artifact_sha256: dict[str, str] | None = None
    grouping: _Grouping
    snapping: _Snapping


class _NeighboursReport(BaseModel):
    threshold_m: float
    allow_u_turns: bool
    approach_edges: int
    pairs: int


class NeighboursSection(BaseModel):
    manifest_sha256: str
    artifact_sha256: dict[str, str] | None = None
    consumed_sha256: dict[str, str] | None = None
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
    ``controlled_edge_ids``). D_v (per type via config) is applied once per unique intersection
    INT-xxxx whose controlled approach a route passes; a route crossing two approaches of one
    intersection pays it once. ``intersections["delay_seconds"]`` is that delay by kind.
    ``signal_approaches["delay_seconds"]`` is a property of the signal node and must not be summed
    along a route. ``approach_neighbours`` is a candidate set only: its distance is not
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
