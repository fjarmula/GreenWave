"""Pure simulation models and deterministic engine state."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from greenwave.simulation.engine import SimulationEngine
from greenwave.simulation.events import SimulationEvent
from greenwave.simulation.state import EngineState
from greenwave.simulation.state_machine import IntersectionRuntime, Transition, advance_intersection

__all__ = [
    "EngineState",
    "IntersectionRuntime",
    "SimulationEngine",
    "SimulationEvent",
    "Transition",
    "advance_intersection",
]


def __getattr__(name: str) -> type["SimulationEngine"]:
    # Controller phase helpers must be importable without eagerly importing their consumer.
    if name == "SimulationEngine":
        from greenwave.simulation.engine import SimulationEngine

        return SimulationEngine
    raise AttributeError(name)
