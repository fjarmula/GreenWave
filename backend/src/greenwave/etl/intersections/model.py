"""Shared constants, settings and records of the T4 intersection build."""

from dataclasses import dataclass, field

from greenwave.etl.config import (
    ASSIGNMENT_LIMIT_METERS,
    CROSSING_MERGE_DISTANCE_METERS,
    MERGE_DISTANCE_METERS,
    MERGE_MAX_GROUP_DIAMETER_METERS,
)

METHOD_NEAREST = "nearest_junction"
METHOD_OVERRIDE_ARM = "override_entry_arm"
METHOD_NONE = "no_junction_reachable"
REASON_BEYOND_LIMIT = "beyond_assignment_limit"
REASON_NO_JUNCTION = "no_junction_reachable"
NAME_SOURCE_STREETS = "osm_street_names"
NAME_SOURCE_COORDINATES = "coordinates"


@dataclass(frozen=True, slots=True)
class GroupingSettings:
    assignment_limit_meters: float = ASSIGNMENT_LIMIT_METERS
    merge_distance_meters: float = MERGE_DISTANCE_METERS
    merge_max_group_diameter_meters: float = MERGE_MAX_GROUP_DIAMETER_METERS
    crossing_merge_distance_meters: float = CROSSING_MERGE_DISTANCE_METERS

    def __post_init__(self) -> None:
        if (
            min(
                self.assignment_limit_meters,
                self.merge_distance_meters,
                self.merge_max_group_diameter_meters,
                self.crossing_merge_distance_meters,
            )
            <= 0
        ):
            raise ValueError(
                "assignment limit, merge distances and diameter cap must be positive (m)"
            )


@dataclass(slots=True)
class Assignment:
    attachment_index: int
    junction_node: str | None
    distance_m: float | None
    method: str


@dataclass(slots=True)
class IntersectionRecord:
    kind: str
    nodes: list[str]
    approach_indices: list[int] = field(default_factory=list)
    ring_id: int | None = None
    intersection_id: str = ""
    representative: str = ""
    lon: float = 0.0
    lat: float = 0.0
    street_names: list[str] = field(default_factory=list)
    name: str = ""
    name_source: str = NAME_SOURCE_COORDINATES
