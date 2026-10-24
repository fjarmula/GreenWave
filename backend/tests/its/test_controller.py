"""Controller decisions must precede reported priority, using simulated time only."""

from dataclasses import replace
from datetime import UTC, datetime

import pytest

from greenwave.its.controller import SimulatedItsController
from greenwave.its.models import ItsIntersectionObservation, ItsObservation, ItsRequest
from greenwave.routing.planner import plan_route
from greenwave.schemas import ItsDispatchPayload, ItsScenario
from greenwave.simulation.route_model import build_route_model
from greenwave.simulation_settings import SimulationSettings
from tests.support.route_fixtures import corridor_index, position_at, signal_ref


def setup(scenario: ItsScenario = ItsScenario.NOMINAL, signals: bool = True):
    settings = SimulationSettings()
    refs = (
        {
            "INT-A": (
                signal_ref("INT-A", "route", 7422095, 5541000, "corridor-a"),
                signal_ref("INT-A", "cross", 7422105, 5541000, "cross-street"),
            )
        }
        if signals
        else {}
    )
    index = corridor_index(signal_approaches=refs)
    route = plan_route(index, position_at(7422000), position_at(7422850.02), settings)
    model = build_route_model(route, index, settings, True)
    return SimulatedItsController(model, settings, scenario), model


def request(targets=("INT-A",), hold=40):
    return ItsRequest(
        "s",
        "MSG-ITS-1",
        10,
        ItsDispatchPayload(
            priority_level=1,
            vehicle_type="AMBULANCE",
            intersections_group=list(targets),
            action="FORCE_GREEN_PHASE",
            hold_duration_sec=hold,
            expected_arrival_utc=datetime(2026, 10, 23, tzinfo=UTC),
        ),
        tuple(False for _ in targets),
    )


def observe(controller, model, now, passed=(), tti=20):
    return controller.advance(
        ItsObservation(
            now,
            tuple(
                ItsIntersectionObservation(i.id, None if i.id in passed else tti, i.id in passed)
                for i in model.intersections
            ),
        )
    )


@pytest.mark.parametrize(
    "scenario,ack,status",
    [
        (ItsScenario.NOMINAL, 11, "ACCEPTED"),
        (ItsScenario.DELAYED, 15, "ACCEPTED"),
        (ItsScenario.REJECTED, 11, "REJECTED"),
        (ItsScenario.NO_FEEDBACK, 18, None),
    ],
)
def test_delayed_decisions(scenario, ack, status):
    controller, model = setup(scenario)
    controller.submit(request())
    assert observe(controller, model, 10).feedback == ()
    assert observe(controller, model, ack - 1).feedback == ()
    update = observe(controller, model, ack)
    assert [f.status for f in update.feedback] == ([] if status is None else [status])


def test_duplicate_conflict_and_close():
    controller, model = setup()
    controller.submit(request())
    controller.submit(request())
    with pytest.raises(ValueError):
        controller.submit(replace(request(), submitted_at_simulated_sec=9))
    controller.close()
    controller.close()
    assert observe(controller, model, 11).feedback == ()
    assert all(i.state == "NORMAL" for i in observe(controller, model, 11).intersection_runtimes)


def test_acceptance_waits_for_conflicting_yellow_and_red():
    controller, model = setup()
    # Cross street starts green at second 40. Acceptance at 41 targets route green.
    r = replace(request(), submitted_at_simulated_sec=40)
    observe(controller, model, 40)
    controller.submit(r)
    at41 = observe(controller, model, 41)
    assert at41.feedback[0].status == "ACCEPTED"
    assert at41.intersection_runtimes[0].state == "CLEARING"
    assert observe(controller, model, 43).intersection_runtimes[0].state == "CLEARING"
    assert observe(controller, model, 44).intersection_runtimes[0].state == "CLEARING"
    assert observe(controller, model, 45).intersection_runtimes[0].state == "PRIORITY_GREEN"


def test_missing_movements_cannot_confirm_green():
    controller, model = setup(signals=False)
    controller.submit(request())
    assert observe(controller, model, 11).intersection_runtimes[0].state == "CLEARING"
    assert observe(controller, model, 30).intersection_runtimes[0].state == "CLEARING"


def test_partial_release_and_passage_at_expiry():
    controller, model = setup()
    controller.submit(request(("INT-A", "INT-B")))
    observe(controller, model, 11)
    assert observe(controller, model, 12, passed=("INT-A",)).feedback == ()
    final = observe(controller, model, 50, passed=("INT-A", "INT-B"))
    assert final.feedback[0].status == "RELEASED"
    assert (
        observe(controller, model, 65, passed=("INT-A", "INT-B")).intersection_runtimes[1].state
        == "NORMAL"
    )


def test_pending_passage_prevents_late_activation_and_hold_expires():
    controller, model = setup(ItsScenario.DELAYED)
    controller.submit(request())
    assert observe(controller, model, 11, passed=("INT-A",)).feedback[0].status == "RELEASED"
    assert observe(controller, model, 15, passed=("INT-A",)).feedback == ()
    controller, model = setup()
    controller.submit(request())
    observe(controller, model, 11)
    assert observe(controller, model, 50).feedback[0].status == "EXPIRED"


@pytest.mark.parametrize(
    "changes",
    [
        dict(its_ack_delay_seconds=0),
        dict(its_delayed_ack_seconds=8),
        dict(its_ack_delay_seconds=6),
        dict(its_ack_timeout_seconds=5),
    ],
)
def test_ack_settings_reject_invalid_order(changes):
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        SimulationSettings(**changes)


def test_controller_can_be_imported_before_engine() -> None:
    """A fresh interpreter must not need the application to seed module imports."""
    import subprocess
    import sys

    result = subprocess.run(
        [sys.executable, "-c", "from greenwave.its.controller import SimulatedItsController"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def test_late_ack_cannot_activate_an_already_expired_hold() -> None:
    controller, model = setup(ItsScenario.DELAYED)
    controller.settings = SimulationSettings(its_delayed_ack_seconds=45, its_ack_timeout_seconds=50)
    controller.submit(request())
    update = observe(controller, model, 55)
    assert [f.status for f in update.feedback] == ["ACCEPTED", "EXPIRED"]
    assert all(r.state == "NORMAL" for r in update.intersection_runtimes)
