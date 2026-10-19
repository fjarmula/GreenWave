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
    IntersectionState,
    ItsDispatchEvent,
    SimulationCompletedEvent,
    SimulationTickEvent,
)
from greenwave.simulation.corridor import advance_corridor
from greenwave.simulation.dispatch import build_dispatch_payload, dispatch_event
from greenwave.simulation.motion import move_one_second
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
    ) -> None:
        self.simulation_id, self.route, self.route_model = simulation_id, route, route_model
        self.traffic_density_multiplier = traffic_density_multiplier
        self.estimates, self.settings, self.gateway = estimates, settings, gateway
        self._track = RouteTrack.from_route(route, settings)

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
        """One simulated second: move, advance signals, dispatch, then report."""
        if state.completed:
            return state, []
        state, actual_speed = move_one_second(state, self._track, self.route_model, self.settings)
        corridor = advance_corridor(self.route_model, state, self.settings)
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
        events.append(
            tick_event(self.simulation_id, state, wall_clock_utc, ambulance, kpi, intersections)
        )
        if state.arrived and all(
            item.state is IntersectionState.NORMAL for item in state.intersection_runtimes
        ):
            state = replace(state, completed=True)
            events.append(completed_event(self.simulation_id, state, wall_clock_utc, kpi))
        return state, events

    def run_tick(
        self, state: EngineState, wall_clock_utc: datetime, playback_speed: int
    ) -> tuple[EngineState, list[EngineEvent]]:
        """``playback_speed`` steps; keep every dispatch, only the last tick, completion last."""
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

    def _dispatch(
        self, state: EngineState, ids: tuple[str, ...], now: datetime
    ) -> tuple[EngineState, ItsDispatchEvent]:
        payload = build_dispatch_payload(self.route_model, state, ids, now, self.settings)
        self.gateway.dispatch(payload)
        state = replace(state, message_sequence=state.message_sequence + 1)
        return state, dispatch_event(self.simulation_id, state, payload, now)
