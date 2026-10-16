"""Pure deterministic one-second simulation engine."""

from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from math import ceil

from greenwave.its import ItsGateway
from greenwave.routing.estimates import Estimates
from greenwave.routing.planner import PlannedRoute, ambulance_speed_kmh
from greenwave.schemas import (
    AmbulanceStatus,
    AmbulanceTelemetry,
    IntersectionState,
    IntersectionTelemetry,
    ItsDispatchEvent,
    ItsDispatchPayload,
    KpiMetrics,
    Position,
    SimulationCompletedEvent,
    SimulationTickEvent,
)
from greenwave.simulation.route_model import RouteModel
from greenwave.simulation.state_machine import IntersectionRuntime, Transition, advance_intersection
from greenwave.simulation_settings import SimulationSettings

EngineEvent = SimulationTickEvent | ItsDispatchEvent | SimulationCompletedEvent


@dataclass(frozen=True, slots=True)
class EngineState:
    simulated_time_s: int
    distance_travelled_m: float
    current_edge_index: int
    dwell_remaining_s: int
    dwelling_intersection_id: str | None
    v_avg_meters_per_second: float
    intersection_runtimes: tuple[IntersectionRuntime, ...]
    tick: int
    message_sequence: int
    arrived: bool
    completed: bool


class SimulationEngine:
    """Configured engine. Its state transitions depend only on supplied state and clock."""

    def __init__(
        self,
        simulation_id: str,
        route: PlannedRoute,
        route_model: RouteModel,
        estimates: Estimates,
        settings: SimulationSettings,
        gateway: ItsGateway,
    ) -> None:
        self.simulation_id, self.route, self.route_model = simulation_id, route, route_model
        self.estimates, self.settings, self.gateway = estimates, settings, gateway

    def initial_state(self) -> EngineState:
        speed = self._speed(0)
        return EngineState(
            0,
            0.0,
            0,
            0,
            None,
            max(speed, self.settings.speed_floor_meters_per_second),
            tuple(IntersectionRuntime() for _ in self.route_model.intersections),
            0,
            0,
            False,
            False,
        )

    def step(
        self, state: EngineState, wall_clock_utc: datetime
    ) -> tuple[EngineState, list[EngineEvent]]:
        if state.completed:
            return state, []
        state, actual_speed = self._move(state)
        runtimes, clearing = self._advance_intersections(state)
        state = replace(state, intersection_runtimes=runtimes)
        events: list[EngineEvent] = []
        if clearing:
            state, dispatch = self._dispatch(state, clearing, wall_clock_utc)
            events.append(dispatch)
        kpi = self._kpi(state)
        events.append(
            SimulationTickEvent(
                schema_version="1.0",
                is_simulated=True,
                event_type="SIMULATION_TICK",
                simulation_id=self.simulation_id,
                tick=state.tick,
                timestamp=wall_clock_utc,
                ambulance=self._ambulance(state, actual_speed),
                kpi_metrics=kpi,
                intersections=self._telemetry(state),
            )
        )
        if state.arrived and all(
            item.state is IntersectionState.NORMAL for item in state.intersection_runtimes
        ):
            state = replace(state, completed=True)
            events.append(
                SimulationCompletedEvent(
                    schema_version="1.0",
                    is_simulated=True,
                    event_type="SIMULATION_COMPLETED",
                    simulation_id=self.simulation_id,
                    tick=state.tick,
                    timestamp=wall_clock_utc,
                    kpi_metrics=kpi,
                )
            )
        return state, events

    def run_tick(
        self, state: EngineState, wall_clock_utc: datetime, playback_speed: int
    ) -> tuple[EngineState, list[EngineEvent]]:
        retained: list[EngineEvent] = []
        final_tick: SimulationTickEvent | None = None
        for _ in range(playback_speed):
            state, events = self.step(state, wall_clock_utc)
            for event in events:
                if event.event_type == "SIMULATION_TICK":
                    final_tick = event
                else:
                    retained.append(event)
            if state.completed:
                break
        terminal = [event for event in retained if event.event_type == "SIMULATION_COMPLETED"]
        retained = [event for event in retained if event.event_type != "SIMULATION_COMPLETED"]
        if final_tick is not None:
            retained.append(final_tick)
        retained.extend(terminal)
        return state, retained

    def _move(self, state: EngineState) -> tuple[EngineState, float]:
        now, tick = state.simulated_time_s + 1, state.tick + 1
        if state.arrived:
            return replace(state, simulated_time_s=now, tick=tick), 0.0
        if state.dwell_remaining_s:
            return replace(
                state,
                simulated_time_s=now,
                tick=tick,
                dwell_remaining_s=state.dwell_remaining_s - 1,
                dwelling_intersection_id=None
                if state.dwell_remaining_s == 1
                else state.dwelling_intersection_id,
                v_avg_meters_per_second=max(
                    self.settings.speed_floor_meters_per_second,
                    (1 - self.settings.speed_ema_alpha) * state.v_avg_meters_per_second,
                ),
            ), 0.0
        speed, target = (
            self._speed(state.current_edge_index),
            min(
                self.route.total_distance_m,
                state.distance_travelled_m + self._speed(state.current_edge_index),
            ),
        )
        stop = next(
            (
                item
                for item, runtime in zip(
                    self.route_model.intersections, state.intersection_runtimes, strict=True
                )
                if not runtime.passed
                and state.distance_travelled_m < item.first_stop_line_m <= target
            ),
            None,
        )
        dwell, dwelling = (
            (0, None)
            if stop is None
            else (int(self.settings.min_intersection_delay_seconds), stop.id)
        )
        if stop is not None:
            target = stop.first_stop_line_m
        return replace(
            state,
            simulated_time_s=now,
            tick=tick,
            distance_travelled_m=target,
            current_edge_index=self._edge_at(target),
            dwell_remaining_s=dwell,
            dwelling_intersection_id=dwelling,
            v_avg_meters_per_second=max(
                self.settings.speed_floor_meters_per_second,
                self.settings.speed_ema_alpha * speed
                + (1 - self.settings.speed_ema_alpha) * state.v_avg_meters_per_second,
            ),
            arrived=target >= self.route.total_distance_m,
        ), (0.0 if target >= self.route.total_distance_m else speed)

    def _advance_intersections(
        self, state: EngineState
    ) -> tuple[tuple[IntersectionRuntime, ...], tuple[str, ...]]:
        advanced: list[IntersectionRuntime] = []
        own: list[str] = []
        new: list[str] = []
        for item, runtime in zip(
            self.route_model.intersections, state.intersection_runtimes, strict=True
        ):
            updated, transition = advance_intersection(
                runtime,
                self._tti(item.first_stop_line_m, runtime, state),
                item.last_stop_line_m - state.distance_travelled_m,
                float(state.simulated_time_s),
                False,
                self.settings,
            )
            advanced.append(updated)
            if transition is Transition.CLEARING:
                own.append(item.id)
                new.append(item.id)
        positions = {item.id: index for index, item in enumerate(self.route_model.intersections)}
        for source in own:
            for target_id in self.route_model.cascade_targets(source):
                index, item = (
                    positions[target_id],
                    self.route_model.intersections[positions[target_id]],
                )
                updated, transition = advance_intersection(
                    advanced[index],
                    self._tti(item.first_stop_line_m, advanced[index], state),
                    item.last_stop_line_m - state.distance_travelled_m,
                    float(state.simulated_time_s),
                    True,
                    self.settings,
                )
                advanced[index] = updated
                if transition is Transition.CLEARING:
                    new.append(target_id)
        return tuple(advanced), tuple(new)

    def _dispatch(
        self, state: EngineState, ids: tuple[str, ...], now: datetime
    ) -> tuple[EngineState, ItsDispatchEvent]:
        tti_by_id = {
            item.id: self._tti(item.first_stop_line_m, runtime, state) or 0.0
            for item, runtime in zip(
                self.route_model.intersections, state.intersection_runtimes, strict=True
            )
        }
        ttis = [tti_by_id[item] for item in ids]
        payload = ItsDispatchPayload(
            priority_level=1,
            vehicle_type="AMBULANCE",
            intersections_group=list(ids),
            action="FORCE_GREEN_PHASE",
            hold_duration_sec=max(
                self.settings.its_min_hold_seconds,
                ceil(max(ttis)) + self.settings.its_hold_buffer_seconds,
            ),
            expected_arrival_utc=now + timedelta(seconds=min(ttis)),
        )
        self.gateway.dispatch(payload)
        state = replace(state, message_sequence=state.message_sequence + 1)
        return state, ItsDispatchEvent(
            schema_version="1.0",
            is_simulated=True,
            event_type="ITS_DISPATCH",
            message_id=f"MSG-ITS-{state.message_sequence}",
            simulation_id=self.simulation_id,
            tick=state.tick,
            timestamp=now,
            system_source="ER_GREENWAVE_ENGINE",
            target_system="STeR_KRAKOW_ITS",
            payload=payload,
        )

    def _speed(self, index: int) -> float:
        return ambulance_speed_kmh(self.route.edge_speeds_kmh[index], self.settings) / 3.6

    def _edge_at(self, distance: float) -> int:
        return next(
            (
                i
                for i, start in enumerate(self.route.cumulative_m)
                if distance < start + self.route.edge_lengths_m[i]
            ),
            len(self.route.edge_lengths_m) - 1,
        )

    def _tti(self, stop: float, runtime: IntersectionRuntime, state: EngineState) -> float | None:
        return (
            None
            if runtime.passed
            else max(0.0, stop - state.distance_travelled_m) / state.v_avg_meters_per_second
        )

    def _ambulance(self, state: EngineState, speed: float) -> AmbulanceTelemetry:
        if state.arrived:
            status = AmbulanceStatus.ARRIVED
        elif state.dwell_remaining_s:
            status = AmbulanceStatus.CROSSING_INTERSECTION
        elif any(
            not r.passed
            and r.state in {IntersectionState.CLEARING, IntersectionState.PRIORITY_GREEN}
            for r in state.intersection_runtimes
        ):
            status = AmbulanceStatus.APPROACHING_INTERSECTION
        else:
            status = AmbulanceStatus.EN_ROUTE
        ratio = state.distance_travelled_m / self.route.total_distance_m
        a, b = self.route.polyline_wgs84[0], self.route.polyline_wgs84[-1]
        return AmbulanceTelemetry(
            id=self.simulation_id,
            position=Position(lat=a[1] + (b[1] - a[1]) * ratio, lng=a[0] + (b[0] - a[0]) * ratio),
            speed_kmh=speed * 3.6,
            status=status,
        )

    def _telemetry(self, state: EngineState) -> list[IntersectionTelemetry]:
        return [
            IntersectionTelemetry(
                id=item.id,
                name=None,
                state=runtime.state,
                is_cascade=runtime.is_cascade,
                tti_seconds=None
                if runtime.passed
                else round(self._tti(item.first_stop_line_m, runtime, state) or 0),
                is_active_corridor=runtime.state
                in {IntersectionState.CLEARING, IntersectionState.PRIORITY_GREEN},
            )
            for item, runtime in zip(
                self.route_model.intersections, state.intersection_runtimes, strict=True
            )
        ]

    def _kpi(self, state: EngineState) -> KpiMetrics:
        normal = sum(
            min(length, max(0.0, state.distance_travelled_m - start)) * 3.6 / speed
            for length, speed, start in zip(
                self.route.edge_lengths_m,
                self.route.edge_speeds_kmh,
                self.route.cumulative_m,
                strict=True,
            )
        )
        normal += sum(
            item.delay_seconds
            for item, runtime in zip(
                self.route_model.intersections, state.intersection_runtimes, strict=True
            )
            if runtime.passed
        )
        return KpiMetrics(
            current_time_saved_sec=round(normal - state.simulated_time_s),
            total_time_elapsed_sec=state.simulated_time_s,
        )
