import logging
from datetime import UTC, datetime

import pytest
from tests.support.route_fixtures import corridor_index, position_at

from greenwave.its import MockItsGateway
from greenwave.routing.estimates import estimate_times
from greenwave.routing.planner import plan_route
from greenwave.schemas import GreenWaveMode, SimulationStartRequest
from greenwave.simulation.assembly import plan_simulation
from greenwave.simulation.engine import SimulationEngine
from greenwave.simulation.route_model import build_route_model, to_start_response
from greenwave.simulation.standard_estimate import standard_run_seconds
from greenwave.simulation_settings import SimulationSettings

_X = 7_421_000.0


def test_plan_simulation_matches_start_response_of_parts() -> None:
    settings, index, gateway = SimulationSettings(), corridor_index(), MockItsGateway()
    request = SimulationStartRequest.model_validate(
        {
            "simulation_id": "SIM-plan",
            "origin": position_at(_X + 1_000).model_dump(),
            "destination": position_at(_X + 1_850.02).model_dump(),
            "traffic_density_multiplier": 1.5,
            "enable_cascade_mode": True,
        }
    )

    planned = plan_simulation(index, request, settings, gateway)

    route = plan_route(index, request.origin, request.destination, settings)
    model = build_route_model(route, index, settings, True)
    estimates = estimate_times(route, model, 1.5, settings)
    engine = SimulationEngine("SIM-plan", route, model, estimates, 1.5, settings, gateway)
    standard = standard_run_seconds(route, model, 1.5, settings)
    assert planned.response == to_start_response(
        "SIM-plan", route, model, estimates, index, standard_seconds=standard
    )
    assert planned.engine.initial_state() == engine.initial_state()


def test_assembly_logs_one_warning_per_mismatch_and_still_starts(
    caplog: pytest.LogCaptureFixture,
) -> None:
    settings, index, gateway = SimulationSettings(), corridor_index(), MockItsGateway()
    request = SimulationStartRequest.model_validate(
        {
            "simulation_id": "SIM-cascade-check",
            "origin": position_at(_X + 1_000).model_dump(),
            "destination": position_at(_X + 1_850.02).model_dump(),
            "traffic_density_multiplier": 1.5,
            "enable_cascade_mode": True,
        }
    )

    with caplog.at_level(logging.WARNING, logger="greenwave.simulation.cascade_check"):
        planned = plan_simulation(index, request, settings, gateway)

    records = [
        record for record in caplog.records if record.name == "greenwave.simulation.cascade_check"
    ]
    assert planned.response.status == "INITIALIZED"
    assert len(records) == 1
    assert "INT-A" in records[0].message and "INT-TWIN" in records[0].message
    assert "along_route_m=250.0" in records[0].message
    assert "candidate_m=None" in records[0].message


def _mode_request(**extra: object) -> SimulationStartRequest:
    return SimulationStartRequest.model_validate(
        {
            "simulation_id": "SIM-mode",
            "origin": position_at(_X + 1_000).model_dump(),
            "destination": position_at(_X + 1_850.02).model_dump(),
            "traffic_density_multiplier": 1.5,
            "enable_cascade_mode": True,
            **extra,
        }
    )


@pytest.mark.parametrize("mode", ["ENABLED", "DISABLED"])
def test_the_start_response_carries_the_standard_run_estimate(mode: str) -> None:
    settings, index = SimulationSettings(), corridor_index()
    request = _mode_request(green_wave_mode=mode)

    planned = plan_simulation(index, request, settings, MockItsGateway())

    route = plan_route(index, request.origin, request.destination, settings)
    model = build_route_model(route, index, settings, False)
    expected = standard_run_seconds(route, model, 1.5, settings)
    assert planned.response.estimated_standard_time_sec == round(expected)
    disabled = plan_simulation(
        index, _mode_request(green_wave_mode="DISABLED"), settings, MockItsGateway()
    )
    state = disabled.engine.initial_state()
    while not state.completed:
        state, _ = disabled.engine.step(state, datetime(2026, 10, 25, tzinfo=UTC))
    assert state.arrived_at_s == expected


def test_a_legacy_request_plans_an_enabled_run_with_its_cascade() -> None:
    settings, index, gateway = SimulationSettings(), corridor_index(), MockItsGateway()

    planned = plan_simulation(index, _mode_request(), settings, gateway)

    assert planned.response.green_wave_mode is GreenWaveMode.ENABLED
    assert planned.engine.green_wave_mode is GreenWaveMode.ENABLED
    assert planned.response.route_intersections[0].cascade_targets == ["INT-TWIN"]


def test_a_disabled_run_ignores_the_cascade_toggle() -> None:
    """Cascade is a Green Wave detail; a disabled run must never pre-clear later intersections."""
    settings, index, gateway = SimulationSettings(), corridor_index(), MockItsGateway()

    planned = plan_simulation(index, _mode_request(green_wave_mode="DISABLED"), settings, gateway)

    assert planned.response.green_wave_mode is GreenWaveMode.DISABLED
    assert planned.engine.green_wave_mode is GreenWaveMode.DISABLED
    assert all(item.cascade_targets == [] for item in planned.response.route_intersections)
    assert all(
        planned.engine.route_model.cascade_targets(item.id) == ()
        for item in planned.engine.route_model.intersections
    )
