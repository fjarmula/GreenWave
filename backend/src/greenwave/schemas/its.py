"""Correlated simulated ITS decisions; dispatch is never a green confirmation."""

from enum import StrEnum
from typing import Annotated, Literal, Self

from pydantic import AwareDatetime, BaseModel, Field, model_validator

from greenwave.schemas.ids import MessageId, SimulationId


class ItsScenario(StrEnum):
    NOMINAL = "NOMINAL"
    DELAYED = "DELAYED"
    REJECTED = "REJECTED"
    NO_FEEDBACK = "NO_FEEDBACK"


class ItsRequestStatus(StrEnum):
    REQUESTED = "REQUESTED"
    ACCEPTED = "ACCEPTED"
    RELEASED = "RELEASED"
    REJECTED = "REJECTED"
    TIMED_OUT = "TIMED_OUT"
    EXPIRED = "EXPIRED"


class ItsFeedbackReason(StrEnum):
    CONTROLLER_REJECTED = "CONTROLLER_REJECTED"
    ACK_TIMEOUT = "ACK_TIMEOUT"
    HOLD_EXPIRED = "HOLD_EXPIRED"


_EXPECTED_REASON = {
    ItsRequestStatus.REJECTED: ItsFeedbackReason.CONTROLLER_REJECTED,
    ItsRequestStatus.TIMED_OUT: ItsFeedbackReason.ACK_TIMEOUT,
    ItsRequestStatus.EXPIRED: ItsFeedbackReason.HOLD_EXPIRED,
}
Seconds = Annotated[float, Field(ge=0, allow_inf_nan=False)]


class ItsRequestSnapshot(BaseModel):
    message_id: MessageId
    intersections_group: Annotated[list[str], Field(min_length=1)]
    status: ItsRequestStatus
    submitted_at_simulated_sec: Seconds
    acknowledged_at_simulated_sec: Seconds | None = None
    last_updated_at_simulated_sec: Seconds
    last_feedback_sequence: Annotated[int, Field(ge=0)] = 0
    reason: ItsFeedbackReason | None = None

    @model_validator(mode="after")
    def lifecycle(self) -> Self:
        if self.reason != _EXPECTED_REASON.get(self.status):
            raise ValueError("reason does not match request status")
        if self.last_updated_at_simulated_sec < self.submitted_at_simulated_sec:
            raise ValueError("update precedes submission")
        if self.status is ItsRequestStatus.REQUESTED:
            if self.last_feedback_sequence or self.acknowledged_at_simulated_sec is not None:
                raise ValueError("pending request cannot have feedback")
        elif self.last_feedback_sequence == 0:
            raise ValueError("updated request requires feedback sequence")
        if self.status is ItsRequestStatus.ACCEPTED and self.acknowledged_at_simulated_sec is None:
            raise ValueError("acceptance requires acknowledgement time")
        if self.acknowledged_at_simulated_sec is not None and not (
            self.submitted_at_simulated_sec
            <= self.acknowledged_at_simulated_sec
            <= self.last_updated_at_simulated_sec
        ):
            raise ValueError("acknowledgement outside request lifetime")
        return self


class ItsFeedbackEvent(BaseModel):
    schema_version: Literal["1.0"]
    is_simulated: Literal[True]
    event_type: Literal["ITS_FEEDBACK"]
    simulation_id: SimulationId
    tick: Annotated[int, Field(ge=0)]
    timestamp: AwareDatetime
    request_message_id: MessageId
    feedback_sequence: Annotated[int, Field(gt=0)]
    status: ItsRequestStatus
    intersections_group: Annotated[list[str], Field(min_length=1)]
    observed_at_simulated_sec: Seconds
    reason: ItsFeedbackReason | None = None

    @model_validator(mode="after")
    def lifecycle(self) -> Self:
        if self.status is ItsRequestStatus.REQUESTED or self.reason != _EXPECTED_REASON.get(
            self.status
        ):
            raise ValueError("invalid feedback status/reason")
        return self
