"""Small, dependency-free Server-Sent Event framing helpers."""

from greenwave.schemas import (
    ItsDispatchEvent,
    SimulationCancelledEvent,
    SimulationCompletedEvent,
    SimulationStreamEvent,
    SimulationTickEvent,
)

StreamEvent = (
    SimulationTickEvent | ItsDispatchEvent | SimulationCompletedEvent | SimulationCancelledEvent
)


def retry_frame() -> str:
    """Return the reconnection hint required by the streaming contract."""
    return "retry: 2000\n\n"


def event_frame(event: StreamEvent | SimulationStreamEvent) -> str:
    """Encode one contract event as an SSE frame."""
    model = event.root if isinstance(event, SimulationStreamEvent) else event
    return f"event: {model.event_type}\nid: {model.tick}\ndata: {model.model_dump_json()}\n\n"
