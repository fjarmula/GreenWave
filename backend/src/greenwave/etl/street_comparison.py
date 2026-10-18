"""T3 check (a): per-street length of the graph against Ulice.geojson, by normalised name."""

import json
from dataclasses import dataclass
from pathlib import Path
from statistics import median
from typing import cast

import networkx as nx
import polars as pl
from pydantic import BaseModel
from shapely.geometry import shape

from greenwave.etl.config import STREET_LENGTH_RATIO_RANGE
from greenwave.etl.street_names import normalise_street_name

_LISTED = 25


@dataclass(frozen=True, slots=True)
class StreetLength:
    display_name: str
    length_m: float


class StreetMismatch(BaseModel):
    street: str
    graph_km: float | None
    ulice_km: float | None
    ratio: float | None


class StreetComparisonReport(BaseModel):
    ratio_range: tuple[float, float]
    ulice_streets: int
    ulice_km: float
    graph_named_streets: int
    graph_named_km: float
    graph_unnamed_km: float
    matched_streets: int
    ulice_km_matched: float
    graph_km_matched: float
    ulice_only_streets: int
    ulice_only_km: float
    graph_only_streets: int
    graph_only_km: float
    matched_in_range_streets: int
    matched_in_range_share_of_matched_ulice_km: float
    median_ratio: float | None
    graph_longer_streets: int
    graph_shorter_streets: int
    worst_graph_longer: list[StreetMismatch]
    worst_graph_shorter: list[StreetMismatch]
    largest_ulice_only: list[StreetMismatch]
    largest_graph_only: list[StreetMismatch]


@dataclass(frozen=True, slots=True)
class StreetComparison:
    report: StreetComparisonReport
    table: pl.DataFrame


def graph_street_lengths(graph: nx.MultiDiGraph) -> tuple[dict[str, StreetLength], float]:
    """Road length per normalised name (each segment once) and the length with no name (m)."""
    named: dict[str, StreetLength] = {}
    unnamed_m = 0.0
    for _, _, data in graph.edges(data=True):
        if data["reverse_twin"]:
            continue  # the reverse direction of a two-way segment is the same road
        name = data["name"]
        key = normalise_street_name(name) if name else ""
        if not key:
            unnamed_m += data["length_m"]
            continue
        previous = named.get(key)
        named[key] = StreetLength(
            previous.display_name if previous else name,
            (previous.length_m if previous else 0.0) + data["length_m"],
        )
    return named, unnamed_m


def ulice_street_lengths(path: Path) -> dict[str, StreetLength]:
    """Length in metres per normalised ``nazwa_ulicy``; the file is already in EPSG:2178."""
    document = cast("dict[str, object]", json.loads(path.read_text(encoding="utf-8")))
    streets: dict[str, StreetLength] = {}
    for feature in cast("list[dict[str, object]]", document["features"]):
        properties = cast("dict[str, object]", feature["properties"])
        name = str(properties["nazwa_ulicy"])
        key = normalise_street_name(name)
        previous = streets.get(key)
        streets[key] = StreetLength(
            previous.display_name if previous else name,
            (previous.length_m if previous else 0.0) + float(shape(feature["geometry"]).length),
        )
    return streets


_TABLE_SCHEMA = {
    "normalised_name": pl.String,
    "graph_name": pl.String,
    "ulice_name": pl.String,
    "graph_km": pl.Float64,
    "ulice_km": pl.Float64,
    "ratio": pl.Float64,
    "status": pl.String,
}


def compare_streets(
    graph_streets: dict[str, StreetLength],
    graph_unnamed_m: float,
    ulice_streets: dict[str, StreetLength],
    ratio_range: tuple[float, float] = STREET_LENGTH_RATIO_RANGE,
) -> StreetComparison:
    table = _comparison_table(graph_streets, ulice_streets, ratio_range)
    report = _comparison_report(table, graph_streets, graph_unnamed_m, ulice_streets, ratio_range)
    return StreetComparison(report=report, table=table.sort("status", "normalised_name"))


def _street_status(
    graph_entry: StreetLength | None,
    ulice_entry: StreetLength | None,
    ratio: float | None,
    ratio_range: tuple[float, float],
) -> str:
    low, high = ratio_range
    if graph_entry is None:
        return "ulice_only"
    if ulice_entry is None:
        return "graph_only"
    if ratio is not None and ratio < low:
        return "graph_shorter"
    if ratio is not None and ratio > high:
        return "graph_longer"
    return "within_range"


def _comparison_table(
    graph_streets: dict[str, StreetLength],
    ulice_streets: dict[str, StreetLength],
    ratio_range: tuple[float, float],
) -> pl.DataFrame:
    """One row per normalised name present in either source, with its status."""
    rows: list[dict[str, object]] = []
    for key in sorted(graph_streets.keys() | ulice_streets.keys()):
        graph_entry, ulice_entry = graph_streets.get(key), ulice_streets.get(key)
        ratio = (
            graph_entry.length_m / ulice_entry.length_m
            if graph_entry and ulice_entry and ulice_entry.length_m
            else None
        )
        rows.append(
            {
                "normalised_name": key,
                "graph_name": graph_entry.display_name if graph_entry else None,
                "ulice_name": ulice_entry.display_name if ulice_entry else None,
                "graph_km": graph_entry.length_m / 1000 if graph_entry else None,
                "ulice_km": ulice_entry.length_m / 1000 if ulice_entry else None,
                "ratio": ratio,
                "status": _street_status(graph_entry, ulice_entry, ratio, ratio_range),
            }
        )
    return pl.DataFrame(rows, schema=_TABLE_SCHEMA)


def _sum_km(frame: pl.DataFrame, column: str) -> float:
    return float(frame[column].fill_null(0.0).sum())


def _top(frame: pl.DataFrame, sort_column: str, descending: bool = True) -> list[StreetMismatch]:
    ranked = frame.sort(sort_column, descending=descending, nulls_last=True).head(_LISTED)
    return [
        StreetMismatch(
            street=str(row["graph_name"] or row["ulice_name"]),
            graph_km=row["graph_km"],
            ulice_km=row["ulice_km"],
            ratio=row["ratio"],
        )
        for row in ranked.iter_rows(named=True)
    ]


def _comparison_report(
    table: pl.DataFrame,
    graph_streets: dict[str, StreetLength],
    graph_unnamed_m: float,
    ulice_streets: dict[str, StreetLength],
    ratio_range: tuple[float, float],
) -> StreetComparisonReport:
    matched = table.filter(
        pl.col("status").is_in(["within_range", "graph_longer", "graph_shorter"])
    )
    ratios = matched["ratio"].drop_nulls().to_list()
    in_range = matched.filter(pl.col("status") == "within_range")
    longer = matched.filter(pl.col("status") == "graph_longer").with_columns(
        (pl.col("graph_km") - pl.col("ulice_km")).alias("excess_km")
    )
    shorter = matched.filter(pl.col("status") == "graph_shorter").with_columns(
        (pl.col("ulice_km") - pl.col("graph_km")).alias("shortfall_km")
    )
    ulice_only = table.filter(pl.col("status") == "ulice_only")
    graph_only = table.filter(pl.col("status") == "graph_only")
    matched_ulice_km = _sum_km(matched, "ulice_km")

    return StreetComparisonReport(
        ratio_range=ratio_range,
        ulice_streets=len(ulice_streets),
        ulice_km=sum(s.length_m for s in ulice_streets.values()) / 1000,
        graph_named_streets=len(graph_streets),
        graph_named_km=sum(s.length_m for s in graph_streets.values()) / 1000,
        graph_unnamed_km=graph_unnamed_m / 1000,
        matched_streets=matched.height,
        ulice_km_matched=matched_ulice_km,
        graph_km_matched=_sum_km(matched, "graph_km"),
        ulice_only_streets=ulice_only.height,
        ulice_only_km=_sum_km(ulice_only, "ulice_km"),
        graph_only_streets=graph_only.height,
        graph_only_km=_sum_km(graph_only, "graph_km"),
        matched_in_range_streets=in_range.height,
        matched_in_range_share_of_matched_ulice_km=(
            _sum_km(in_range, "ulice_km") / matched_ulice_km if matched_ulice_km else 0.0
        ),
        median_ratio=median(ratios) if ratios else None,
        graph_longer_streets=longer.height,
        graph_shorter_streets=shorter.height,
        worst_graph_longer=_top(longer, "excess_km"),
        worst_graph_shorter=_top(shorter, "shortfall_km"),
        largest_ulice_only=_top(ulice_only, "ulice_km"),
        largest_graph_only=_top(graph_only, "graph_km"),
    )
