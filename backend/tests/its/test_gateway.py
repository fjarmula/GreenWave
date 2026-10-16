from datetime import UTC, datetime

from greenwave.its.gateway import MockItsGateway
from greenwave.schemas import ItsDispatchPayload


def test_mock_gateway_retains_dispatch_payloads() -> None:
    gateway = MockItsGateway(max_records=2)
    payload = ItsDispatchPayload(
        priority_level=1,
        vehicle_type="AMBULANCE",
        intersections_group=["INT-1"],
        action="FORCE_GREEN_PHASE",
        hold_duration_sec=40,
        expected_arrival_utc=datetime(2026, 10, 16, tzinfo=UTC),
    )

    gateway.dispatch(payload)

    assert gateway.records == (payload,)
