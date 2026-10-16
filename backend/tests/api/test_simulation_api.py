from fastapi.testclient import TestClient

from greenwave.main import create_app
from greenwave.schemas import ErrorResponse
from tests.support.processed import Layout


def _request(simulation_id: str = "SIM-api") -> dict[str, object]:
    return {
        "simulation_id": simulation_id,
        "origin": {"lat": 50.0, "lng": 19.9},
        "destination": {"lat": 50.0, "lng": 19.904},
        "traffic_density_multiplier": 1.0,
        "enable_cascade_mode": True,
        "playback_speed": 1,
    }


def test_start_returns_frozen_response_shape_and_stop_returns_terminal(layout: Layout) -> None:
    with TestClient(
        create_app(processed_dir=layout.processed, manifest_path=layout.manifest)
    ) as client:
        start = client.post("/api/v1/simulation/start", json=_request())
        assert start.status_code == 200
        body = start.json()
        assert body["status"] == "INITIALIZED"
        assert body["simulation_id"] == "SIM-api"
        assert body["route_geometry"]["type"] == "LineString"

        stop = client.post("/api/v1/simulation/SIM-api/stop")
        assert stop.status_code == 200
        assert stop.json()["status"] == "STOPPED"


def test_cors_allows_configured_origin_but_not_an_unlisted_one(layout: Layout, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("GREENWAVE_CORS_ORIGINS", "http://dashboard.test")
    with TestClient(
        create_app(processed_dir=layout.processed, manifest_path=layout.manifest)
    ) as client:
        allowed = client.options(
            "/api/v1/simulation/start",
            headers={"Origin": "http://dashboard.test", "Access-Control-Request-Method": "POST"},
        )
        blocked = client.options(
            "/api/v1/simulation/start",
            headers={"Origin": "http://other.test", "Access-Control-Request-Method": "POST"},
        )
    assert allowed.headers["access-control-allow-origin"] == "http://dashboard.test"
    assert "access-control-allow-origin" not in blocked.headers


def test_conflict_and_unknown_session_errors_use_error_response(layout: Layout) -> None:
    with TestClient(
        create_app(processed_dir=layout.processed, manifest_path=layout.manifest)
    ) as client:
        assert client.post("/api/v1/simulation/start", json=_request()).status_code == 200
        conflict = client.post("/api/v1/simulation/start", json=_request())
        unknown = client.post("/api/v1/simulation/missing/stop")

    assert conflict.status_code == 409
    assert ErrorResponse.model_validate(conflict.json()).error_code == "SIMULATION_ID_IN_USE"
    assert unknown.status_code == 404
    assert ErrorResponse.model_validate(unknown.json()).error_code == "SIMULATION_NOT_FOUND"
