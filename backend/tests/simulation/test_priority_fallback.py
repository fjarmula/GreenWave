"""Per-junction graceful fallback: a failed priority request affects only its own targets.

Reuses the single-crossing fixture of ``test_motion_modes``: the ambulance drives 13 m/s, INT-1's
stop line is at 90 m and the RED programme keeps the route movement red, so a standard crossing
there costs the capped 15 s.
"""

from dataclasses import replace
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError
from tests.simulation.test_motion_modes import RED, _engine, _run

from greenwave.its.controller import SimulatedItsController, mixed_outcome
from greenwave.its.models import ItsControllerUpdate, ItsObservation
from greenwave.schemas import (
    CrossingStrategy,
    GreenWaveMode,
    IntersectionState,
    ItsDispatchEvent,
    ItsFeedbackEvent,
    ItsScenario,
    SignalPhaseColor,
    SimulationCancelledEvent,
    SimulationCompletedEvent,
    SimulationStartRequest,
    SimulationTickEvent,
)
from greenwave.schemas.its import MixedOutcome
from greenwave.simulation.engine import SimulationEngine
from greenwave.simulation.state import EngineState

_NOW = datetime(2026, 10, 29, tzinfo=UTC)


def _with_scenario(
    engine: SimulationEngine, scenario: ItsScenario, seed: int = 0
) -> SimulationEngine:
    engine.controller = SimulatedItsController(engine.route_model, engine.settings, scenario, seed)
    return engine


def _events(engine: SimulationEngine) -> tuple[list[EngineState], list[object]]:
    state, states, events = engine.initial_state(), [], []
    for _ in range(600):
        state, step = engine.step(state, _NOW)
        states.append(state)
        events.extend(step)
        if state.completed:
            return states, events
    raise AssertionError("run never completed")


def _ticks(events: list[object]) -> list[SimulationTickEvent]:
    return [e for e in events if isinstance(e, SimulationTickEvent)]


@pytest.mark.parametrize(
    ("scenario", "status", "reason", "decided_at"),
    [
        (ItsScenario.REJECTED, "REJECTED", "CONTROLLER_REJECTED", 2),
        (ItsScenario.NO_FEEDBACK, "TIMED_OUT", "ACK_TIMEOUT", 9),
    ],
)
def test_failed_request_falls_back_and_the_run_completes(
    scenario: ItsScenario, status: str, reason: str, decided_at: int
) -> None:
    engine = _with_scenario(_engine(GreenWaveMode.ENABLED, phase=RED), scenario)
    states, events = _events(engine)
    feedback = [e for e in events if isinstance(e, ItsFeedbackEvent)]
    assert [(f.status, f.reason, f.observed_at_simulated_sec) for f in feedback] == [
        (status, reason, decided_at)
    ]
    assert feedback[0].request_message_id == "MSG-ITS-1"
    assert not any(isinstance(e, SimulationCancelledEvent) for e in events)
    completed = events[-1]
    assert isinstance(completed, SimulationCompletedEvent)
    assert completed.fallback_intersection_ids == ["INT-1"]
    assert engine.green_wave_mode is GreenWaveMode.ENABLED
    ticks = _ticks(events)
    # Ordinary signals only: a failed target never clears, holds priority or recovers.
    assert all(tick.intersections[0].state is IntersectionState.NORMAL for tick in ticks)
    after = [t for t in ticks if t.tick >= decided_at]
    assert all(
        t.intersections[0].crossing_strategy is CrossingStrategy.STANDARD_FALLBACK for t in after
    )
    assert all(
        t.intersections[0].crossing_strategy is CrossingStrategy.PRIORITY
        for t in ticks
        if t.tick < decided_at
    )
    # Reconnect: one snapshot carries the failed request with its correlated outcome.
    assert after[-1].its_requests[0].status == status
    assert after[-1].its_requests[0].reason == reason
    # Savings include every waited and fallback second, and may be negative.
    final = states[-1]
    assert final.arrived_at_s is not None
    assert completed.kpi_metrics.current_time_saved_sec == round(
        engine.standard_profile.total_seconds
    ) - round(final.arrived_at_s)


def test_rejection_before_the_approach_crosses_exactly_like_standard_mode() -> None:
    engine = _with_scenario(_engine(GreenWaveMode.ENABLED, phase=RED), ItsScenario.REJECTED)
    states, events = _events(engine)
    standard, _ = _run(_engine(GreenWaveMode.DISABLED, phase=RED))
    assert states[-1].arrived_at_s == pytest.approx(standard[-1].arrived_at_s)
    completed = events[-1]
    assert isinstance(completed, SimulationCompletedEvent)
    assert completed.kpi_metrics.current_time_saved_sec == 0


def test_timeout_while_held_at_the_line_releases_without_indefinite_wait() -> None:
    # A 20 s timeout: the vehicle reaches the red line (~10 s) and waits there for priority.
    engine = _engine(GreenWaveMode.ENABLED, phase=RED, settings={"its_ack_timeout_seconds": 20})
    engine = _with_scenario(engine, ItsScenario.NO_FEEDBACK)
    states, events = _events(engine)
    timeout = next(e for e in events if isinstance(e, ItsFeedbackEvent))
    assert (timeout.status, timeout.observed_at_simulated_sec) == ("TIMED_OUT", 21)
    held = [s for s in states if s.dwelling_intersection_id == "INT-1"]
    assert held, "the vehicle waits at the red line before the timeout"
    assert all(s.distance_travelled_m == 90.0 and s.simulated_time_s <= 21 for s in held)
    standard, _ = _run(_engine(GreenWaveMode.DISABLED, phase=RED))
    arrived = states[-1].arrived_at_s
    assert arrived is not None and standard[-1].arrived_at_s is not None
    # Held until the timeout, then one standard crossing from the line: slower, never doubled.
    assert arrived > standard[-1].arrived_at_s
    assert arrived <= 22 + 110 / 10 + 15 + 1e-6


# Clearing starts 5 s ahead, so 90 m and 190 m stop lines get separate requests.
_SHORT_WINDOW = {"clearing_tti_seconds": 5, "priority_green_tti_seconds": 3}


def _two_junctions(settings: dict[str, float]) -> SimulationEngine:
    engine = _engine(GreenWaveMode.ENABLED, stop_lines=(90.0, 190.0), phase=RED, settings=settings)
    first, second = engine.route_model.intersections
    engine.route_model = replace(
        engine.route_model, intersections=(first, replace(second, delay_seconds=20.0))
    )
    return engine


def _seed_for(*wanted: tuple[tuple[str, ...], MixedOutcome]) -> int:
    return next(
        seed
        for seed in range(10_000)
        if all(mixed_outcome(seed, ids) is outcome for ids, outcome in wanted)
    )


def test_downstream_junction_keeps_priority_after_an_upstream_rejection() -> None:
    seed = _seed_for(
        (("INT-1",), MixedOutcome.REJECT),
        (("INT-2",), MixedOutcome.ACCEPT),
    )
    engine = _with_scenario(_two_junctions(_SHORT_WINDOW), ItsScenario.MIXED, seed)
    _states, events = _events(engine)
    final_tick = _ticks(events)[-1]
    by_group = {tuple(r.intersections_group): r.status for r in final_tick.its_requests}
    assert by_group == {("INT-1",): "REJECTED", ("INT-2",): "RELEASED"}
    assert [i.crossing_strategy for i in final_tick.intersections] == [
        CrossingStrategy.STANDARD_FALLBACK,
        CrossingStrategy.PRIORITY,
    ]
    assert any(t.intersections[1].state is IntersectionState.CLEARING for t in _ticks(events))
    completed = events[-1]
    assert isinstance(completed, SimulationCompletedEvent)
    assert completed.fallback_intersection_ids == ["INT-1"]


def test_grouped_request_falls_back_together() -> None:
    engine = _with_scenario(
        _engine(GreenWaveMode.ENABLED, stop_lines=(90.0, 110.0), phase=RED),
        ItsScenario.REJECTED,
    )
    _states, events = _events(engine)
    dispatches = [e for e in events if isinstance(e, ItsDispatchEvent)]
    assert [d.payload.intersections_group for d in dispatches] == [["INT-1", "INT-2"]]
    completed = events[-1]
    assert isinstance(completed, SimulationCompletedEvent)
    assert completed.fallback_intersection_ids == ["INT-1", "INT-2"]


def test_standard_mode_reports_no_crossing_strategy() -> None:
    _states, ticks = _run(_engine(GreenWaveMode.DISABLED, phase=RED))
    assert all(t.intersections[0].crossing_strategy is None for t in ticks)


def test_mixed_outcomes_are_playback_invariant() -> None:
    seed = _seed_for((("INT-1",), MixedOutcome.NO_RESPONSE), (("INT-2",), MixedOutcome.REJECT))

    def run(speed: int) -> list[tuple[float, ...] | tuple[int, float, str]]:
        engine = _with_scenario(_two_junctions(_SHORT_WINDOW), ItsScenario.MIXED, seed)
        engine.playback_speed = speed
        states, events = _events(engine)
        feedback = [e for e in events if isinstance(e, ItsFeedbackEvent)]
        assert [f.status for f in feedback] == ["TIMED_OUT", "REJECTED"]
        return [(s.simulated_time_s, s.distance_travelled_m) for s in states] + [
            (f.feedback_sequence, f.observed_at_simulated_sec, f.status) for f in feedback
        ]

    assert run(10) == run(1)


def test_mixed_draw_uses_seed_and_stable_target_identity_only() -> None:
    outcomes = {mixed_outcome(seed, ("INT-1", "INT-2")) for seed in range(64)}
    assert outcomes == set(MixedOutcome)
    assert mixed_outcome(3, ("INT-2", "INT-1")) is mixed_outcome(3, ("INT-1", "INT-2"))
    assert [mixed_outcome(s, ("INT-1",)) for s in range(8)] == [
        mixed_outcome(s, ("INT-1",)) for s in range(8)
    ]


def test_mixed_draw_matches_the_documented_fnv1a_hash() -> None:
    # FNV-1a 32-bit of "0:INT-9001" is 0xEEF2F431; fmix32 makes it 0xD443DD76 (top bits 3).
    # The mock transport's test pins the same value.
    assert mixed_outcome(0, ("INT-9001",)) is MixedOutcome.NO_RESPONSE


@pytest.mark.parametrize("seed", [-1, 2**32])
def test_outcome_seed_is_validated(seed: int) -> None:
    with pytest.raises(ValidationError):
        SimulationStartRequest.model_validate(
            {
                "simulation_id": "SIM-1",
                "origin": {"lat": 50.0, "lng": 19.9},
                "destination": {"lat": 50.1, "lng": 19.9},
                "traffic_density_multiplier": 1.0,
                "enable_cascade_mode": False,
                "its_outcome_seed": seed,
            }
        )


def test_withdrawn_request_ignores_a_late_acceptance() -> None:
    engine = _engine(GreenWaveMode.ENABLED, phase=RED)
    settings = engine.settings.model_copy(
        update={"its_delayed_ack_seconds": 7, "its_ack_timeout_seconds": 8}
    )
    controller = SimulatedItsController(engine.route_model, settings, ItsScenario.DELAYED)
    engine.controller = controller
    engine.settings = settings
    state = engine.initial_state()
    state, _ = engine.step(state, _NOW)
    controller.withdraw("SIM-modes", "MSG-ITS-1")
    for _ in range(10):
        state, events = engine.step(state, _NOW)
        assert not any(isinstance(e, ItsFeedbackEvent) and e.status == "ACCEPTED" for e in events)
        assert state.intersection_runtimes[0].state is IntersectionState.NORMAL


def test_failed_targets_are_never_requested_again() -> None:
    engine = _with_scenario(_engine(GreenWaveMode.ENABLED, phase=RED), ItsScenario.REJECTED)
    _states, events = _events(engine)
    assert sum(getattr(e, "event_type", "") == "ITS_DISPATCH" for e in events) == 1


class _NeverGreen(SimulatedItsController):
    """Accepts, but the route light never turns green, so the hold at the line expires."""

    def advance(self, observation: ItsObservation) -> ItsControllerUpdate:
        update = super().advance(observation)
        phases = tuple(
            p.model_copy(update={"color": SignalPhaseColor.RED}) if p.kind == "VEHICLE" else p
            for p in update.signal_phases
        )
        return replace(update, signal_phases=phases)


def test_expired_hold_falls_back_and_releases_the_vehicle() -> None:
    engine = _engine(GreenWaveMode.ENABLED, phase=RED)
    engine.controller = _NeverGreen(engine.route_model, engine.settings)
    states, events = _events(engine)
    statuses = [(e.status, e.reason) for e in events if isinstance(e, ItsFeedbackEvent)]
    assert statuses == [("ACCEPTED", None), ("EXPIRED", "HOLD_EXPIRED")]
    expired_at = next(
        e.observed_at_simulated_sec
        for e in events
        if isinstance(e, ItsFeedbackEvent) and e.status == "EXPIRED"
    )
    assert all(s.simulated_time_s <= expired_at + 1 for s in states if s.dwelling_intersection_id)
    completed = events[-1]
    assert isinstance(completed, SimulationCompletedEvent)
    assert completed.fallback_intersection_ids == ["INT-1"]
    assert completed.kpi_metrics.current_time_saved_sec < 0
