"""Name intersections from their streets, and report how the names match the Ulice register."""

from collections import Counter

import networkx as nx
from pydantic import BaseModel

from greenwave.etl.intersections.model import (
    NAME_SOURCE_COORDINATES,
    NAME_SOURCE_STREETS,
    IntersectionRecord,
)
from greenwave.etl.junctions import Ring, coordinate_name, street_name_components
from greenwave.etl.street_names import normalise_street_name


def assign_names(record: IntersectionRecord, graph: nx.MultiDiGraph, ring: Ring | None) -> None:
    """Street names around the record, a named ring first (at most three), else its coordinates."""
    names = street_name_components(graph, record.nodes)
    if ring is not None and ring.name:
        ring_key = normalise_street_name(ring.name)
        others = (n for n in names if normalise_street_name(n) != ring_key)
        names = [ring.name, *others][:3]
    record.street_names = names
    if names:
        record.name, record.name_source = " / ".join(names), NAME_SOURCE_STREETS
    else:
        record.name = coordinate_name(record.lat, record.lon)
        record.name_source = NAME_SOURCE_COORDINATES


class NameReport(BaseModel):
    by_source: dict[str, int]
    single_street_intersections: int
    components_total: int
    components_found_in_ulice: int
    share_found_in_ulice: float
    intersections_with_every_component_in_ulice: int
    intersections_with_streets: int
    components_not_in_ulice: dict[str, int]


def name_report(intersections: list[IntersectionRecord], ulice_names: set[str]) -> NameReport:
    with_streets = [i for i in intersections if i.street_names]
    flags = [
        [normalise_street_name(n) in ulice_names for n in i.street_names] for i in with_streets
    ]
    missing: Counter[str] = Counter(
        name
        for record, record_flags in zip(with_streets, flags, strict=True)
        for name, found in zip(record.street_names, record_flags, strict=True)
        if not found
    )
    total = sum(len(f) for f in flags)
    found = sum(sum(f) for f in flags)
    return NameReport(
        by_source=dict(Counter(i.name_source for i in intersections)),
        single_street_intersections=sum(len(i.street_names) == 1 for i in intersections),
        components_total=total,
        components_found_in_ulice=found,
        share_found_in_ulice=found / total if total else 0.0,
        intersections_with_every_component_in_ulice=sum(all(f) for f in flags),
        intersections_with_streets=len(with_streets),
        components_not_in_ulice=dict(missing.most_common(30)),
    )
