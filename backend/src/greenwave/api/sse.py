"""Small, dependency-free Server-Sent Event framing helpers."""

from greenwave.simulation.events import SimulationEvent


def retry_frame() -> str:
    """Return the reconnection hint required by the streaming contract."""
    return "retry: 2000\n\n"


def event_frame(event: SimulationEvent) -> str:
    """Encode one contract event as an SSE frame."""
    return f"event: {event.event_type}\nid: {event.tick}\ndata: {event.model_dump_json()}\n\n"
