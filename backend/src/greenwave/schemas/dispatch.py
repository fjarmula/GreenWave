"""Incident dispatch contract: stations, local geocoding and station ranking (ADR 0006).

Geocode results carry their address provenance, EMUiA vs OSM (ADR 0013).

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

    PRM_BASE = "prm_base"  # an official PRM team base (ambulance origins since ADR 0014)
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


class AddressProvenance(StrEnum):
    """Where an address coordinate comes from (ADR 0013); EMUiA is Kraków's address register."""

    MATCHED = "matched"  # in EMUiA and OSM; the coordinate is EMUiA's
    MUNICIPAL = "municipal"  # in EMUiA, no OSM counterpart
    OSM = "osm"  # OSM only (fallback)


class GeocodeResult(BaseModel):
    """An address point: where to geocode an incident, not where a vehicle can stop."""

    label: str  # "Street 15"
    position: Position  # the authoritative coordinate
    provenance: AddressProvenance
    # Matched only: distance between the EMUiA and OSM points of the address.
    osm_delta_m: Annotated[float, Field(ge=0.0)] | None = None
    # Matched and farther apart than the clean threshold (100 m): the same as osm_delta_m.
    disagreement_m: Annotated[float, Field(ge=0.0)] | None = None
    osm_position: Position | None = None  # set exactly when disagreement_m is set
    # Municipal only: OSM has this street and number, but not as this address.
    osm_same_key_elsewhere: bool = False


class GeocodeResponse(BaseModel):
    schema_version: SchemaVersion
    results: list[GeocodeResult]


class DispatchRankRequest(BaseModel):
    incident: Position
    vehicle_type: VehicleType
    # Density the standard estimate is computed for; the run's own multiplier (1.0-3.0).
    traffic_density_multiplier: Annotated[float, Field(ge=1.0, le=3.0)] = 1.0


class RankedCandidate(BaseModel):
    station: Station
    greenwave_seconds: Annotated[float, Field(ge=0.0)]  # the preflight green-wave estimate
    # The exact pre-run standard estimate (ER Green Wave disabled) at the request's density.
    standard_seconds: Annotated[float, Field(ge=0.0)]
    distance_m: Annotated[float, Field(ge=0.0)]  # route length
    # Off-road incident: the walk from this station's access point; candidates are ordered by
    # greenwave_seconds + on_foot.seconds.
    on_foot: OnFootLeg | None = None
    # The incident is at the station (ADR 0012): no drive (both times and distance_m are 0); the
    # crew walks on_foot from the station itself. Never starts a simulation.
    on_site: bool = False


class DispatchRankResponse(BaseModel):
    schema_version: SchemaVersion
    incident_snapped: SnappedEndpoint
    candidates: Annotated[list[RankedCandidate], Field(min_length=1, max_length=3)]  # best first
    # Deprecated: on-site stations are candidates (ADR 0012).
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
