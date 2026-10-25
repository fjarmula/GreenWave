"""Deterministic simulated ITS. Owns the sole runtime phase programme."""

from collections.abc import Callable
from dataclasses import replace

from greenwave.its.models import (
    ItsController,
    ItsControllerUpdate,
    ItsDecision,
    ItsObservation,
    ItsRequest,
)
from greenwave.schemas import (
    IntersectionState,
    ItsFeedbackReason,
    ItsRequestStatus,
    ItsScenario,
    SignalMovementKind,
    SignalPhaseColor,
)
from greenwave.simulation.phases import (
    advance_signal_phases,
    ordinary_seconds_until_green,
    route_movement_color_at,
)
from greenwave.simulation.route_model import RouteModel
from greenwave.simulation.state import EngineState
from greenwave.simulation.state_machine import IntersectionRuntime
from greenwave.simulation_settings import SimulationSettings


class SimulatedItsController:
    def __init__(
        self,
        route_model: RouteModel,
        settings: SimulationSettings,
        scenario: ItsScenario = ItsScenario.NOMINAL,
    ) -> None:
        self.model, self.settings, self.scenario = route_model, settings, scenario
        self._requests: dict[tuple[str, str], ItsRequest] = {}
        self._statuses: dict[tuple[str, str], ItsRequestStatus] = {}
        self._sequence = 0
        self._closed = False
        self._state = EngineState(
            0,
            0,
            0,
            0,
            None,
            5,
            tuple(IntersectionRuntime() for _ in route_model.intersections),
            0,
            0,
            False,
            False,
        )

    def submit(self, request: ItsRequest) -> None:
        if self._closed:
            return
        key = (request.simulation_id, request.message_id)
        if key in self._requests:
            if self._requests[key] != request:
                raise ValueError("conflicting duplicate ITS request")
            return
        ids = request.payload.intersections_group
        known = {i.id for i in self.model.intersections}
        used = {i for r in self._requests.values() for i in r.payload.intersections_group}
        if (
            len(ids) != len(set(ids))
            or not set(ids) <= known
            or set(ids) & used
            or len(ids) != len(request.cascade_flags)
        ):
            raise ValueError("invalid or already requested ITS targets")
        self._requests[key] = request
        self._statuses[key] = ItsRequestStatus.REQUESTED

    def advance(self, observation: ItsObservation) -> ItsControllerUpdate:
        now = observation.simulated_sec
        if self._closed:
            return ItsControllerUpdate(
                (), tuple(IntersectionRuntime() for _ in self.model.intersections), (), (), now
            )
        observations = {i.intersection_id: i for i in observation.intersections}
        if set(observations) != {i.id for i in self.model.intersections}:
            raise ValueError("controller requires complete route observations")
        feedback: list[ItsDecision] = []
        delay = (
            self.settings.its_delayed_ack_seconds
            if self.scenario is ItsScenario.DELAYED
            else self.settings.its_ack_delay_seconds
        )
        for key, request in self._requests.items():
            status = self._statuses[key]
            ids = request.payload.intersections_group
            passed = all(observations[i].passed for i in ids)
            next_status, reason = status, None
            if status in {ItsRequestStatus.REQUESTED, ItsRequestStatus.ACCEPTED} and passed:
                next_status = ItsRequestStatus.RELEASED
            elif (
                status is ItsRequestStatus.REQUESTED
                and self.scenario is not ItsScenario.NO_FEEDBACK
                and now >= request.submitted_at_simulated_sec + delay
            ):
                next_status = (
                    ItsRequestStatus.REJECTED
                    if self.scenario is ItsScenario.REJECTED
                    else ItsRequestStatus.ACCEPTED
                )
                reason = (
                    ItsFeedbackReason.CONTROLLER_REJECTED
                    if next_status is ItsRequestStatus.REJECTED
                    else None
                )
            elif (
                status is ItsRequestStatus.ACCEPTED
                and now >= request.submitted_at_simulated_sec + request.payload.hold_duration_sec
            ):
                next_status, reason = ItsRequestStatus.EXPIRED, ItsFeedbackReason.HOLD_EXPIRED
            if next_status != status:
                self._statuses[key] = next_status
                self._sequence += 1
                feedback.append(
                    ItsDecision(
                        request.simulation_id,
                        request.message_id,
                        self._sequence,
                        next_status,
                        tuple(ids),
                        now,
                        reason,
                    )
                )
        # A configured acknowledgement may arrive after a fixed hold deadline. Keep the
        # lifecycle explicit while never activating an already-expired target.
        for key, request in self._requests.items():
            if (
                self._statuses[key] is ItsRequestStatus.ACCEPTED
                and now >= request.submitted_at_simulated_sec + request.payload.hold_duration_sec
            ):
                self._statuses[key] = ItsRequestStatus.EXPIRED
                self._sequence += 1
                feedback.append(
                    ItsDecision(
                        request.simulation_id,
                        request.message_id,
                        self._sequence,
                        ItsRequestStatus.EXPIRED,
                        tuple(request.payload.intersections_group),
                        now,
                        ItsFeedbackReason.HOLD_EXPIRED,
                    )
                )
        accepted = {
            target: cascade
            for key, request in self._requests.items()
            if self._statuses[key] is ItsRequestStatus.ACCEPTED
            for target, cascade in zip(
                request.payload.intersections_group, request.cascade_flags, strict=True
            )
        }
        requested_targets = {
            i for r in self._requests.values() for i in r.payload.intersections_group
        }
        runtimes = []
        for item, runtime in zip(
            self.model.intersections, self._state.intersection_runtimes, strict=True
        ):
            obs = observations[item.id]
            if obs.passed and item.id not in requested_targets:
                runtime = IntersectionRuntime(passed=True)
            elif obs.passed:
                if not runtime.passed:
                    runtime = IntersectionRuntime(
                        IntersectionState.RECOVERY, runtime.is_cascade, now, True
                    )
                elif (
                    runtime.recovery_started_at_s is not None
                    and now - runtime.recovery_started_at_s >= self.settings.recovery_hold_seconds
                ):
                    runtime = replace(runtime, state=IntersectionState.NORMAL)
            elif item.id in accepted:
                eligible = (
                    obs.tti_seconds is not None
                    and obs.tti_seconds <= self.settings.priority_green_tti_seconds
                )
                runtime = IntersectionRuntime(
                    IntersectionState.PRIORITY_GREEN if eligible else IntersectionState.CLEARING,
                    accepted[item.id],
                )
            else:
                runtime = IntersectionRuntime()
            runtimes.append(runtime)
        target_state = replace(
            self._state, simulated_time_s=int(now), intersection_runtimes=tuple(runtimes)
        )
        heads, phases = advance_signal_phases(self.model, target_state, self.settings)
        reported = []
        for item, runtime in zip(self.model.intersections, runtimes, strict=True):
            route_phases = [
                p
                for p in phases
                if p.intersection_id == item.id
                and p.kind is SignalMovementKind.VEHICLE
                and p.signal_key in item.route_signal_keys
            ]
            if runtime.state is IntersectionState.PRIORITY_GREEN and (
                not route_phases or any(p.color is not SignalPhaseColor.GREEN for p in route_phases)
            ):
                runtime = replace(runtime, state=IntersectionState.CLEARING)
            reported.append(runtime)
        self._state = replace(
            target_state, signal_heads=heads, intersection_runtimes=tuple(reported)
        )
        return ItsControllerUpdate(tuple(feedback), tuple(reported), heads, tuple(phases), now)

    def ordinary_route_color_at(
        self, intersection_id: str, at_simulated_sec: float
    ) -> SignalPhaseColor | None:
        ordinary = replace(
            self._state,
            intersection_runtimes=tuple(IntersectionRuntime() for _ in self.model.intersections),
        )
        return route_movement_color_at(
            self.model, ordinary, intersection_id, at_simulated_sec, self.settings
        )

    def ordinary_route_seconds_until_green(
        self, intersection_id: str, at_simulated_sec: float
    ) -> float | None:
        return ordinary_seconds_until_green(
            self.model, intersection_id, at_simulated_sec, self.settings
        )

    def close(self) -> None:
        self._closed = True
        self._requests.clear()
        self._statuses.clear()


ItsControllerFactory = Callable[[RouteModel, SimulationSettings, ItsScenario], ItsController]
