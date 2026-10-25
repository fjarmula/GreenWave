"""HTTP-level tests of the SSE stream route and the start route's 422 error mapping."""

import json
import time
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from greenwave.dataset import ProcessedDataset
from greenwave.main import create_app
from greenwave.schemas import ErrorResponse, SimulationStreamEvent
from greenwave.simulation.engine import SimulationEngine

ORIGIN = {"lat": 50.0, "lng": 19.9}
DESTINATION = {"lat": 50.0, "lng": 19.904}
OFF_NETWORK = {"lat": 50.5, "lng": 19.9}


def _request(
    simulation_id: str = "SIM-stream",
    origin: dict[str, float] = ORIGIN,
    destination: dict[str, float] = DESTINATION,
) -> dict[str, object]:
    return {
        "simulation_id": simulation_id,
        "origin": origin,
        "destination": destination,
        "traffic_density_multiplier": 1.0,
        "enable_cascade_mode": True,
        "playback_speed": 10,
    }


@pytest.fixture
def client(tiny_dataset: ProcessedDataset, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    # A fast tick keeps a full run on the tiny route well under a second.
    monkeypatch.setenv("GREENWAVE_SIM_TICK_INTERVAL_SECONDS", "0.01")
    with TestClient(create_app(dataset=tiny_dataset)) as test_client:
        yield test_client


def _frames(client: TestClient, simulation_id: str) -> tuple[str, list[dict[str, str]]]:
    """Read the whole stream; return the content type and the parsed frames in order."""
    with client.stream("GET", f"/api/v1/simulation/{simulation_id}/stream") as response:
        assert response.status_code == 200
        body = "".join(response.iter_text())
        content_type = response.headers["content-type"]
    frames = []
    for block in body.split("\n\n"):
        if not block:
            continue
        fields = dict(line.split(": ", 1) for line in block.split("\n"))
        frames.append(fields)
    return content_type, frames


def test_stream_sends_retry_then_ticks_and_closes_after_completion(client: TestClient) -> None:
    assert client.post("/api/v1/simulation/start", json=_request()).status_code == 200

    content_type, frames = _frames(client, "SIM-stream")

    assert content_type.startswith("text/event-stream")
    assert frames[0] == {"retry": "2000"}
    events = [SimulationStreamEvent.model_validate_json(frame["data"]).root for frame in frames[1:]]
    assert events, "the stream closed without any event"
    for frame, event in zip(frames[1:], events, strict=True):
        assert frame["event"] == event.event_type
        assert frame["id"] == str(event.tick)
        assert event.simulation_id == "SIM-stream"
    assert events[-1].event_type == "SIMULATION_COMPLETED"
    assert all(e.event_type != "SIMULATION_COMPLETED" for e in events[:-1])
    ticks = [e.tick for e in events if e.event_type == "SIMULATION_TICK"]
    assert ticks == sorted(ticks)


def test_stream_of_a_stopped_run_replays_snapshot_then_cancelled_terminal(
    client: TestClient,
) -> None:
    assert client.post("/api/v1/simulation/start", json=_request()).status_code == 200
    assert client.post("/api/v1/simulation/SIM-stream/stop").status_code == 200

    _, frames = _frames(client, "SIM-stream")

    assert frames[0] == {"retry": "2000"}
    assert len(frames) == 3
    snapshot = json.loads(frames[1]["data"])
    assert snapshot["event_type"] == "SIMULATION_TICK"
    terminal = json.loads(frames[2]["data"])
    assert snapshot["tick"] == terminal["tick"]
    assert terminal["event_type"] == "SIMULATION_CANCELLED"
    assert terminal["reason"] == "STOPPED"


def test_stream_of_a_crashed_run_ends_with_a_server_error_terminal(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    real_step = SimulationEngine.step
    calls = 0

    def step_then_crash(self: SimulationEngine, *args: Any) -> Any:
        nonlocal calls
        calls += 1
        if calls == 3:
            raise RuntimeError("engine bug")
        return real_step(self, *args)

    monkeypatch.setattr(SimulationEngine, "step", step_then_crash)
    assert client.post("/api/v1/simulation/start", json=_request()).status_code == 200
    # Without a terminal the stream never closes; fail instead of hanging the suite.
    session = client.app.state.session_manager._sessions["SIM-stream"]  # type: ignore[attr-defined]
    deadline = time.monotonic() + 2
    while session.terminal is None and time.monotonic() < deadline:
        time.sleep(0.01)
    assert session.terminal is not None, "the crashed run published no terminal"

    _, frames = _frames(client, "SIM-stream")

    assert frames[0] == {"retry": "2000"}
    assert len(frames) == 3
    assert frames[1]["event"] == "SIMULATION_TICK"
    assert frames[2]["event"] == "SIMULATION_CANCELLED"
    terminal = json.loads(frames[2]["data"])
    assert terminal["reason"] == "SERVER_ERROR"
    assert frames[1]["id"] == frames[2]["id"] == str(terminal["tick"])


def test_stream_of_an_unknown_run_is_a_json_404(client: TestClient) -> None:
    response = client.get("/api/v1/simulation/missing/stream")

    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")
    assert ErrorResponse.model_validate(response.json()).error_code == "SIMULATION_NOT_FOUND"


def test_stream_and_stop_reject_an_id_outside_the_contract_pattern(client: TestClient) -> None:
    assert client.get("/api/v1/simulation/bad%20id/stream").status_code == 422
    assert client.post("/api/v1/simulation/bad%20id/stop").status_code == 422


@pytest.mark.parametrize(
    ("origin", "destination", "code"),
    [
        (OFF_NETWORK, DESTINATION, "ORIGIN_OFF_NETWORK"),
        (ORIGIN, OFF_NETWORK, "DESTINATION_OFF_NETWORK"),
        (ORIGIN, ORIGIN, "NO_ROUTE"),
    ],
)
def test_routing_failures_map_to_422_error_responses(
    client: TestClient, origin: dict[str, float], destination: dict[str, float], code: str
) -> None:
    response = client.post(
        "/api/v1/simulation/start", json=_request(origin=origin, destination=destination)
    )

    assert response.status_code == 422
    assert ErrorResponse.model_validate(response.json()).error_code == code
    # A failed plan registers nothing to stream.
    assert client.get("/api/v1/simulation/SIM-stream/stream").status_code == 404
