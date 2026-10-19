"""Cross-check of the Kraków bus-lane register (``Buspasy_*.csv``) against OSM bus-lane edges.

The CSV has no geometry; each row names its street and extent in ``Opis``
("<street> od <from> do <to>"). Rows are matched to network edges by normalised street name. This
is analysis only: it never changes an edge attribute.
"""

import csv
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import networkx as nx
import polars as pl

from greenwave.etl.street_names import normalise_street_name

BUS_LANE_CSV_PATTERN = "krakow/Buspasy_*.csv"

STATUS_OSM_HAS_BUS_LANE = "osm_has_bus_lane"
STATUS_OSM_STREET_WITHOUT_BUS_LANE = "osm_street_without_bus_lane"
STATUS_STREET_NOT_FOUND = "street_not_found"
STATUS_UNPARSED = "unparsed"

_OPIS = re.compile(r"^(?P<street>.+?)\s+od\s+(?P<from_>.+?)\s+do\s+(?P<to>.+)$")


@dataclass(frozen=True, slots=True)
class BusLaneRow:
    objectid: int
    kategoria: str
    organizacja: str
    opis: str
    csv_length_m: float | None


@dataclass(frozen=True, slots=True)
class ParsedOpis:
    street: str
    from_: str | None
    to: str | None


def find_bus_lane_csv(raw_dir: Path) -> Path:
    matches = sorted(raw_dir.glob(BUS_LANE_CSV_PATTERN))
    if len(matches) != 1:
        raise FileNotFoundError(
            f"expected exactly one {BUS_LANE_CSV_PATTERN} in {raw_dir}, found {len(matches)}"
        )
    return matches[0]


def read_bus_lane_csv(path: Path) -> list[BusLaneRow]:
    """Read the register (UTF-8 with BOM)."""
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return [
            BusLaneRow(
                objectid=int(row["OBJECTID"]),
                kategoria=row["Kategoria"],
                organizacja=row["Organizacja"],
                opis=row["Opis"].strip(),
                csv_length_m=float(row["Długość [m]"]) if row["Długość [m]"] else None,
            )
            for row in csv.DictReader(handle)
        ]


def parse_opis(opis: str) -> ParsedOpis | None:
    """``<street> od <from> do <to>``; ``None`` when the description has another shape."""
    match = _OPIS.match(opis.strip())
    if match is None:
        return None
    return ParsedOpis(match["street"], match["from_"], match["to"])


def _matching_names(street: str, names: set[str]) -> set[str]:
    """Exact normalised match, else names containing every token of the street (abbreviations:
    "Al. Focha" against "Aleja Marszałka Ferdynanda Focha")."""
    if not street:
        return set()
    if street in names:
        return {street}
    tokens = set(street.split())
    return {name for name in names if tokens <= set(name.split())}


def crosscheck_bus_lanes(
    rows: list[BusLaneRow], graph: nx.MultiDiGraph, ulice_names: set[str]
) -> pl.DataFrame:
    """One row per CSV row, sorted by ``objectid``; ``ulice_names`` are normalised names."""
    edges_by_name: defaultdict[str, int] = defaultdict(int)
    bus_m_by_name: defaultdict[str, float] = defaultdict(float)
    for *_, data in graph.edges(data=True):
        if data["name"]:
            key = normalise_street_name(data["name"])
            edges_by_name[key] += 1
            bus_m_by_name[key] += data["length_m"] if data["bus_lane"] else 0.0
    osm_names = set(edges_by_name)

    records: list[dict[str, object]] = []
    for row in sorted(rows, key=lambda r: r.objectid):
        parsed = parse_opis(row.opis)
        record: dict[str, object] = {
            "objectid": row.objectid,
            "kategoria": row.kategoria,
            "organizacja": row.organizacja,
            "street": None,
            "from": None,
            "to": None,
            "csv_length_m": row.csv_length_m,
            "street_in_ulice": None,
            "osm_edges_on_street": None,
            "osm_bus_lane_km_on_street": None,
            "status": STATUS_UNPARSED,
        }
        if parsed is not None:
            street = normalise_street_name(parsed.street)
            matched = _matching_names(street, osm_names)
            edges = sum(edges_by_name[name] for name in matched)
            bus_km = sum(bus_m_by_name[name] for name in matched) / 1000
            if edges == 0:
                status = STATUS_STREET_NOT_FOUND
            elif bus_km > 0:
                status = STATUS_OSM_HAS_BUS_LANE
            else:
                status = STATUS_OSM_STREET_WITHOUT_BUS_LANE
            record |= {
                "street": parsed.street,
                "from": parsed.from_,
                "to": parsed.to,
                "street_in_ulice": bool(_matching_names(street, ulice_names)),
                "osm_edges_on_street": edges,
                "osm_bus_lane_km_on_street": bus_km,
                "status": status,
            }
        records.append(record)
    return pl.DataFrame(
        records,
        schema={
            "objectid": pl.Int64,
            "kategoria": pl.String,
            "organizacja": pl.String,
            "street": pl.String,
            "from": pl.String,
            "to": pl.String,
            "csv_length_m": pl.Float64,
            "street_in_ulice": pl.Boolean,
            "osm_edges_on_street": pl.Int64,
            "osm_bus_lane_km_on_street": pl.Float64,
            "status": pl.String,
        },
    )
