from datetime import datetime
from typing import Any

import pytest
from pydantic import ValidationError

from greenwave.schemas import (
    DispatchRankRequest,
    DispatchRankResponse,
    ErrorCode,
    GeocodeResult,
    RankedCandidate,
    ResourcesResponse,
    SimulationStartRequest,
    VehicleType,
)


def _start(**extra: Any) -> dict[str, Any]:
    return {
        "simulation_id": "SIM-1",
        "origin": {"lat": 50.06, "lng": 19.93},
        "destination": {"lat": 50.07, "lng": 19.94},
        "traffic_density_multiplier": 1.0,
        "enable_cascade_mode": False,
        **extra,
    }


def _station(station_id: str = "STN-A-0001") -> dict[str, Any]:
    return {
        "station_id": station_id,
        "vehicle_type": "AMBULANCE",
        "source_kind": "hospital_ed",
        "name": "Szpital",
        "position": {"lat": 50.06, "lng": 19.93},
    }


def _rank(candidates: int) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "incident_snapped": {"position": {"lat": 50.07, "lng": 19.94}, "snap_distance_m": 3.0},
        "candidates": [
            {
                "station": _station(f"STN-A-000{i + 1}"),
                "greenwave_seconds": 60.0 + i,
                "standard_seconds": 75.0 + i,
                "distance_m": 900.0,
            }
            for i in range(candidates)
        ],
        "station_at_incident": None,
        "scenario_time": "2026-10-27T21:00:00",
        "outcome": "OK" if candidates else "NO_ELIGIBLE_RESOURCE",
        "incident_area": None,
        "excluded_teams": [],
        "roster": None,
        "area_rule": None,
    }


def test_start_request_defaults_vehicle_type() -> None:
    assert SimulationStartRequest.model_validate(_start()).vehicle_type is VehicleType.AMBULANCE
    with pytest.raises(ValidationError):
        SimulationStartRequest.model_validate(_start(vehicle_type="TANK"))


def test_rank_response_bounds() -> None:
    with pytest.raises(ValidationError):
        DispatchRankResponse.model_validate(_rank(4))


@pytest.mark.parametrize("count", [0, 1, 3])
def test_rank_response_accepts_zero_to_three(count: int) -> None:
    assert len(DispatchRankResponse.model_validate(_rank(count)).candidates) == count


def test_station_id_pattern() -> None:
    with pytest.raises(ValidationError):
        DispatchRankResponse.model_validate(
            {**_rank(1), "station_at_incident": _station("STN-X-1")}
        )


def test_no_station_reachable_error_code() -> None:
    assert ErrorCode("NO_STATION_REACHABLE") is ErrorCode.NO_STATION_REACHABLE


def test_ranked_candidate_on_foot_defaults_to_none_and_rejects_negative() -> None:
    from greenwave.schemas import OnFootLeg, RankedCandidate

    station = {
        "station_id": "STN-A-0001",
        "vehicle_type": "AMBULANCE",
        "source_kind": "ambulance_base",
        "name": "A",
        "position": {"lat": 50.0, "lng": 19.9},
    }
    candidate = RankedCandidate.model_validate(
        {"station": station, "greenwave_seconds": 1.0, "standard_seconds": 1.5, "distance_m": 1.0}
    )
    assert candidate.on_foot is None
    leg = {"access_point": {"lat": 50.0, "lng": 19.9}, "distance_m": 650.0, "seconds": 464.0}
    assert OnFootLeg.model_validate(leg).distance_m == 650.0
    with pytest.raises(ValidationError):
        OnFootLeg.model_validate({**leg, "distance_m": -1})
    with pytest.raises(ValidationError):
        OnFootLeg.model_validate({**leg, "seconds": -1})


def test_rank_request_density_defaults_to_one_and_is_bounded() -> None:
    body = {"incident": {"lat": 50.0, "lng": 19.9}, "vehicle_type": "AMBULANCE"}
    assert DispatchRankRequest.model_validate(body).traffic_density_multiplier == 1.0
    for density in (0.9, 3.5, float("nan")):
        with pytest.raises(ValidationError):
            DispatchRankRequest.model_validate({**body, "traffic_density_multiplier": density})


def test_ranked_candidate_requires_a_non_negative_standard_time() -> None:
    candidate = _rank(1)["candidates"][0]
    for standard in (None, -1.0):
        with pytest.raises(ValidationError):
            RankedCandidate.model_validate({**candidate, "standard_seconds": standard})


def test_geocode_result_requires_provenance() -> None:
    with pytest.raises(ValidationError, match="provenance"):
        GeocodeResult.model_validate({"label": "Długa 5", "position": {"lat": 50.0, "lng": 19.9}})


def test_geocode_result_optional_provenance_fields_default_to_none() -> None:
    result = GeocodeResult.model_validate(
        {"label": "Długa 5", "position": {"lat": 50.0, "lng": 19.9}, "provenance": "osm"}
    )
    assert (result.osm_delta_m, result.disagreement_m, result.osm_position) == (None, None, None)
    assert result.osm_same_key_elsewhere is False


def test_geocode_result_rejects_negative_offset() -> None:
    with pytest.raises(ValidationError, match="osm_delta_m"):
        GeocodeResult.model_validate(
            {
                "label": "Długa 5",
                "position": {"lat": 50.0, "lng": 19.9},
                "provenance": "matched",
                "osm_delta_m": -1,
            }
        )


def _rank_request(**extra: Any) -> dict[str, Any]:
    return {"incident": {"lat": 50.06, "lng": 19.93}, "vehicle_type": "AMBULANCE", **extra}


def test_rank_request_resource_fields_default() -> None:
    request = DispatchRankRequest.model_validate(_rank_request())

    assert request.scenario_time is None
    assert request.time_mode.value == "ENABLED"
    assert request.availability == {}


def test_rank_request_rejects_unknown_availability() -> None:
    with pytest.raises(ValidationError):
        DispatchRankRequest.model_validate(_rank_request(availability={"K01 162": "away"}))


def test_rank_request_rejects_malformed_team_code() -> None:
    with pytest.raises(ValidationError):
        DispatchRankRequest.model_validate(_rank_request(availability={"<script>": "busy"}))


def test_rank_request_bounds_the_availability_map() -> None:
    many = {f"K01 {i:03d}": "busy" for i in range(300)}
    with pytest.raises(ValidationError):
        DispatchRankRequest.model_validate(_rank_request(availability=many))


def test_rank_request_scenario_time_is_local_and_naive() -> None:
    naive = DispatchRankRequest.model_validate(_rank_request(scenario_time="2026-10-27T21:00"))
    aware = DispatchRankRequest.model_validate(_rank_request(scenario_time="2026-10-27T20:00:00Z"))

    assert naive.scenario_time == datetime(2026, 10, 27, 21, 0)
    # 20:00 UTC is 21:00 in Kraków (CET, after the 25 October change).
    assert aware.scenario_time == datetime(2026, 10, 27, 21, 0)


def test_rank_response_rejects_unknown_outcome() -> None:
    body = _rank(1) | {"outcome": "MAYBE"}
    with pytest.raises(ValidationError):
        DispatchRankResponse.model_validate(body)


def test_ranked_candidate_team_and_reason_default_to_none() -> None:
    candidate = RankedCandidate.model_validate(_rank(1)["candidates"][0])

    assert (candidate.team, candidate.selection_reason) == (None, None)


def test_ranked_candidate_rejects_unknown_selection_reason() -> None:
    body = _rank(1)["candidates"][0] | {"selection_reason": "CLOSEST"}
    with pytest.raises(ValidationError):
        RankedCandidate.model_validate(body)


def test_resources_response_round_trips() -> None:
    body = {
        "schema_version": "1.0",
        "roster": {
            "source": "PRM",
            "plan_update": "2",
            "effective_from": "2026-09-01",
            "teams_in_scope": 1,
        },
        "at": "2026-10-27T21:00:00",
        "teams": [
            {
                "team_code": "K01 176",
                "team_type": "P3",
                "station_id": "STN-A-0003",
                "base_address": "ul. Rynek Podgórski 2, 30-533 Kraków",
                "area_teryt": ["1261049"],
                "weekdays": "1234567",
                "ready_from_min": 420,
                "ready_to_min": 1140,
                "season_from": "01-01",
                "season_to": "12-31",
                "on_shift": False,
            }
        ],
    }

    parsed = ResourcesResponse.model_validate(body)

    assert parsed.model_dump(mode="json") == body
