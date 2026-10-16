"""Pydantic models: the canonical definition of every REST and telemetry payload.

Frontend types in ``frontend/src/types/`` are generated from these models
(see ``scripts/export_openapi.py``); never edit the generated file by hand.
"""

from greenwave.schemas.health import HealthResponse
from greenwave.schemas.simulation import (
    AmbulanceStatus,
    AmbulanceTelemetry,
    CancelReason,
    ErrorCode,
    ErrorResponse,
    IntersectionKind,
    IntersectionState,
    IntersectionTelemetry,
    ItsDispatchEvent,
    ItsDispatchPayload,
    KpiMetrics,
    Position,
    RouteGeometry,
    RouteIntersection,
    SimulationCancelledEvent,
    SimulationCompletedEvent,
    SimulationStartRequest,
    SimulationStartResponse,
    SimulationStreamEvent,
    SimulationTickEvent,
    SnappedEndpoint,
    StopResponse,
)

__all__ = [
    "AmbulanceStatus",
    "AmbulanceTelemetry",
    "CancelReason",
    "ErrorCode",
    "ErrorResponse",
    "HealthResponse",
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
