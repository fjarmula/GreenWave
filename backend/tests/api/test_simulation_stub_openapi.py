from fastapi.testclient import TestClient

from greenwave.main import create_app
from tests.support.processed import Layout

PATHS = {
    "/api/v1/simulation/start": "post",
    "/api/v1/simulation/compare/start": "post",
    "/api/v1/simulation/{simulation_id}/stream": "get",
    "/api/v1/simulation/{simulation_id}/stop": "post",
}

MODELS = {
    "Position",
    "RouteGeometry",
    "SimulationStartRequest",
    "SnappedEndpoint",
    "RouteIntersection",
    "SimulationStartResponse",
    "ComparisonStartRequest",
    "ComparisonStartResponse",
    "IntersectionState",
    "AmbulanceStatus",
    "AmbulanceTelemetry",
    "KpiMetrics",
    "IntersectionTelemetry",
    "SimulationTickEvent",
    "SimulationStreamEvent",
    "ItsDispatchPayload",
    "ItsDispatchEvent",
    "SimulationCompletedEvent",
    "SimulationCancelledEvent",
    "ErrorResponse",
    "StopResponse",
}


def client(layout: Layout) -> TestClient:
    return TestClient(create_app(processed_dir=layout.processed, manifest_path=layout.manifest))


def test_openapi_contains_the_three_paths_and_every_model(layout: Layout) -> None:
    with client(layout) as c:
        doc = c.get("/openapi.json").json()
    for path, method in PATHS.items():
        assert method in doc["paths"][path]
    assert set(doc["components"]["schemas"]) >= MODELS


def test_stream_route_registers_the_event_union_under_event_stream(layout: Layout) -> None:
    with client(layout) as c:
        doc = c.get("/openapi.json").json()
    ok = doc["paths"]["/api/v1/simulation/{simulation_id}/stream"]["get"]["responses"]["200"]
    assert ok["content"]["text/event-stream"]["schema"] == {
        "$ref": "#/components/schemas/SimulationStreamEvent"
    }
    schema = doc["components"]["schemas"]["SimulationStreamEvent"]
    assert schema["discriminator"]["propertyName"] == "event_type"
    refs = {o["$ref"].rsplit("/", 1)[1] for o in schema["oneOf"]}
    assert refs == {
        "SimulationTickEvent",
        "ItsDispatchEvent",
        "SimulationCompletedEvent",
        "SimulationCancelledEvent",
    }


def test_error_responses_are_documented(layout: Layout) -> None:
    with client(layout) as c:
        doc = c.get("/openapi.json").json()
    start = doc["paths"]["/api/v1/simulation/start"]["post"]["responses"]
    assert {"200", "409", "422"} <= set(start)
    assert start["409"]["content"]["application/json"]["schema"]["$ref"].endswith("/ErrorResponse")
    stop = doc["paths"]["/api/v1/simulation/{simulation_id}/stop"]["post"]["responses"]
    assert "404" in stop
    stream = doc["paths"]["/api/v1/simulation/{simulation_id}/stream"]["get"]["responses"]
    assert stream["404"]["content"]["application/json"]["schema"]["$ref"].endswith("/ErrorResponse")


def test_invalid_start_is_a_contract_error_not_a_stub(layout: Layout) -> None:
    body = {
        "simulation_id": "SIM-1",
        "origin": {"lat": 50.06, "lng": 19.95},
        "destination": {"lat": 50.01, "lng": 19.99},
        "traffic_density_multiplier": 1.5,
        "enable_cascade_mode": True,
    }
    with client(layout) as c:
        assert c.post("/api/v1/simulation/start", json=body).status_code == 422
        assert c.get("/api/v1/simulation/SIM-1/stream").status_code == 404
        assert c.post("/api/v1/simulation/SIM-1/stop").status_code == 404
