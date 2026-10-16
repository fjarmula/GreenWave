"""A deliberately in-memory gateway for simulated ITS dispatches."""

import logging
from collections import deque
from typing import Protocol

from greenwave.schemas import ItsDispatchPayload

logger = logging.getLogger(__name__)


class ItsGateway(Protocol):
    """Accept simulated ITS dispatch instructions without network side effects."""

    def dispatch(self, payload: ItsDispatchPayload) -> None:
        """Record one simulated dispatch."""


class MockItsGateway:
    """Bounded in-memory ITS gateway used by the simulation runtime."""

    def __init__(self, max_records: int = 128) -> None:
        if max_records < 1:
            raise ValueError("max_records must be at least one")
        self._records: deque[ItsDispatchPayload] = deque(maxlen=max_records)

    @property
    def records(self) -> tuple[ItsDispatchPayload, ...]:
        """Retained simulated dispatches, oldest first."""
        return tuple(self._records)

    def dispatch(self, payload: ItsDispatchPayload) -> None:
        self._records.append(payload)
        logger.info(
            "simulated_its_dispatch",
            extra={
                "intersections_group": payload.intersections_group,
                "hold_duration_sec": payload.hold_duration_sec,
            },
        )
