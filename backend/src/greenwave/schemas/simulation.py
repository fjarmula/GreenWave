"""Simulation contract v1: start request/response, stream events, errors.

Canonical definition of the payloads in ``GreenWave_ARCHITECTURE.md`` section 4 and of
``docs/adr/0003-simulation-contract-v1.md``. Every response and stream event carries
``schema_version`` and ``is_simulated`` (the PoC never actuates real signals).
"""

from enum import StrEnum
from typing import Annotated, Literal, Self

from pydantic import AwareDatetime, BaseModel, Field, RootModel, model_validator

from greenwave.schemas.its import ItsFeedbackEvent, ItsRequestSnapshot, ItsScenario

SchemaVersion = Literal["1.0"]
SIMULATION_ID_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"
SimulationId = Annotated[str, Field(pattern=SIMULATION_ID_PATTERN)]

HOLD_DURATION_FLOOR_SEC = 40  # contract floor; the engine adds its TTI-based extension (ADR 0003)


class IntersectionState(StrEnum):
    """``CLEARING_CASCADE`` is not a state: a cascaded one is ``CLEARING`` + ``is_cascade``."""

    NORMAL = "NORMAL"
    CLEARING = "CLEARING"
    PRIORITY_GREEN = "PRIORITY_GREEN"
    RECOVERY = "RECOVERY"


class AmbulanceStatus(StrEnum):
    EN_ROUTE = "EN_ROUTE"
    APPROACHING_INTERSECTION = "APPROACHING_INTERSECTION"
    CROSSING_INTERSECTION = "CROSSING_INTERSECTION"
    ARRIVED = "ARRIVED"


class IntersectionKind(StrEnum):
    """The ETL's intersection kinds (``intersections.parquet``)."""

    SIGNALISED_JUNCTION = "signalised_junction"
    MIDBLOCK_SIGNAL = "midblock_signal"
    PEDESTRIAN_CROSSING = "pedestrian_crossing"


class VehicleType(StrEnum):
    """Chooses the candidate stations and the map icon, and is reported in the ITS payload.

    Lives here, not in ``schemas.dispatch``, because the start request and the ITS payload use it
    and ``schemas.dispatch`` imports from this module (ADR 0006).
    """

    AMBULANCE = "AMBULANCE"
    FIRE_TRUCK = "FIRE_TRUCK"
    POLICE_CAR = "POLICE_CAR"


class GreenWaveMode(StrEnum):
    """Whether the run pre-empts signals (``ENABLED``) or crosses them in standard traffic."""

    ENABLED = "ENABLED"
    DISABLED = "DISABLED"


class SignalPhaseColor(StrEnum):
    RED = "RED"
    YELLOW = "YELLOW"
    GREEN = "GREEN"


class SignalMovementKind(StrEnum):
    VEHICLE = "VEHICLE"
    PEDESTRIAN = "PEDESTRIAN"


class ErrorCode(StrEnum):
    ORIGIN_OFF_NETWORK = "ORIGIN_OFF_NETWORK"
    DESTINATION_OFF_NETWORK = "DESTINATION_OFF_NETWORK"
    NO_ROUTE = "NO_ROUTE"
    SIMULATION_ID_IN_USE = "SIMULATION_ID_IN_USE"
    SIMULATION_NOT_FOUND = "SIMULATION_NOT_FOUND"
    NO_STATION_REACHABLE = "NO_STATION_REACHABLE"


class CancelReason(StrEnum):
    ITS_REJECTED = "ITS_REJECTED"
    ITS_TIMEOUT = "ITS_TIMEOUT"
    ITS_HOLD_EXPIRED = "ITS_HOLD_EXPIRED"
    STOPPED = "STOPPED"
    SUPERSEDED = "SUPERSEDED"
    # Additive in contract v1 (D2): the simulation loop failed on the server.
    SERVER_ERROR = "SERVER_ERROR"


class Position(BaseModel):
    lat: Annotated[float, Field(ge=-90.0, le=90.0)]
    lng: Annotated[float, Field(ge=-180.0, le=180.0)]


class RouteGeometry(BaseModel):
    type: Literal["LineString"]
    coordinates: Annotated[list[tuple[float, float]], Field(min_length=2)]  # [lng, lat] pairs


class SimulationStartRequest(BaseModel):
    simulation_id: SimulationId
    origin: Position
    destination: Position
    traffic_density_multiplier: Annotated[float, Field(ge=1.0, le=3.0)]
    enable_cascade_mode: bool
    # Wall-clock tick stays 1 Hz; each tick advances this many simulated seconds (1 s sub-steps).
    playback_speed: Annotated[int, Field(ge=1, le=10)] = 1
    # Optional so clients from before dispatch (ADR 0006) still start ambulance runs.
    vehicle_type: VehicleType = VehicleType.AMBULANCE
    # Optional so clients from before the mode choice keep the existing priority behaviour.
    its_scenario: ItsScenario = ItsScenario.NOMINAL
    green_wave_mode: GreenWaveMode = GreenWaveMode.ENABLED


class SnappedEndpoint(BaseModel):
    position: Position
    snap_distance_m: Annotated[float, Field(ge=0.0)]


class OnFootLeg(BaseModel):
    """The walk from the vehicle's access point to an incident off the routable network."""

    access_point: Position
    distance_m: Annotated[float, Field(ge=0.0)]  # straight line x detour factor
    seconds: Annotated[float, Field(ge=0.0)]


class RouteIntersection(BaseModel):
    id: str
    name: str | None
    kind: IntersectionKind
    position: Position
    distance_along_route_m: Annotated[float, Field(ge=0.0)]  # to the first controlled stop line
    signal_count: Annotated[int, Field(ge=1)]
    approach_count: Annotated[int, Field(ge=1)]
    needs_review: bool
    cascade_targets: list[str]


class SimulationStartResponse(BaseModel):
    schema_version: SchemaVersion
    is_simulated: Literal[True]
    simulation_id: SimulationId
    status: Literal["INITIALIZED"]
    route_geometry: RouteGeometry
    total_distance_m: Annotated[float, Field(ge=0.0)]
    estimated_normal_time_sec: Annotated[int, Field(ge=0)]
    estimated_greenwave_time_sec: Annotated[int, Field(ge=0)]
    # The ambulance-without-priority run (ER Green Wave disabled), exact before rounding.
    estimated_standard_time_sec: Annotated[int, Field(ge=0)]
    intersections_on_route: list[str]
    route_intersections: list[RouteIntersection]  # route order; same ids as intersections_on_route
    origin_snapped: SnappedEndpoint
    destination_snapped: SnappedEndpoint
    its_scenario: ItsScenario = ItsScenario.NOMINAL
    green_wave_mode: GreenWaveMode = GreenWaveMode.ENABLED  # the mode this run uses
    # Set when the incident is off the network: the run ends at destination_snapped (the access
    # point) and the crew walks this leg; the estimates cover the drive only.
    destination_on_foot: OnFootLeg | None = None


class ComparisonStartRequest(BaseModel):
    """One scenario run twice at once, ER Green Wave enabled and disabled, in lockstep (ADR 0008).

    The fields are those of :class:`SimulationStartRequest` minus ``green_wave_mode``; each run
    keeps its own client-chosen id and is streamed and stopped like a single run.
    """

    enabled_simulation_id: SimulationId
    disabled_simulation_id: SimulationId
    origin: Position
    destination: Position
    traffic_density_multiplier: Annotated[float, Field(ge=1.0, le=3.0)]
    enable_cascade_mode: bool
    playback_speed: Annotated[int, Field(ge=1, le=10)] = 1
    vehicle_type: VehicleType = VehicleType.AMBULANCE
    its_scenario: ItsScenario = ItsScenario.NOMINAL

    @model_validator(mode="after")
    def distinct_ids(self) -> Self:
        if self.enabled_simulation_id == self.disabled_simulation_id:
            raise ValueError("enabled_simulation_id and disabled_simulation_id must differ")
        return self

    def member(self, mode: GreenWaveMode) -> SimulationStartRequest:
        """The single-run request of the pair member that uses ``mode``."""
        enabled = mode is GreenWaveMode.ENABLED
        return SimulationStartRequest(
            simulation_id=self.enabled_simulation_id if enabled else self.disabled_simulation_id,
            origin=self.origin,
            destination=self.destination,
            traffic_density_multiplier=self.traffic_density_multiplier,
            enable_cascade_mode=self.enable_cascade_mode,
            playback_speed=self.playback_speed,
            vehicle_type=self.vehicle_type,
            green_wave_mode=mode,
            its_scenario=self.its_scenario,
        )


class ComparisonStartResponse(BaseModel):
    schema_version: SchemaVersion
    is_simulated: Literal[True]
    enabled: SimulationStartResponse
    disabled: SimulationStartResponse


class AmbulanceTelemetry(BaseModel):
    id: str
    position: Position
    speed_kmh: Annotated[float, Field(ge=0.0)]
    status: AmbulanceStatus


class KpiMetrics(BaseModel):
    current_time_saved_sec: int
    total_time_elapsed_sec: Annotated[int, Field(ge=0)]  # simulated seconds


class IntersectionTelemetry(BaseModel):
    id: str
    name: str | None
    state: IntersectionState
    is_cascade: bool
    tti_seconds: int | None  # None once the intersection has been passed
    is_active_corridor: bool  # state in {CLEARING, PRIORITY_GREEN}; computed by the backend


class SignalPhaseIndicator(BaseModel):
    """One simulated signal indication at a known signal position; never a live signal state."""

    intersection_id: str
    signal_key: Annotated[str, Field(min_length=1)]  # stable within the intersection
    kind: SignalMovementKind
    color: SignalPhaseColor
    position: Position
    accessible_label: Annotated[str, Field(min_length=1)]


class SimulationTickEvent(BaseModel):
    schema_version: SchemaVersion
    is_simulated: Literal[True]
    event_type: Literal["SIMULATION_TICK"]
    simulation_id: SimulationId
    tick: Annotated[int, Field(ge=0)]
    timestamp: AwareDatetime
    ambulance: AmbulanceTelemetry
    kpi_metrics: KpiMetrics
    intersections: list[IntersectionTelemetry]  # every route intersection, in route order
    # Only intersections with known signal positions; additive, so it defaults to empty.
    its_requests: list[ItsRequestSnapshot] = []
    its_observed_at_simulated_sec: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    signal_phases: list[SignalPhaseIndicator] = []  # Pydantic copies the default per instance


class ItsDispatchPayload(BaseModel):
    priority_level: Literal[1]
    vehicle_type: VehicleType  # the start request's; widened from "AMBULANCE" by ADR 0006
    intersections_group: Annotated[list[str], Field(min_length=1)]
    action: Literal["FORCE_GREEN_PHASE"]
    # max(40, ceil(largest release time in group at dispatch) + its_hold_buffer_seconds): the
    # open road to the last stop line plus D_min per unpassed junction up to it (ADR 0010)
    hold_duration_sec: Annotated[int, Field(ge=HOLD_DURATION_FLOOR_SEC)]
    expected_arrival_utc: AwareDatetime  # emission time + smallest TTI in the group


class ItsDispatchEvent(BaseModel):
    schema_version: SchemaVersion
    is_simulated: Literal[True]
    event_type: Literal["ITS_DISPATCH"]
    message_id: Annotated[str, Field(pattern=r"^MSG-ITS-[0-9]+$")]
    simulation_id: SimulationId
    tick: Annotated[int, Field(ge=0)]
    timestamp: AwareDatetime
    system_source: Literal["ER_GREENWAVE_ENGINE"]
    target_system: Literal["STeR_KRAKOW_ITS"]
    payload: ItsDispatchPayload


class SimulationCompletedEvent(BaseModel):
    schema_version: SchemaVersion
    is_simulated: Literal[True]
    event_type: Literal["SIMULATION_COMPLETED"]
    simulation_id: SimulationId
    tick: Annotated[int, Field(ge=0)]
    timestamp: AwareDatetime
    kpi_metrics: KpiMetrics  # final


class SimulationCancelledEvent(BaseModel):
    schema_version: SchemaVersion
    is_simulated: Literal[True]
    event_type: Literal["SIMULATION_CANCELLED"]
    simulation_id: SimulationId
    tick: Annotated[int, Field(ge=0)]
    timestamp: AwareDatetime
    reason: CancelReason


class SimulationStreamEvent(
    RootModel[
        Annotated[
            SimulationTickEvent
            | ItsFeedbackEvent
            | ItsDispatchEvent
            | SimulationCompletedEvent
            | SimulationCancelledEvent,
            Field(discriminator="event_type"),
        ]
    ]
):
    """Any event on the SSE stream, discriminated on ``event_type``.

    A RootModel (not a bare alias) so the union is a named OpenAPI component and the frontend
    gets a named ``SimulationStreamEvent`` type.
    """


class ErrorResponse(BaseModel):
    schema_version: SchemaVersion
    error_code: ErrorCode
    message: str


class StopResponse(BaseModel):
    schema_version: SchemaVersion
    is_simulated: Literal[True]
    simulation_id: SimulationId
    status: Literal["STOPPED"]


__all__ = [
    "AmbulanceStatus",
    "AmbulanceTelemetry",
    "CancelReason",
    "ComparisonStartRequest",
    "ComparisonStartResponse",
    "ErrorCode",
    "ErrorResponse",
    "GreenWaveMode",
    "IntersectionKind",
    "IntersectionState",
    "IntersectionTelemetry",
    "ItsDispatchEvent",
    "ItsDispatchPayload",
    "KpiMetrics",
    "Position",
    "RouteGeometry",
    "RouteIntersection",
    "SignalMovementKind",
    "SignalPhaseColor",
    "SignalPhaseIndicator",
    "SimulationCancelledEvent",
    "SimulationCompletedEvent",
    "SimulationStartRequest",
    "SimulationStartResponse",
    "SimulationStreamEvent",
    "SimulationTickEvent",
    "SnappedEndpoint",
    "StopResponse",
    "VehicleType",
]
