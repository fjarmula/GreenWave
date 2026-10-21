"""Deterministic one-second simulation engine.

State transitions depend only on the supplied state and clock; the one side effect is handing each
ITS dispatch payload to the injected (simulated) gateway.
"""

from dataclasses import replace
from datetime import datetime

from greenwave.its import ItsGateway
from greenwave.routing.estimates import Estimates
from greenwave.routing.planner import PlannedRoute
from greenwave.schemas import (
    GreenWaveMode,
    IntersectionState,
    ItsDispatchEvent,
    SimulationCompletedEvent,
    SimulationTickEvent,
    VehicleType,
)
from greenwave.simulation.corridor import advance_corridor
from greenwave.simulation.dispatch import build_dispatch_payload, dispatch_event
from greenwave.simulation.motion import move_one_second
from greenwave.simulation.phases import (
    advance_signal_phases,
    route_lights_shown_green,
    route_movement_color_at,
)
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

EngineEvent = SimulationTickEvent | ItsDispatchEvent | SimulationCompletedEvent


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
        gateway: ItsGateway,
        vehicle_type: VehicleType = VehicleType.AMBULANCE,
        green_wave_mode: GreenWaveMode = GreenWaveMode.ENABLED,
    ) -> None:
        self.simulation_id, self.route, self.route_model = simulation_id, route, route_model
        self.vehicle_type, self.green_wave_mode = vehicle_type, green_wave_mode
        self.traffic_density_multiplier = traffic_density_multiplier
        self.estimates, self.settings, self.gateway = estimates, settings, gateway
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
        """One simulated second: move, advance signals, dispatch, then report.

        Motion and the reported phases read the same simulated programme
        (:func:`route_movement_color_at` mid-tick, :func:`advance_signal_phases` at tick end).
        Every step is streamed as its own tick, and the map animates the marker across it under
        that tick's lights, so priority is released only for intersections passed before it.
        """
        if state.completed:
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
            lambda intersection_id, at_s: route_movement_color_at(
                self.route_model, before, intersection_id, at_s, self.settings
            ),
            lambda distance_m: route_lights_shown_green(
                self.route_model,
                before,
                self._stop_line_ids.get(distance_m, set()),
                self.settings,
            ),
        )
        corridor = advance_corridor(
            self.route_model,
            state,
            self.settings,
            priority_enabled=self.green_wave_mode is GreenWaveMode.ENABLED,
            released_before_m=released_before_m,
        )
        state = replace(state, intersection_runtimes=corridor.runtimes)
        events: list[EngineEvent] = []
        if corridor.entered_clearing:
            state, dispatch = self._dispatch(state, corridor.entered_clearing, wall_clock_utc)
            events.append(dispatch)
        kpi = kpi_metrics(
            self.route, self.route_model, state, self.traffic_density_multiplier, self.settings
        )
        ambulance = ambulance_telemetry(self.simulation_id, state, actual_speed, self._track)
        intersections = intersection_telemetry(self.route_model, state)
        heads, phases = advance_signal_phases(self.route_model, state, self.settings)
        state = replace(state, signal_heads=heads)
        events.append(
            tick_event(
                self.simulation_id, state, wall_clock_utc, ambulance, kpi, intersections, phases
            )
        )
        if state.arrived and all(
            item.state is IntersectionState.NORMAL for item in state.intersection_runtimes
        ):
            state = replace(state, completed=True)
            events.append(completed_event(self.simulation_id, state, wall_clock_utc, kpi))
        return state, events

    def _dispatch(
        self, state: EngineState, ids: tuple[str, ...], now: datetime
    ) -> tuple[EngineState, ItsDispatchEvent]:
        payload = build_dispatch_payload(
            self.route_model, state, ids, now, self.settings, self.vehicle_type
        )
        self.gateway.dispatch(payload)
        state = replace(state, message_sequence=state.message_sequence + 1)
        return state, dispatch_event(self.simulation_id, state, payload, now)
