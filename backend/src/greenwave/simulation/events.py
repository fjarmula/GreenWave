"""Shared concrete event type for simulation producers and transport adapters."""

from greenwave.schemas import (
    ItsDispatchEvent,
    SimulationCancelledEvent,
    SimulationCompletedEvent,
    SimulationTickEvent,
)

SimulationEvent = (
    SimulationTickEvent | ItsDispatchEvent | SimulationCompletedEvent | SimulationCancelledEvent
)
