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
        assert body["green_wave_mode"] == "ENABLED"  # legacy request without a mode

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


def _comparison(**patch: object) -> dict[str, object]:
    body = {key: value for key, value in _request().items() if key != "simulation_id"}
    return {"enabled_simulation_id": "SIM-on", "disabled_simulation_id": "SIM-off", **body, **patch}


def test_compare_start_returns_both_routes(layout: Layout) -> None:
    with TestClient(
        create_app(processed_dir=layout.processed, manifest_path=layout.manifest)
    ) as client:
        response = client.post("/api/v1/simulation/compare/start", json=_comparison())
        assert response.status_code == 200
        body = response.json()
        assert body["is_simulated"] is True
        assert body["enabled"]["simulation_id"] == "SIM-on"
        assert body["enabled"]["green_wave_mode"] == "ENABLED"
        assert body["disabled"]["simulation_id"] == "SIM-off"
        assert body["disabled"]["green_wave_mode"] == "DISABLED"
        assert body["enabled"]["total_distance_m"] == body["disabled"]["total_distance_m"]
        # Stopping either member stops both; each stream then replays its own terminal.
        assert client.post("/api/v1/simulation/SIM-off/stop").status_code == 200
        for simulation_id in ("SIM-on", "SIM-off"):
            stream = client.get(f"/api/v1/simulation/{simulation_id}/stream")
            assert stream.status_code == 200
            assert '"reason":"STOPPED"' in stream.text
            assert f'"simulation_id":"{simulation_id}"' in stream.text


def test_compare_start_maps_planning_errors(layout: Layout) -> None:
    with TestClient(
        create_app(processed_dir=layout.processed, manifest_path=layout.manifest)
    ) as client:
        response = client.post(
            "/api/v1/simulation/compare/start", json=_comparison(origin={"lat": 50.5, "lng": 19.9})
        )
        assert response.status_code == 422
        assert ErrorResponse.model_validate(response.json()).error_code == "ORIGIN_OFF_NETWORK"
        assert client.get("/api/v1/simulation/SIM-on/stream").status_code == 404


def test_compare_start_rejects_an_active_id(layout: Layout) -> None:
    with TestClient(
        create_app(processed_dir=layout.processed, manifest_path=layout.manifest)
    ) as client:
        assert client.post("/api/v1/simulation/start", json=_request("SIM-on")).status_code == 200
        conflict = client.post("/api/v1/simulation/compare/start", json=_comparison())
        duplicate = client.post(
            "/api/v1/simulation/compare/start", json=_comparison(disabled_simulation_id="SIM-on")
        )
    assert conflict.status_code == 409
    assert ErrorResponse.model_validate(conflict.json()).error_code == "SIMULATION_ID_IN_USE"
    assert duplicate.status_code == 422
