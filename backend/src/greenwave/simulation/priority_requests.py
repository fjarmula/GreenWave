"""Bounded per-route request selection and validated monotonic feedback ledger."""

from greenwave.its.models import ItsRequest
from greenwave.schemas import ItsFeedbackEvent, ItsRequestSnapshot, ItsRequestStatus
from greenwave.simulation.corridor import time_to_intersection
from greenwave.simulation.route_model import RouteModel
from greenwave.simulation.state import EngineState
from greenwave.simulation_settings import SimulationSettings

_TRANSITIONS = {
    ItsRequestStatus.REQUESTED: {
        ItsRequestStatus.ACCEPTED,
        ItsRequestStatus.REJECTED,
        ItsRequestStatus.TIMED_OUT,
        ItsRequestStatus.RELEASED,
    },
    ItsRequestStatus.ACCEPTED: {ItsRequestStatus.RELEASED, ItsRequestStatus.EXPIRED},
}


class PriorityRequestLedger:
    def __init__(self, simulation_id: str) -> None:
        self.simulation_id = simulation_id
        self.requests: dict[str, ItsRequest] = {}
        self._snapshots: dict[str, ItsRequestSnapshot] = {}
        self.cascade_flags: dict[str, bool] = {}
        self.last_sequence = 0

    def select(
        self, route_model: RouteModel, state: EngineState, settings: SimulationSettings
    ) -> tuple[str, ...]:
        used = {i for r in self.requests.values() for i in r.payload.intersections_group}
        own = [
            i.id
            for i, runtime in zip(
                route_model.intersections, state.intersection_runtimes, strict=True
            )
            if i.id not in used
            and not runtime.passed
            and (tti := time_to_intersection(i.first_stop_line_m, runtime, state)) is not None
            and tti <= settings.clearing_tti_seconds
        ]
        selected = list(own)
        for source in own:
            for target in route_model.cascade_targets(source):
                runtime = state.intersection_runtimes[
                    next(n for n, i in enumerate(route_model.intersections) if i.id == target)
                ]
                if target not in used and target not in selected and not runtime.passed:
                    selected.append(target)
        self.cascade_flags = {i: i not in own for i in selected}
        return tuple(selected)

    def record(self, request: ItsRequest) -> None:
        if request.simulation_id != self.simulation_id:
            raise ValueError("wrong simulation")
        if request.message_id in self.requests:
            if request != self.requests[request.message_id]:
                raise ValueError("conflicting duplicate request")
            return
        self.requests[request.message_id] = request
        self._snapshots[request.message_id] = ItsRequestSnapshot(
            message_id=request.message_id,
            intersections_group=request.payload.intersections_group,
            status=ItsRequestStatus.REQUESTED,
            submitted_at_simulated_sec=request.submitted_at_simulated_sec,
            last_updated_at_simulated_sec=request.submitted_at_simulated_sec,
        )

    def apply(self, feedback: ItsFeedbackEvent) -> bool:
        old = self._snapshots.get(feedback.request_message_id)
        if (
            old is None
            or feedback.simulation_id != self.simulation_id
            or feedback.feedback_sequence <= self.last_sequence
            or feedback.intersections_group != old.intersections_group
            or feedback.status not in _TRANSITIONS.get(old.status, set())
            or feedback.observed_at_simulated_sec < old.last_updated_at_simulated_sec
        ):
            return False
        data = old.model_dump() | dict(
            status=feedback.status,
            reason=feedback.reason,
            last_updated_at_simulated_sec=feedback.observed_at_simulated_sec,
            last_feedback_sequence=feedback.feedback_sequence,
        )
        if feedback.status is ItsRequestStatus.ACCEPTED:
            data["acknowledged_at_simulated_sec"] = feedback.observed_at_simulated_sec
        self._snapshots[old.message_id] = ItsRequestSnapshot.model_validate(data)
        self.last_sequence = feedback.feedback_sequence
        return True

    def snapshots(self) -> tuple[ItsRequestSnapshot, ...]:
        return tuple(self._snapshots.values())
