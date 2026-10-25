"""Typed in-process controller boundary, with no I/O or wall-clock decisions."""

from dataclasses import dataclass
from typing import Protocol

from greenwave.schemas import (
    ItsDispatchPayload,
    ItsFeedbackReason,
    ItsRequestStatus,
    SignalPhaseColor,
    SignalPhaseIndicator,
)
from greenwave.simulation.state import SignalHead
from greenwave.simulation.state_machine import IntersectionRuntime


@dataclass(frozen=True)
class ItsRequest:
    simulation_id: str
    message_id: str
    submitted_at_simulated_sec: float
    payload: ItsDispatchPayload
    cascade_flags: tuple[bool, ...]


@dataclass(frozen=True)
class ItsIntersectionObservation:
    intersection_id: str
    tti_seconds: float | None
    passed: bool


@dataclass(frozen=True)
class ItsObservation:
    simulated_sec: float
    intersections: tuple[ItsIntersectionObservation, ...]


@dataclass(frozen=True)
class ItsDecision:
    simulation_id: str
    request_message_id: str
    feedback_sequence: int
    status: ItsRequestStatus
    intersections_group: tuple[str, ...]
    observed_at_simulated_sec: float
    reason: ItsFeedbackReason | None = None


@dataclass(frozen=True)
class ItsControllerUpdate:
    feedback: tuple[ItsDecision, ...]
    intersection_runtimes: tuple[IntersectionRuntime, ...]
    signal_heads: tuple[SignalHead, ...]
    signal_phases: tuple[SignalPhaseIndicator, ...]
    observed_at_simulated_sec: float


class ItsController(Protocol):
    def submit(self, request: ItsRequest) -> None: ...
    def advance(self, observation: ItsObservation) -> ItsControllerUpdate: ...
    def ordinary_route_color_at(
        self, intersection_id: str, at_simulated_sec: float
    ) -> SignalPhaseColor | None: ...
    def ordinary_route_seconds_until_green(
        self, intersection_id: str, at_simulated_sec: float
    ) -> float | None: ...
    def close(self) -> None: ...
