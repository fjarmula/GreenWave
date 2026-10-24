"""Incident dispatch contract: stations, local geocoding and station ranking (ADR 0006).

Additive to contract v1; ``schema_version`` stays ``"1.0"``.
"""

from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, Field

from greenwave.schemas.simulation import (
    OnFootLeg,
    Position,
    SchemaVersion,
    SnappedEndpoint,
    VehicleType,
)

STATION_ID_PATTERN = r"^STN-[AFP]-\d{4}$"


class StationSourceKind(StrEnum):
    """Where a station comes from; the UI names it, so hospital EDs are not passed off as bases."""

    AMBULANCE_BASE = "ambulance_base"
    HOSPITAL_ED = "hospital_ed"
    FIRE_STATE = "fire_state"
    FIRE_VOLUNTEER = "fire_volunteer"
    FIRE_OTHER = "fire_other"
    POLICE = "police"


class Station(BaseModel):
    station_id: Annotated[str, Field(pattern=STATION_ID_PATTERN)]
    vehicle_type: VehicleType
    source_kind: StationSourceKind
    name: str
    position: Position


class StationsResponse(BaseModel):
    schema_version: SchemaVersion
    stations: list[Station]  # all vehicle types, sorted by station_id


class GeocodeResult(BaseModel):
    label: str  # "Street 15"
    position: Position


class GeocodeResponse(BaseModel):
    schema_version: SchemaVersion
    results: list[GeocodeResult]


class DispatchRankRequest(BaseModel):
    incident: Position
    vehicle_type: VehicleType


class RankedCandidate(BaseModel):
    station: Station
    greenwave_seconds: Annotated[float, Field(ge=0.0)]  # the preflight green-wave estimate
    distance_m: Annotated[float, Field(ge=0.0)]  # route length
    # Off-road incident: the walk from this station's access point; candidates are ordered by
    # greenwave_seconds + on_foot.seconds.
    on_foot: OnFootLeg | None = None


class DispatchRankResponse(BaseModel):
    schema_version: SchemaVersion
    incident_snapped: SnappedEndpoint
    candidates: Annotated[list[RankedCandidate], Field(min_length=1, max_length=3)]  # best first
    # A station of the type on the incident's own node: not routable, left out of candidates.
    station_at_incident: Station | None


__all__ = [
    "DispatchRankRequest",
    "DispatchRankResponse",
    "GeocodeResponse",
    "GeocodeResult",
    "RankedCandidate",
    "Station",
    "StationSourceKind",
    "StationsResponse",
]
