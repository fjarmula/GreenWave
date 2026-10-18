"""T1 road statistics: tag coverage by road class (by ways and by length), vertex topology."""

import re
from collections import Counter, defaultdict
from dataclasses import dataclass

import numpy as np
import shapely
from numpy.typing import NDArray

from greenwave.etl.config import COVERAGE_TAGS, DRIVABLE_HIGHWAY_VALUES, EXACT_ONLY_TAGS
from greenwave.etl.geo import project_lines
from greenwave.etl.profile_models import RoadClassProfile, TagCoverage
from greenwave.etl.profile_osm import DrivableWay, LonLat, OsmScan, tag

_NUMERIC_MAXSPEED = re.compile(r"^\d+(\s*(km/h|kmh))?$")
_TOP_VALUES = 15


@dataclass(slots=True)
class RoadTopology:
    """Vertex usage over drivable ways, keyed by the exact source lon/lat pair."""

    ways_per_vertex: Counter[LonLat]
    endpoints: set[LonLat]


@dataclass(slots=True)
class RoadAnalysis:
    projected_lines: NDArray[np.object_]
    lengths_m: NDArray[np.float64]
    topology: RoadTopology
    overall: RoadClassProfile
    by_class: list[RoadClassProfile]
    service_subtypes: Counter[str]
    maxspeed_unparsed: Counter[str]
    oneway_values: Counter[str]


def tag_present(properties: dict[str, object], tag_name: str) -> bool:
    if tag_name in properties:
        return True
    if tag_name in EXACT_ONLY_TAGS:
        return False
    prefix = f"{tag_name}:"
    return any(key.startswith(prefix) for key in properties)


def build_topology(ways: list[DrivableWay]) -> RoadTopology:
    ways_per_vertex: Counter[LonLat] = Counter()
    endpoints: set[LonLat] = set()
    for way in ways:
        ways_per_vertex.update(set(way.coordinates))
        endpoints.add(way.coordinates[0])
        endpoints.add(way.coordinates[-1])
    return RoadTopology(ways_per_vertex, endpoints)


def _class_profile(
    highway: str,
    indices: list[int],
    lengths_m: NDArray[np.float64],
    present: dict[str, NDArray[np.bool_]],
) -> RoadClassProfile:
    selected = np.asarray(indices, dtype=np.int64)
    class_length_m = float(lengths_m[selected].sum())
    coverage: dict[str, TagCoverage] = {}
    for tag_name, flags in present.items():
        flagged = flags[selected]
        tagged_ways = int(flagged.sum())
        tagged_length_m = float(lengths_m[selected][flagged].sum())
        coverage[tag_name] = TagCoverage(
            ways_with_tag=tagged_ways,
            share_of_ways=tagged_ways / len(indices) if indices else 0.0,
            length_km_with_tag=tagged_length_m / 1000,
            share_of_length=tagged_length_m / class_length_m if class_length_m else 0.0,
        )
    return RoadClassProfile(
        highway=highway,
        ways=len(indices),
        length_km=class_length_m / 1000,
        tag_coverage=coverage,
    )


def _tag_value_tallies(
    ways: list[DrivableWay],
) -> tuple[Counter[str], Counter[str], Counter[str]]:
    """Unparsed maxspeed values, oneway values and service subtypes, counted per way."""
    maxspeed_unparsed: Counter[str] = Counter()
    oneway_values: Counter[str] = Counter()
    service_subtypes: Counter[str] = Counter()
    for way in ways:
        maxspeed = tag(way.properties, "maxspeed")
        if maxspeed is not None and not _NUMERIC_MAXSPEED.match(maxspeed):
            maxspeed_unparsed[maxspeed] += 1
        oneway_values[tag(way.properties, "oneway") or "<absent>"] += 1
        if way.highway == "service":
            service_subtypes[tag(way.properties, "service") or "<absent>"] += 1
    return maxspeed_unparsed, oneway_values, service_subtypes


def analyse_roads(scan: OsmScan) -> RoadAnalysis:
    ways = scan.drivable_ways
    projected = project_lines([shapely.LineString(way.coordinates) for way in ways])
    lengths_m = np.asarray(shapely.length(projected), dtype=np.float64)

    present = {
        name: np.fromiter(
            (tag_present(way.properties, name) for way in ways), dtype=np.bool_, count=len(ways)
        )
        for name in COVERAGE_TAGS
    }
    indices_by_class: dict[str, list[int]] = defaultdict(list)
    for index, way in enumerate(ways):
        indices_by_class[way.highway].append(index)

    overall = _class_profile("ALL_DRIVABLE", list(range(len(ways))), lengths_m, present)
    by_class = sorted(
        (
            _class_profile(highway, indices, lengths_m, present)
            for highway, indices in indices_by_class.items()
        ),
        key=lambda profile: profile.ways,
        reverse=True,
    )

    maxspeed_unparsed, oneway_values, service_subtypes = _tag_value_tallies(ways)

    return RoadAnalysis(
        projected_lines=projected,
        lengths_m=lengths_m,
        topology=build_topology(ways),
        overall=overall,
        by_class=by_class,
        service_subtypes=service_subtypes,
        maxspeed_unparsed=Counter(dict(maxspeed_unparsed.most_common(_TOP_VALUES))),
        oneway_values=oneway_values,
    )


def drivable_definition_text() -> str:
    return (
        "highway in {" + ", ".join(sorted(DRIVABLE_HIGHWAY_VALUES)) + "} (LineString only), "
        "excluding access=private|no; provisional, see etl/config.py"
    )
