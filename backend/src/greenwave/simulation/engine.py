"""One-second motion and request engine consuming separate simulated ITS reports.

The per-run controller owns decisions and signal phases. Submitting a request never
changes confirmed traffic state; the legacy gateway is an optional diagnostic sink.
"""

from dataclasses import replace
from datetime import datetime

from greenwave.its import ItsGateway
from greenwave.its.controller import SimulatedItsController
from greenwave.its.models import (
    ItsController,
    ItsIntersectionObservation,
    ItsObservation,
    ItsRequest,
)
from greenwave.routing.estimates import Estimates
from greenwave.routing.planner import PlannedRoute
from greenwave.schemas import (
    CancelReason,
    GreenWaveMode,
    IntersectionState,
    ItsDispatchEvent,
    ItsFeedbackEvent,
    ItsFeedbackReason,
    ItsRequestStatus,
    ItsScenario,
    SignalPhaseIndicator,
    SimulationCancelledEvent,
    SimulationCompletedEvent,
    SimulationTickEvent,
    VehicleType,
)
from greenwave.simulation.corridor import holding_priority, time_to_intersection
from greenwave.simulation.dispatch import build_dispatch_payload, dispatch_event
from greenwave.simulation.motion import move_one_second
from greenwave.simulation.priority_requests import PriorityRequestLedger
from greenwave.simulation.route_model import RouteModel
from greenwave.simulation.route_track import RouteTrack
from greenwave.simulation.state import EngineState
from greenwave.simulation.state_machine import IntersectionRuntime
from greenwave.simulation.telemetry import (
    ambulance_telemetry,
    completed_event,
    intersection_telemetry,
    kpi_metrics,
    tick_event,
)
from greenwave.simulation_settings import SimulationSettings

__all__ = ["EngineEvent", "EngineState", "SimulationEngine"]

EngineEvent = (
    SimulationTickEvent
    | ItsDispatchEvent
    | ItsFeedbackEvent
    | SimulationCompletedEvent
    | SimulationCancelledEvent
)


class SimulationEngine:
    """Configured engine for one planned route."""

    def __init__(
        self,
        simulation_id: str,
        route: PlannedRoute,
        route_model: RouteModel,
        estimates: Estimates,
        traffic_density_multiplier: float,
        settings: SimulationSettings,
        gateway: ItsGateway | None = None,
        vehicle_type: VehicleType = VehicleType.AMBULANCE,
        green_wave_mode: GreenWaveMode = GreenWaveMode.ENABLED,
        controller: ItsController | None = None,
        its_scenario: ItsScenario = ItsScenario.NOMINAL,
    ) -> None:
        self.simulation_id, self.route, self.route_model = simulation_id, route, route_model
        self.vehicle_type, self.green_wave_mode = vehicle_type, green_wave_mode
        self.traffic_density_multiplier = traffic_density_multiplier
        self.estimates, self.settings, self.gateway = estimates, settings, gateway
        self.controller = controller or SimulatedItsController(route_model, settings, its_scenario)
        self.ledger = PriorityRequestLedger(simulation_id)
        self._last_phases: tuple[SignalPhaseIndicator, ...] = ()
        self._closed = False
        self._track = RouteTrack.from_route(route, settings)
        # Intersections controlling each stop-line position, for the hold at the line.
        self._stop_line_ids: dict[float, set[str]] = {}
        for stop in route.stop_lines:
            self._stop_line_ids.setdefault(stop.distance_along_route_m, set()).add(
                stop.intersection_id
            )

    def initial_state(self) -> EngineState:
        return EngineState(
            simulated_time_s=0,
            distance_travelled_m=0.0,
            current_edge_index=0,
            dwell_remaining_s=0.0,
            dwelling_intersection_id=None,
            v_avg_meters_per_second=max(
                self._track.speed_mps(0), self.settings.speed_floor_meters_per_second
            ),
            intersection_runtimes=tuple(
                IntersectionRuntime() for _ in self.route_model.intersections
            ),
            tick=0,
            message_sequence=0,
            arrived=False,
            completed=False,
        )

    def step(
        self, state: EngineState, wall_clock_utc: datetime
    ) -> tuple[EngineState, list[EngineEvent]]:
        """Move under the previous report, observe, apply feedback, submit, then publish."""
        if state.completed or self._closed:
            return state, []
        before = state
        released_before_m = state.distance_travelled_m
        state, actual_speed = move_one_second(
            state,
            self._track,
            self.route_model,
            self.settings,
            self.green_wave_mode,
            self.traffic_density_multiplier,
            self.controller.ordinary_route_color_at,
            lambda distance_m: self._confirmed_green(before, distance_m),
            self.controller.ordinary_route_seconds_until_green,
        )
        observation = ItsObservation(
            float(state.simulated_time_s),
            tuple(
                ItsIntersectionObservation(
                    item.id,
                    time_to_intersection(item.first_stop_line_m, runtime, state),
                    runtime.passed
                    or (
                        item.last_stop_line_m <= state.distance_travelled_m
                        and not holding_priority(item, state, released_before_m)
                    ),
                )
                for item, runtime in zip(
                    self.route_model.intersections, state.intersection_runtimes, strict=True
                )
            ),
        )
        update = self.controller.advance(observation)
        self._last_phases = update.signal_phases
        state = replace(
            state,
            intersection_runtimes=update.intersection_runtimes,
            signal_heads=update.signal_heads,
        )
        events: list[EngineEvent] = []
        for decision in update.feedback:
            feedback = ItsFeedbackEvent(
                schema_version="1.0",
                is_simulated=True,
                event_type="ITS_FEEDBACK",
                simulation_id=decision.simulation_id,
                tick=state.tick,
                timestamp=wall_clock_utc,
                request_message_id=decision.request_message_id,
                feedback_sequence=decision.feedback_sequence,
                status=decision.status,
                intersections_group=list(decision.intersections_group),
                observed_at_simulated_sec=decision.observed_at_simulated_sec,
                reason=decision.reason,
            )
            if self.ledger.apply(feedback):
                events.append(feedback)
        for snapshot in self.ledger.snapshots():
            if (
                snapshot.status is ItsRequestStatus.REQUESTED
                and state.simulated_time_s
                >= snapshot.submitted_at_simulated_sec + self.settings.its_ack_timeout_seconds
            ):
                timeout = ItsFeedbackEvent(
                    schema_version="1.0",
                    is_simulated=True,
                    event_type="ITS_FEEDBACK",
                    simulation_id=self.simulation_id,
                    tick=state.tick,
                    timestamp=wall_clock_utc,
                    request_message_id=snapshot.message_id,
                    feedback_sequence=self.ledger.last_sequence + 1,
                    status=ItsRequestStatus.TIMED_OUT,
                    intersections_group=snapshot.intersections_group,
                    observed_at_simulated_sec=state.simulated_time_s,
                    reason=ItsFeedbackReason.ACK_TIMEOUT,
                )
                self.ledger.apply(timeout)
                events.append(timeout)
        failures = {
            ItsRequestStatus.REJECTED: CancelReason.ITS_REJECTED,
            ItsRequestStatus.TIMED_OUT: CancelReason.ITS_TIMEOUT,
            ItsRequestStatus.EXPIRED: CancelReason.ITS_HOLD_EXPIRED,
        }
        failure = next(
            (failures[r.status] for r in self.ledger.snapshots() if r.status in failures), None
        )
        if failure is None and self.green_wave_mode is GreenWaveMode.ENABLED:
            selected = self.ledger.select(self.route_model, state, self.settings)
            if selected:
                state, dispatch = self._dispatch(state, selected, wall_clock_utc)
                events.append(dispatch)
        kpi = kpi_metrics(
            self.route, self.route_model, state, self.traffic_density_multiplier, self.settings
        )
        ambulance = ambulance_telemetry(self.vehicle_type, state, actual_speed, self._track)
        intersections = intersection_telemetry(self.route_model, state)
        tick = tick_event(
            self.simulation_id,
            state,
            wall_clock_utc,
            ambulance,
            kpi,
            intersections,
            list(update.signal_phases),
        )
        tick.its_requests = list(self.ledger.snapshots())
        tick.its_observed_at_simulated_sec = update.observed_at_simulated_sec
        events.append(tick)
        if failure is not None:
            state = replace(state, completed=True)
            events.append(
                SimulationCancelledEvent(
                    schema_version="1.0",
                    is_simulated=True,
                    event_type="SIMULATION_CANCELLED",
                    simulation_id=self.simulation_id,
                    tick=state.tick,
                    timestamp=wall_clock_utc,
                    reason=failure,
                )
            )
            self.close()
            return state, events
        if state.arrived and all(
            item.state is IntersectionState.NORMAL for item in state.intersection_runtimes
        ):
            state = replace(state, completed=True)
            events.append(completed_event(self.simulation_id, state, wall_clock_utc, kpi))
            self.close()
        return state, events

    def _dispatch(
        self, state: EngineState, ids: tuple[str, ...], now: datetime
    ) -> tuple[EngineState, ItsDispatchEvent]:
        payload = build_dispatch_payload(
            self.route_model, self._track, state, ids, now, self.settings, self.vehicle_type
        )
        state = replace(state, message_sequence=state.message_sequence + 1)
        dispatch = dispatch_event(self.simulation_id, state, payload, now)
        request = ItsRequest(
            self.simulation_id,
            dispatch.message_id,
            state.simulated_time_s,
            payload,
            tuple(self.ledger.cascade_flags[i] for i in ids),
        )
        self.ledger.record(request)
        self.controller.submit(request)
        if self.gateway is not None:
            self.gateway.dispatch(payload)  # optional legacy diagnostic sink, never authoritative
        return state, dispatch

    def _confirmed_green(self, state: EngineState, distance_m: float) -> bool:
        ids = self._stop_line_ids.get(distance_m, set())
        for item in self.route_model.intersections:
            if item.id not in ids:
                continue
            # Missing supported route movements retain the existing conservative dwell model.
            phases = [
                p
                for p in self._last_phases
                if p.intersection_id == item.id
                and p.kind == "VEHICLE"
                and p.signal_key in item.route_signal_keys
            ]
            if phases and any(p.color != "GREEN" for p in phases):
                return False
        return True

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            self.controller.close()
