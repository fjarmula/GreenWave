"""Shared concrete event type for simulation producers and transport adapters."""

from typing import TypeGuard

from greenwave.schemas import (
    ItsDispatchEvent,
    ItsFeedbackEvent,
    SimulationCancelledEvent,
    SimulationCompletedEvent,
    SimulationTickEvent,
)

SimulationEvent = (
    SimulationTickEvent
    | ItsFeedbackEvent
    | ItsDispatchEvent
    | SimulationCompletedEvent
    | SimulationCancelledEvent
)
TerminalEvent = SimulationCancelledEvent | SimulationCompletedEvent


def is_terminal(event: SimulationEvent) -> TypeGuard[TerminalEvent]:
    """Whether ``event`` ends its stream."""
    return isinstance(event, (SimulationCancelledEvent, SimulationCompletedEvent))
