"""Simulation contract v1: start request/response, stream events, errors.

Canonical definition of the payloads in ``GreenWave_ARCHITECTURE.md`` section 4 and of
``docs/adr/0003-simulation-contract-v1.md``. Every response and stream event carries
``schema_version`` and ``is_simulated`` (the PoC never actuates real signals).
"""

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, Field, RootModel

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


class ErrorCode(StrEnum):
    ORIGIN_OFF_NETWORK = "ORIGIN_OFF_NETWORK"
    DESTINATION_OFF_NETWORK = "DESTINATION_OFF_NETWORK"
    NO_ROUTE = "NO_ROUTE"
    SIMULATION_ID_IN_USE = "SIMULATION_ID_IN_USE"
    SIMULATION_NOT_FOUND = "SIMULATION_NOT_FOUND"


class CancelReason(StrEnum):
    STOPPED = "STOPPED"
    SUPERSEDED = "SUPERSEDED"


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


class SnappedEndpoint(BaseModel):
    position: Position
    snap_distance_m: Annotated[float, Field(ge=0.0)]


class RouteIntersection(BaseModel):
    id: str
    name: str | None
    kind: IntersectionKind
    position: Position
    distance_along_route_m: Annotated[float, Field(ge=0.0)]  # to the first controlled stop line


class SimulationStartResponse(BaseModel):
    schema_version: SchemaVersion
    is_simulated: Literal[True]
    simulation_id: SimulationId
    status: Literal["INITIALIZED"]
    route_geometry: RouteGeometry
    total_distance_m: Annotated[float, Field(ge=0.0)]
    estimated_normal_time_sec: Annotated[int, Field(ge=0)]
    estimated_greenwave_time_sec: Annotated[int, Field(ge=0)]
    intersections_on_route: list[str]
    route_intersections: list[RouteIntersection]  # route order; same ids as intersections_on_route
    origin_snapped: SnappedEndpoint
    destination_snapped: SnappedEndpoint


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


class ItsDispatchPayload(BaseModel):
    priority_level: Literal[1]
    vehicle_type: Literal["AMBULANCE"]
    intersections_group: Annotated[list[str], Field(min_length=1)]
    action: Literal["FORCE_GREEN_PHASE"]
    # max(40, ceil(largest TTI in group at dispatch) + its_hold_buffer_seconds)
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
    "ErrorCode",
    "ErrorResponse",
    "IntersectionKind",
    "IntersectionState",
    "IntersectionTelemetry",
    "ItsDispatchEvent",
    "ItsDispatchPayload",
    "KpiMetrics",
    "Position",
    "RouteGeometry",
    "RouteIntersection",
    "SimulationCancelledEvent",
    "SimulationCompletedEvent",
    "SimulationStartRequest",
    "SimulationStartResponse",
    "SimulationStreamEvent",
    "SimulationTickEvent",
    "SnappedEndpoint",
    "StopResponse",
]
