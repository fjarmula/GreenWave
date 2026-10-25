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
    assert body["candidates"][0]["standard_seconds"] > 0
    assert body["incident_snapped"]["snap_distance_m"] >= 0
    assert body["station_at_incident"] is None


def test_rank_at_a_station_returns_it_on_site(layout: Layout) -> None:
    with client(layout) as c:
        station = next(
            s
            for s in c.get("/api/v1/stations").json()["stations"]
            if s["vehicle_type"] == "FIRE_TRUCK"
        )
        response = c.post(
            "/api/v1/dispatch/rank",
            json={"incident": station["position"], "vehicle_type": "FIRE_TRUCK"},
        )

    assert response.status_code == 200
    body = response.json()
    first = body["candidates"][0]
    assert first["on_site"] is True
    assert first["station"]["station_id"] == station["station_id"]
    assert first["on_foot"]["access_point"] == station["position"]
    assert first["on_foot"]["distance_m"] == 0
    assert first["greenwave_seconds"] == first["standard_seconds"] == first["distance_m"] == 0
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
    assert (
        response.json()["message"]
        == "Incident is farther than 800 m on foot from any vehicle access point"
    )


# North of Poprzeczna 7: beyond the 150 m snap limit, about 222 m from the nearest node.
OFF_ROAD = {"lat": 50.004, "lng": 19.902}


def _assert_off_road(layout: Layout) -> None:
    """Precondition: OFF_ROAD does not snap but has access nodes in the tiny dataset."""
    import numpy as np

    from greenwave.dataset.loader import load_dataset
    from greenwave.etl.geo import project_points
    from greenwave.routing.access import access_nodes
    from greenwave.routing.network_index import build_routing_index
    from greenwave.schemas import Position
    from greenwave.simulation_settings import SimulationSettings

    settings = SimulationSettings()
    index = build_routing_index(load_dataset(layout.processed, layout.manifest), settings)
    x, y = project_points(np.array([OFF_ROAD["lng"]]), np.array([OFF_ROAD["lat"]]))[0]
    assert index.snap(float(x), float(y)) is None
    assert access_nodes(index, Position(**OFF_ROAD), settings)


def test_rank_off_road_incident_returns_on_foot_leg(layout: Layout) -> None:
    _assert_off_road(layout)
    with client(layout) as c:
        response = c.post(
            "/api/v1/dispatch/rank", json={"incident": OFF_ROAD, "vehicle_type": "AMBULANCE"}
        )

    assert response.status_code == 200
    body = response.json()
    leg = body["candidates"][0]["on_foot"]
    assert leg["distance_m"] > 0
    assert leg["seconds"] > 0
    assert body["incident_snapped"]["snap_distance_m"] > 150
    assert body["incident_snapped"]["position"] == leg["access_point"]


def test_rank_on_road_candidates_have_no_on_foot_leg(layout: Layout) -> None:
    with client(layout) as c:
        incident = _poprzeczna(c)
        body = c.post(
            "/api/v1/dispatch/rank", json={"incident": incident, "vehicle_type": "AMBULANCE"}
        ).json()

    assert all(candidate["on_foot"] is None for candidate in body["candidates"])


def test_rank_no_station_reachable_is_422(layout: Layout) -> None:
    with client(layout) as c:
        incident = _poprzeczna(c)
        response = c.post(
            "/api/v1/dispatch/rank", json={"incident": incident, "vehicle_type": "POLICE_CAR"}
        )

    assert response.status_code == 422
    assert response.json()["error_code"] == "NO_STATION_REACHABLE"


def test_rank_rejects_a_density_above_the_range(layout: Layout) -> None:
    with client(layout) as c:
        response = c.post(
            "/api/v1/dispatch/rank",
            json={
                "incident": _poprzeczna(c),
                "vehicle_type": "FIRE_TRUCK",
                "traffic_density_multiplier": 3.5,
            },
        )

    assert response.status_code == 422


def test_rank_density_raises_the_standard_time_only(layout: Layout) -> None:
    with client(layout) as c:
        incident = _poprzeczna(c)
        light, heavy = (
            c.post(
                "/api/v1/dispatch/rank",
                json={
                    "incident": incident,
                    "vehicle_type": "FIRE_TRUCK",
                    "traffic_density_multiplier": density,
                },
            ).json()["candidates"][0]
            for density in (1.0, 3.0)
        )

    assert heavy["greenwave_seconds"] == light["greenwave_seconds"]
    assert heavy["standard_seconds"] >= light["standard_seconds"]


def test_rank_rejects_unknown_vehicle_type(layout: Layout) -> None:
    with client(layout) as c:
        response = c.post(
            "/api/v1/dispatch/rank",
            json={"incident": {"lat": 50.0, "lng": 19.9}, "vehicle_type": "TANK"},
        )

    assert response.status_code == 422
