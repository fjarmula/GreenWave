"""End-to-end domain causality and terminal diagnostic snapshots."""

from dataclasses import replace
from datetime import UTC, datetime

import pytest
from tests.simulation.test_engine import engine_for_single_stop

from greenwave.its.controller import SimulatedItsController
from greenwave.schemas import (
    ItsScenario,
    SimulationCancelledEvent,
    SimulationCompletedEvent,
    SimulationTickEvent,
)

NOW = datetime(2026, 10, 23, tzinfo=UTC)


def test_request_does_not_clear_without_controller_feedback():
    engine = engine_for_single_stop()
    state, events = engine.step(engine.initial_state(), NOW)
    tick = next(e for e in events if isinstance(e, SimulationTickEvent))
    assert tick.its_requests[0].status == "REQUESTED"
    assert tick.intersections[0].state == "NORMAL"
    assert tick.its_observed_at_simulated_sec == 1
    state, events = engine.step(state, NOW)
    tick = next(e for e in events if isinstance(e, SimulationTickEvent))
    assert events[0].event_type == "ITS_FEEDBACK"
    assert tick.its_requests[0].status == "ACCEPTED"
    assert tick.intersections[0].state == "CLEARING"  # no supported signals


@pytest.mark.parametrize("scenario", [ItsScenario.REJECTED, ItsScenario.NO_FEEDBACK])
def test_fault_falls_back_and_completes_without_a_cancellation(scenario):
    engine = engine_for_single_stop()
    engine.route_model = replace(
        engine.route_model,
        intersections=(
            replace(
                engine.route_model.intersections[0], first_stop_line_m=100, last_stop_line_m=100
            ),
        ),
    )
    engine.controller = SimulatedItsController(engine.route_model, engine.settings, scenario)
    state = engine.initial_state()
    events = []
    while not state.completed:
        state, events = engine.step(state, NOW)
    assert isinstance(events[-1], SimulationCompletedEvent)
    assert events[-1].fallback_intersection_ids == ["INT-1"]
    assert isinstance(events[-2], SimulationTickEvent)
    assert not any(isinstance(e, SimulationCancelledEvent) for e in events)
    assert engine.step(state, NOW)[1] == []


def test_ledger_rejects_stale_unknown_wrong_run_and_impossible_feedback():
    from greenwave.schemas import ItsFeedbackEvent

    engine = engine_for_single_stop()
    _state, _ = engine.step(engine.initial_state(), NOW)
    event = ItsFeedbackEvent(
        schema_version="1.0",
        is_simulated=True,
        event_type="ITS_FEEDBACK",
        simulation_id="SIM-1",
        tick=2,
        timestamp=NOW,
        request_message_id="MSG-ITS-1",
        feedback_sequence=1,
        status="ACCEPTED",
        intersections_group=["INT-1"],
        observed_at_simulated_sec=2,
    )
    for changes in [
        dict(simulation_id="wrong"),
        dict(request_message_id="MSG-ITS-2"),
        dict(intersections_group=["UNKNOWN"]),
        dict(status="EXPIRED", reason="HOLD_EXPIRED"),
    ]:
        assert not engine.ledger.apply(
            ItsFeedbackEvent.model_validate(event.model_dump() | changes)
        )
    assert engine.ledger.apply(event)
    assert not engine.ledger.apply(event)
    assert engine.ledger.snapshots()[0].status == "ACCEPTED"


def test_scripted_controller_holds_red_until_its_report_changes():
    from tests.simulation.test_signal_sync import SIGNALS
    from tests.support.route_fixtures import corridor_index, position_at

    from greenwave.routing.estimates import estimate_times
    from greenwave.routing.planner import plan_route
    from greenwave.simulation.engine import SimulationEngine
    from greenwave.simulation.route_model import build_route_model
    from greenwave.simulation_settings import SimulationSettings

    settings = SimulationSettings()
    index = corridor_index(signal_approaches=SIGNALS)
    route = plan_route(index, position_at(7422000), position_at(7422950.02), settings)
    model = build_route_model(route, index, settings, False)

    class Withhold(SimulatedItsController):
        def advance(self, observation):
            update = super().advance(observation)
            green = observation.simulated_sec >= 20
            phases = tuple(
                p.model_copy(update={"color": "GREEN" if green else "RED"})
                if p.kind == "VEHICLE" and p.signal_key == "sig-a"
                else p
                for p in update.signal_phases
            )
            runtimes = tuple(
                replace(r, state="PRIORITY_GREEN" if green else "CLEARING")
                if n == 0 and observation.simulated_sec > 1
                else r
                for n, r in enumerate(update.intersection_runtimes)
            )
            return replace(update, signal_phases=phases, intersection_runtimes=runtimes)

    controller = Withhold(model, settings)
    engine = SimulationEngine(
        "s",
        route,
        model,
        estimate_times(route, model, 1, settings),
        1,
        settings,
        controller=controller,
    )
    state = engine.initial_state()
    for n in range(1, 21):
        state, events = engine.step(state, NOW)
        tick = next(e for e in events if isinstance(e, SimulationTickEvent))
        if n < 20:
            assert state.distance_travelled_m <= 100
            assert tick.intersections[0].state != "PRIORITY_GREEN"
    assert tick.intersections[0].state == "PRIORITY_GREEN"
    state, _ = engine.step(state, NOW)
    assert state.distance_travelled_m > 100


def test_closed_engine_cannot_emit_or_submit_more_work() -> None:
    engine = engine_for_single_stop()
    state, _ = engine.step(engine.initial_state(), NOW)
    engine.close()
    engine.close()
    assert engine.step(state, NOW) == (state, [])


@pytest.mark.parametrize(
    ("scenario", "delay", "status", "reason"),
    [
        (ItsScenario.NOMINAL, 1, "ACCEPTED", None),
        (ItsScenario.DELAYED, 5, "ACCEPTED", None),
        (ItsScenario.REJECTED, 1, "REJECTED", "CONTROLLER_REJECTED"),
        (ItsScenario.NO_FEEDBACK, 8, "TIMED_OUT", "ACK_TIMEOUT"),
    ],
)
@pytest.mark.parametrize("playback_speed", [1, 10])
def test_scenario_decision_time_starts_at_request_submission(
    scenario: ItsScenario, delay: int, status: str, reason: str | None, playback_speed: int
) -> None:
    engine = engine_for_single_stop()
    engine.route_model = replace(
        engine.route_model,
        intersections=(
            replace(
                engine.route_model.intersections[0], first_stop_line_m=100, last_stop_line_m=100
            ),
        ),
    )
    engine.controller = SimulatedItsController(engine.route_model, engine.settings, scenario)
    engine.playback_speed = playback_speed
    state, events = engine.step(engine.initial_state(), NOW)
    dispatch = next(event for event in events if event.event_type == "ITS_DISPATCH")
    tick = next(event for event in events if isinstance(event, SimulationTickEvent))
    assert tick.its_requests[0].status == "REQUESTED"
    for elapsed in range(1, delay + 1):
        state, events = engine.step(state, NOW)
        feedback = [
            event
            for event in events
            if event.event_type == "ITS_FEEDBACK"
            and event.request_message_id == dispatch.message_id
        ]
        if elapsed < delay:
            assert not feedback
        else:
            assert [event.status for event in feedback] == [status]
            assert feedback[0].observed_at_simulated_sec == dispatch.tick + delay
            assert feedback[0].reason == reason
            # A failed request falls back; it never ends the run.
            assert not any(event.event_type == "SIMULATION_CANCELLED" for event in events)
            assert not any(event.event_type == "SIMULATION_COMPLETED" for event in events)
    engine.close()
