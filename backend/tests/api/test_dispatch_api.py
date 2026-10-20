from fastapi.testclient import TestClient

from greenwave.main import create_app
from tests.support.processed import Layout


def client(layout: Layout) -> TestClient:
    return TestClient(create_app(processed_dir=layout.processed, manifest_path=layout.manifest))


def test_geocode_returns_matches(layout: Layout) -> None:
    with client(layout) as c:
        response = c.get("/api/v1/geocode", params={"q": "poprzeczna 7"})

    assert response.status_code == 200
    body = response.json()
    assert body["schema_version"] == "1.0"
    assert [r["label"] for r in body["results"]] == ["Poprzeczna 7"]


def test_geocode_rejects_one_char_query(layout: Layout) -> None:
    with client(layout) as c:
        assert c.get("/api/v1/geocode", params={"q": "p"}).status_code == 422


def test_geocode_rejects_long_query(layout: Layout) -> None:
    with client(layout) as c:
        assert c.get("/api/v1/geocode", params={"q": "p" * 101}).status_code == 422


def test_geocode_limit_bounds(layout: Layout) -> None:
    with client(layout) as c:
        assert c.get("/api/v1/geocode", params={"q": "po", "limit": 11}).status_code == 422
        assert c.get("/api/v1/geocode", params={"q": "po", "limit": 0}).status_code == 422
        assert c.get("/api/v1/geocode", params={"q": "po", "limit": 10}).status_code == 200


def _poprzeczna(c: TestClient) -> dict[str, float]:
    position: dict[str, float] = c.get("/api/v1/geocode", params={"q": "poprzeczna 7"}).json()[
        "results"
    ][0]["position"]
    return position


def test_stations_lists_all_sorted(layout: Layout) -> None:
    with client(layout) as c:
        response = c.get("/api/v1/stations")

    assert response.status_code == 200
    body = response.json()
    assert body["schema_version"] == "1.0"
    stations = body["stations"]
    assert [s["station_id"] for s in stations] == ["STN-A-0001", "STN-F-0001"]
    assert stations[0] == {
        "station_id": "STN-A-0001",
        "vehicle_type": "AMBULANCE",
        "source_kind": "ambulance_base",
        "name": "Stacja Testowa",
        "position": stations[0]["position"],
    }


def test_rank_returns_candidates(layout: Layout) -> None:
    with client(layout) as c:
        incident = _poprzeczna(c)
        response = c.post(
            "/api/v1/dispatch/rank", json={"incident": incident, "vehicle_type": "FIRE_TRUCK"}
        )

    assert response.status_code == 200
    body = response.json()
    assert body["schema_version"] == "1.0"
    assert [c["station"]["station_id"] for c in body["candidates"]] == ["STN-F-0001"]
    assert body["candidates"][0]["greenwave_seconds"] > 0
    assert body["incident_snapped"]["snap_distance_m"] >= 0
    assert body["station_at_incident"] is None


def test_rank_off_network_is_422(layout: Layout) -> None:
    with client(layout) as c:
        response = c.post(
            "/api/v1/dispatch/rank",
            json={"incident": {"lat": 10.0, "lng": 10.0}, "vehicle_type": "AMBULANCE"},
        )

    assert response.status_code == 422
    assert response.json()["error_code"] == "DESTINATION_OFF_NETWORK"
    assert response.json()["schema_version"] == "1.0"


def test_rank_no_station_reachable_is_422(layout: Layout) -> None:
    with client(layout) as c:
        incident = _poprzeczna(c)
        response = c.post(
            "/api/v1/dispatch/rank", json={"incident": incident, "vehicle_type": "POLICE_CAR"}
        )

    assert response.status_code == 422
    assert response.json()["error_code"] == "NO_STATION_REACHABLE"


def test_rank_rejects_unknown_vehicle_type(layout: Layout) -> None:
    with client(layout) as c:
        response = c.post(
            "/api/v1/dispatch/rank",
            json={"incident": {"lat": 50.0, "lng": 19.9}, "vehicle_type": "TANK"},
        )

    assert response.status_code == 422
