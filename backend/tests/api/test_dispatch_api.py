from datetime import datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from greenwave.api import dispatch as dispatch_api
from greenwave.main import create_app
from greenwave.routing.errors import NoStationReachable
from greenwave.schemas import GreenWaveMode
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


def test_geocode_returns_provenance(layout: Layout) -> None:
    with client(layout) as c:
        response = c.get("/api/v1/geocode", params={"q": "poprzeczna"})

    results = {r["label"]: r for r in response.json()["results"]}
    assert results["Poprzeczna 7"]["provenance"] == "matched"
    assert results["Poprzeczna 7"]["osm_delta_m"] < 100
    assert results["Poprzeczna 5"]["provenance"] == "municipal"
    assert results["Poprzeczna 3"]["provenance"] == "osm"


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
    assert [s["station_id"] for s in stations] == ["STN-A-0001", "STN-A-0002", "STN-F-0001"]
    assert stations[1] == {
        "station_id": "STN-A-0002",
        "vehicle_type": "AMBULANCE",
        "source_kind": "prm_base",
        "name": "ul. Testowa 1, 30-001 Kraków",
        "position": {"lat": 49.9992, "lng": 19.903},
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
    assert "station_at_incident" not in body


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
    assert "station_at_incident" not in body


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


NOON = "2026-10-27T12:00:00"
EVENING = "2026-10-27T21:00:00"


def _rank_ambulance(c: TestClient, **extra: object) -> dict[str, Any]:
    response = c.post(
        "/api/v1/dispatch/rank",
        json={"incident": _poprzeczna(c), "vehicle_type": "AMBULANCE", **extra},
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def test_resources_lists_teams_with_roster(layout: Layout) -> None:
    with client(layout) as c:
        response = c.get("/api/v1/resources", params={"at": NOON})

    assert response.status_code == 200
    body = response.json()
    assert body["schema_version"] == "1.0"
    assert body["roster"]["plan_update"] == "2"
    assert body["roster"]["effective_from"] == "2026-09-01"
    assert body["roster"]["teams_in_scope"] == 3
    assert body["at"] == NOON
    assert [t["team_code"] for t in body["teams"]] == ["K01 008", "K01 162", "K01 176"]
    assert all(t["on_shift"] for t in body["teams"])


def test_resources_on_shift_at_given_time(layout: Layout) -> None:
    with client(layout) as c:
        body = c.get("/api/v1/resources", params={"at": "2026-10-27T21:00"}).json()

    on_shift = {t["team_code"]: t["on_shift"] for t in body["teams"]}
    assert on_shift == {"K01 008": True, "K01 162": True, "K01 176": False}


def test_resources_defaults_to_server_now(layout: Layout) -> None:
    with client(layout) as c:
        body = c.get("/api/v1/resources").json()

    assert datetime.fromisoformat(body["at"]).tzinfo is None


def test_rank_ambulance_returns_team_and_reason(layout: Layout) -> None:
    with client(layout) as c:
        body = _rank_ambulance(c, scenario_time=NOON)

    assert body["outcome"] == "OK"
    assert body["roster"]["teams_in_scope"] == 3
    assert body["incident_area"] == {
        "teryt": "1261059",
        "delegatura_name": "Śródmieście",
        "district_number": 1,
        "district_name": "Stare Miasto",
    }
    first = body["candidates"][0]
    assert first["selection_reason"] in {
        "NEAREST",
        "IN_AREA_WITHIN_MARGIN",
        "NEAREST_OUTSIDE_MARGIN",
    }
    assert first["team"]["team_code"] == body["area_rule"]["chosen_team_code"]
    assert body["area_rule"]["margin_seconds"] == 60
    assert first["team"]["availability"] == "assumed_free"
    assert all(c["selection_reason"] is None for c in body["candidates"][1:])
    assert body["excluded_teams"] == []
    # Two bases: K01 162 and K01 176 share one, so one candidate per base.
    assert len(body["candidates"]) == 2


def test_rank_echoes_scenario_time(layout: Layout) -> None:
    with client(layout) as c:
        assert _rank_ambulance(c, scenario_time="2026-10-27T21:00")["scenario_time"] == EVENING
        echoed = _rank_ambulance(c)["scenario_time"]

    assert datetime.fromisoformat(echoed).tzinfo is None


def test_off_shift_team_is_excluded(layout: Layout) -> None:
    with client(layout) as c:
        body = _rank_ambulance(c, scenario_time=EVENING)

    assert body["excluded_teams"] == [
        {"team_code": "K01 176", "station_id": "STN-A-0002", "reason": "OFF_SHIFT"}
    ]


def test_busy_override_moves_choice(layout: Layout) -> None:
    with client(layout) as c:
        chosen = _rank_ambulance(c, scenario_time=NOON)["area_rule"]["chosen_team_code"]
        body = _rank_ambulance(c, scenario_time=NOON, availability={chosen: "busy"})

    assert body["area_rule"]["chosen_team_code"] != chosen
    assert {"team_code": chosen, "reason": "BUSY_OVERRIDE"}.items() <= next(
        t for t in body["excluded_teams"] if t["team_code"] == chosen
    ).items()


def test_free_override_is_not_assumed(layout: Layout) -> None:
    with client(layout) as c:
        chosen = _rank_ambulance(c, scenario_time=NOON)["area_rule"]["chosen_team_code"]
        body = _rank_ambulance(c, scenario_time=NOON, availability={chosen: "free"})

    assert body["candidates"][0]["team"]["availability"] == "free"


def test_all_busy_returns_no_eligible_outcome(layout: Layout) -> None:
    busy = {code: "busy" for code in ("K01 008", "K01 162", "K01 176")}
    with client(layout) as c:
        body = _rank_ambulance(c, scenario_time=NOON, availability=busy)

    assert body["outcome"] == "NO_ELIGIBLE_RESOURCE"
    assert body["candidates"] == []
    assert body["area_rule"] is None
    assert sorted(t["team_code"] for t in body["excluded_teams"]) == sorted(busy)
    assert {t["reason"] for t in body["excluded_teams"]} == {"BUSY_OVERRIDE"}
    assert body["incident_snapped"]["snap_distance_m"] >= 0


def test_rank_without_resource_awareness_ignores_shifts_and_status(layout: Layout) -> None:
    busy = {code: "busy" for code in ("K01 008", "K01 162", "K01 176")}
    with client(layout) as c:
        body = _rank_ambulance(c, scenario_time=EVENING, availability=busy, resource_aware=False)

    assert body["outcome"] == "OK"
    assert len(body["candidates"]) == 2  # both bases, the off-shift one included
    assert all(c["team"] is None and c["selection_reason"] is None for c in body["candidates"])
    assert (body["area_rule"], body["roster"], body["incident_area"]) == (None, None, None)
    assert body["excluded_teams"] == []
    totals = [c["greenwave_seconds"] for c in body["candidates"]]
    assert totals == sorted(totals)


def test_fire_rank_unchanged(layout: Layout) -> None:
    with client(layout) as c:
        incident = _poprzeczna(c)
        body = c.post(
            "/api/v1/dispatch/rank",
            json={"incident": incident, "vehicle_type": "FIRE_TRUCK", "scenario_time": NOON},
        ).json()

    assert body["outcome"] == "OK"
    assert body["scenario_time"] == NOON
    assert (body["area_rule"], body["roster"], body["incident_area"]) == (None, None, None)
    assert body["excluded_teams"] == []
    assert all(c["team"] is None and c["selection_reason"] is None for c in body["candidates"])


def test_rank_unreachable_still_422(layout: Layout, monkeypatch: pytest.MonkeyPatch) -> None:
    def unreachable(*_args: object, **_kwargs: object) -> None:
        raise NoStationReachable("no AMBULANCE station can reach the incident")

    monkeypatch.setattr(dispatch_api, "rank_teams", unreachable)
    with client(layout) as c:
        response = c.post(
            "/api/v1/dispatch/rank",
            json={"incident": _poprzeczna(c), "vehicle_type": "AMBULANCE"},
        )

    assert response.status_code == 422
    assert response.json()["error_code"] == "NO_STATION_REACHABLE"


def test_eligible_ambulance_without_routable_base_returns_422(layout: Layout) -> None:
    with client(layout) as c:
        c.app.state.station_nodes = ()
        response = c.post(
            "/api/v1/dispatch/rank",
            json={
                "incident": _poprzeczna(c),
                "vehicle_type": "AMBULANCE",
                "scenario_time": NOON,
            },
        )

    assert response.status_code == 422
    assert response.json()["error_code"] == "NO_STATION_REACHABLE"
    assert response.json()["message"] == "No eligible ambulance base is on the routable network"


def test_rank_rejects_unknown_availability_value(layout: Layout) -> None:
    with client(layout) as c:
        response = c.post(
            "/api/v1/dispatch/rank",
            json={
                "incident": _poprzeczna(c),
                "vehicle_type": "AMBULANCE",
                "availability": {"K01 162": "away"},
            },
        )

    assert response.status_code == 422


@pytest.mark.parametrize(
    "extra",
    [{"vehicle_type": "FIRE_TRUCK"}, {"vehicle_type": "AMBULANCE", "resource_aware": False}],
)
def test_station_ranking_honours_time_mode(
    layout: Layout, monkeypatch: pytest.MonkeyPatch, extra: dict[str, object]
) -> None:
    seen: list[object] = []
    original = dispatch_api.rank_stations

    def spy(*args: Any, **kwargs: Any) -> Any:
        seen.append(kwargs.get("time_mode"))
        return original(*args, **kwargs)

    monkeypatch.setattr(dispatch_api, "rank_stations", spy)
    with client(layout) as c:
        response = c.post(
            "/api/v1/dispatch/rank",
            json={"incident": _poprzeczna(c), "time_mode": "DISABLED", **extra},
        )

    assert response.status_code == 200, response.text
    assert seen == [GreenWaveMode.DISABLED]
