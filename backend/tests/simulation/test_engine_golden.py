"""Characterization of the full engine event stream; guards refactors against any output change.

Regenerate only for an intended behaviour change: ``GREENWAVE_REGEN_GOLDEN=1 uv run pytest <this>``.
"""

import dataclasses
import json
import os
from datetime import UTC, datetime
from pathlib import Path

import pytest
from tests.support.route_fixtures import corridor_index, position_at

from greenwave.routing.estimates import estimate_times
from greenwave.routing.planner import plan_route
from greenwave.schemas import ItsDispatchPayload
from greenwave.simulation.engine import SimulationEngine
from greenwave.simulation.route_model import build_route_model
from greenwave.simulation_settings import SimulationSettings

_GOLDEN = Path(__file__).parent / "golden" / "engine_events.json"
_X = 7_421_000.0
_NOW = datetime(2026, 10, 17, tzinfo=UTC)
_MAX_TICKS = 10_000

# name -> (cascade enabled, traffic density multiplier, playback speed, clearing TTI seconds)
# A 10 s clearing window makes targets 250 m ahead enter CLEARING by cascade; at the 40 s
# default every intersection on this corridor clears by its own TTI first.
SCENARIOS: dict[str, tuple[bool, float, int, float]] = {
    "no_cascade_x1": (False, 1.5, 1, 40.0),
    "cascade_x1": (True, 1.5, 1, 40.0),
    "cascade_x5": (True, 2.0, 5, 40.0),
    "short_window_cascade_x1": (True, 1.0, 1, 10.0),
    "short_window_no_cascade_x1": (False, 1.0, 1, 10.0),
}


class _RecordingGateway:
    def __init__(self) -> None:
        self.dispatched: list[object] = []

    def dispatch(self, payload: ItsDispatchPayload) -> None:
        self.dispatched.append(payload.model_dump(mode="json"))


def run_scenario(
    cascade: bool, density: float, playback: int, clearing_tti_s: float, simulation_id: str
) -> object:
    settings = SimulationSettings(
        clearing_tti_seconds=clearing_tti_s,
        priority_green_tti_seconds=min(
            clearing_tti_s, SimulationSettings().priority_green_tti_seconds
        ),
    )
    index = corridor_index()
    route = plan_route(index, position_at(_X + 1_000), position_at(_X + 1_850.02), settings)
    model = build_route_model(route, index, settings, cascade)
    estimates = estimate_times(route, model, density, settings)
    gateway = _RecordingGateway()
    engine = SimulationEngine(simulation_id, route, model, estimates, density, settings, gateway)
    state = engine.initial_state()
    events: list[object] = []
    for _ in range(_MAX_TICKS):
        state, emitted = engine.run_tick(state, _NOW, playback)
        events.extend(event.model_dump(mode="json") for event in emitted)
        if state.completed:
            break
    else:
        pytest.fail(f"{simulation_id} did not complete within {_MAX_TICKS} ticks")
    final_state = json.loads(json.dumps(dataclasses.asdict(state), default=str))
    return {"events": events, "dispatched": gateway.dispatched, "final_state": final_state}


def _all_scenarios() -> dict[str, object]:
    return {
        name: run_scenario(*scenario, simulation_id=f"SIM-{name}")
        for name, scenario in SCENARIOS.items()
    }


def test_engine_event_stream_matches_golden() -> None:
    actual = _all_scenarios()
    if os.environ.get("GREENWAVE_REGEN_GOLDEN") == "1":
        _GOLDEN.parent.mkdir(exist_ok=True)
        _GOLDEN.write_text(json.dumps(actual, indent=1, sort_keys=True) + "\n")
        pytest.skip("golden regenerated")

    assert actual == json.loads(_GOLDEN.read_text())


def _dispatch_groups(scenario: object) -> list[list[str]]:
    events = scenario["events"]  # type: ignore[index]
    return [
        e["payload"]["intersections_group"] for e in events if e["event_type"] == "ITS_DISPATCH"
    ]


def test_golden_pins_a_cascade_that_changes_dispatch_groups() -> None:
    golden = json.loads(_GOLDEN.read_text())

    assert _dispatch_groups(golden["short_window_cascade_x1"]) != _dispatch_groups(
        golden["short_window_no_cascade_x1"]
    )
