from typing import Any

import pytest
from pydantic import ValidationError

from greenwave.schemas import (
    DispatchRankResponse,
    ErrorCode,
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
                "distance_m": 900.0,
            }
            for i in range(candidates)
        ],
        "station_at_incident": None,
    }


def test_start_request_defaults_vehicle_type() -> None:
    assert SimulationStartRequest.model_validate(_start()).vehicle_type is VehicleType.AMBULANCE
    with pytest.raises(ValidationError):
        SimulationStartRequest.model_validate(_start(vehicle_type="TANK"))


@pytest.mark.parametrize("count", [0, 4])
def test_rank_response_bounds(count: int) -> None:
    with pytest.raises(ValidationError):
        DispatchRankResponse.model_validate(_rank(count))


def test_rank_response_accepts_one_to_three() -> None:
    assert len(DispatchRankResponse.model_validate(_rank(3)).candidates) == 3


def test_station_id_pattern() -> None:
    with pytest.raises(ValidationError):
        DispatchRankResponse.model_validate(
            {**_rank(1), "station_at_incident": _station("STN-X-1")}
        )


def test_no_station_reachable_error_code() -> None:
    assert ErrorCode("NO_STATION_REACHABLE") is ErrorCode.NO_STATION_REACHABLE
