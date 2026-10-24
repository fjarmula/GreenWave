"""The additive ITS contract cannot mistake dispatch for confirmation."""

import pytest
from pydantic import ValidationError

from greenwave.schemas import SimulationStartRequest, SimulationTickEvent
from greenwave.schemas.its import ItsFeedbackEvent, ItsRequestSnapshot


def test_legacy_defaults() -> None:
    request = SimulationStartRequest.model_validate(
        dict(
            simulation_id="s",
            origin=dict(lat=50, lng=20),
            destination=dict(lat=50, lng=20),
            traffic_density_multiplier=1,
            enable_cascade_mode=True,
        )
    )
    assert request.its_scenario == "NOMINAL"
    assert SimulationTickEvent.model_fields["its_requests"].default == []
    assert SimulationTickEvent.model_fields["its_observed_at_simulated_sec"].default is None


@pytest.mark.parametrize(
    "status,reason",
    [
        ("ACCEPTED", None),
        ("RELEASED", None),
        ("REJECTED", "CONTROLLER_REJECTED"),
        ("TIMED_OUT", "ACK_TIMEOUT"),
        ("EXPIRED", "HOLD_EXPIRED"),
    ],
)
def test_feedback_round_trip(status: str, reason: str | None) -> None:
    event = ItsFeedbackEvent.model_validate(
        dict(
            schema_version="1.0",
            is_simulated=True,
            event_type="ITS_FEEDBACK",
            simulation_id="s",
            tick=11,
            timestamp="2026-10-23T00:00:00Z",
            request_message_id="MSG-ITS-1",
            feedback_sequence=1,
            status=status,
            intersections_group=["I"],
            observed_at_simulated_sec=11,
            reason=reason,
        )
    )
    assert ItsFeedbackEvent.model_validate_json(event.model_dump_json()) == event
    for changes in [
        dict(feedback_sequence=0),
        dict(observed_at_simulated_sec=-1),
        dict(is_simulated=False),
        dict(status="REQUESTED"),
        dict(reason="HOLD_EXPIRED" if reason is None else None),
    ]:
        with pytest.raises(ValidationError):
            ItsFeedbackEvent.model_validate(event.model_dump() | changes)


def test_snapshot_rejects_invalid_lifecycle_metadata() -> None:
    requested = ItsRequestSnapshot(
        message_id="MSG-ITS-1",
        intersections_group=["I"],
        status="REQUESTED",
        submitted_at_simulated_sec=10,
        last_updated_at_simulated_sec=10,
    )
    assert requested.last_feedback_sequence == 0
    for changes in [
        dict(submitted_at_simulated_sec=-1),
        dict(status="ACCEPTED"),
        dict(reason="ACK_TIMEOUT"),
    ]:
        with pytest.raises(ValidationError):
            ItsRequestSnapshot.model_validate(requested.model_dump() | changes)
