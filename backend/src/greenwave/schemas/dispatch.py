"""Incident dispatch contract: stations, local geocoding and station ranking (ADR 0006).

Geocode results carry their address provenance, EMUiA vs OSM (ADR 0013). Ambulance ranking
ranks eligible PRM teams by scenario time, simulated availability and the area rule (ADR 0014):
additive in shape, but ``candidates`` may be empty (``NO_ELIGIBLE_RESOURCE``).

Additive to contract v1; ``schema_version`` stays ``"1.0"``.
"""

from datetime import date, datetime
from enum import StrEnum
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, StringConstraints, field_validator

from greenwave.schemas.simulation import (
    GreenWaveMode,
    OnFootLeg,
    Position,
    SchemaVersion,
    SnappedEndpoint,
    VehicleType,
)

STATION_ID_PATTERN = r"^STN-[AFP]-\d{4}$"
TEAM_CODE_PATTERN = r"^K\d{2} \d{3}( M)?$"
# Scenario times are Kraków wall-clock times (the PRM schedule is local).
LOCAL_ZONE = ZoneInfo("Europe/Warsaw")
MAX_AVAILABILITY_OVERRIDES = 200

TeamCode = Annotated[str, StringConstraints(pattern=TEAM_CODE_PATTERN)]
Teryt = Annotated[str, StringConstraints(pattern=r"^\d{7}$")]
MonthDay = Annotated[str, StringConstraints(pattern=r"^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$")]
# Simulated availability set by the dispatcher in the scenario; never a live status.
AvailabilityOverride = Literal["free", "busy"]
ExclusionReason = Literal["OFF_SHIFT", "BUSY_OVERRIDE"]
SelectionReason = Literal["NEAREST", "IN_AREA_WITHIN_MARGIN", "NEAREST_OUTSIDE_MARGIN"]
DispatchOutcome = Literal["OK", "NO_ELIGIBLE_RESOURCE"]


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


def local_naive(value: datetime) -> datetime:
    """A scenario time as naive Kraków wall-clock time (an aware value is converted first)."""
    if value.tzinfo is not None:
        value = value.astimezone(LOCAL_ZONE).replace(tzinfo=None)
    return value


class RosterInfo(BaseModel):
    """The official roster the teams come from (Małopolska PRM plan, Tables 1a and 2a)."""

    source: str
    plan_update: str
    effective_from: date
    teams_in_scope: Annotated[int, Field(ge=0)]


class IncidentArea(BaseModel):
    """The incident's PRM operating area: the Kraków delegatura of its district (EMUiA)."""

    teryt: Teryt  # the delegatura code teams' areas list, e.g. "1261049"
    delegatura_name: str  # Śródmieście, Krowodrza, Podgórze or Nowa Huta
    district_number: Annotated[int, Field(ge=1, le=18)]
    district_name: str  # e.g. "Podgórze Duchackie"


class TeamAssignment(BaseModel):
    """The PRM team a candidate base sends (AMBULANCE only)."""

    team_code: TeamCode
    team_type: str  # P1, P2, P3, S or M; shown only, never ranked
    area_teryt: list[Teryt]
    in_area: bool | None  # None: the incident's area is unknown
    # assumed_free: on shift with no override, so the scenario assumes it is free (badged).
    availability: Literal["free", "assumed_free"]
    other_eligible_team_codes: list[TeamCode]


class ExcludedTeam(BaseModel):
    team_code: TeamCode
    station_id: Annotated[str, Field(pattern=STATION_ID_PATTERN)]
    reason: ExclusionReason


class AreaRuleOutcome(BaseModel):
    """Why the first candidate was chosen (D4), with the teams compared."""

    reason: SelectionReason
    chosen_team_code: TeamCode
    nearest_team_code: TeamCode
    in_area_team_code: TeamCode | None
    delta_seconds: float | None  # in-area total minus the nearest total, in the request's mode


class Team(BaseModel):
    """A PRM team in scope and whether its published schedule has it on shift at ``at``."""

    team_code: TeamCode
    team_type: str
    station_id: Annotated[str, Field(pattern=STATION_ID_PATTERN)]
    base_address: str
    area_teryt: list[Teryt]
    weekdays: Annotated[str, StringConstraints(pattern=r"^[1-7]{1,7}$")]  # Monday = 1
    ready_from_min: Annotated[int, Field(ge=0, le=1439)]  # on shift in [from, to)
    ready_to_min: Annotated[int, Field(ge=1, le=1440)]
    season_from: MonthDay
    season_to: MonthDay
    on_shift: bool


class ResourcesResponse(BaseModel):
    schema_version: SchemaVersion
    roster: RosterInfo
    at: datetime  # naive local time the on_shift flags are for
    teams: list[Team]  # sorted by team_code


class DispatchRankRequest(BaseModel):
    incident: Position
    vehicle_type: VehicleType
    # Density the standard estimate is computed for; the run's own multiplier (1.0-3.0).
    traffic_density_multiplier: Annotated[float, Field(ge=1.0, le=3.0)] = 1.0
    # Naive Kraków local time of the scenario; None means the server's local now (echoed back).
    scenario_time: datetime | None = None
    # Which estimate the area rule compares: the green-wave (ENABLED) or the standard one.
    time_mode: GreenWaveMode = GreenWaveMode.ENABLED
    # Simulated per-team status by team code; a team left out is "unknown" (assumed free).
    availability: Annotated[
        dict[TeamCode, AvailabilityOverride], Field(max_length=MAX_AVAILABILITY_OVERRIDES)
    ] = {}

    @field_validator("scenario_time")
    @classmethod
    def _local_scenario_time(cls, value: datetime | None) -> datetime | None:
        return None if value is None else local_naive(value)


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
    team: TeamAssignment | None = None  # AMBULANCE only (ADR 0014)
    selection_reason: SelectionReason | None = None  # the first AMBULANCE candidate only


class DispatchRankResponse(BaseModel):
    schema_version: SchemaVersion
    incident_snapped: SnappedEndpoint
    # Best first; for AMBULANCE the first is the recommended team (area rule), not necessarily
    # the fastest. Empty exactly when outcome is NO_ELIGIBLE_RESOURCE.
    candidates: Annotated[list[RankedCandidate], Field(max_length=3)]
    # Deprecated: on-site stations are candidates (ADR 0012).
    station_at_incident: Station | None
    scenario_time: datetime  # naive local time the ranking is for
    outcome: DispatchOutcome
    incident_area: IncidentArea | None  # AMBULANCE only; None also when unknown
    excluded_teams: list[ExcludedTeam]  # AMBULANCE only: off shift or marked busy
    roster: RosterInfo | None  # AMBULANCE only
    area_rule: AreaRuleOutcome | None  # AMBULANCE with candidates only


__all__ = [
    "AreaRuleOutcome",
    "DispatchRankRequest",
    "DispatchRankResponse",
    "ExcludedTeam",
    "GeocodeResponse",
    "GeocodeResult",
    "IncidentArea",
    "RankedCandidate",
    "ResourcesResponse",
    "RosterInfo",
    "Station",
    "StationSourceKind",
    "StationsResponse",
    "Team",
    "TeamAssignment",
]
