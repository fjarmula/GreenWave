"""Project engine state onto the telemetry contract: ambulance, intersections, KPIs, events."""

from datetime import datetime

from greenwave.routing.planner import PlannedRoute
from greenwave.schemas import (
    AmbulanceStatus,
    AmbulanceTelemetry,
    IntersectionTelemetry,
    KpiMetrics,
    SimulationCompletedEvent,
    SimulationTickEvent,
)
from greenwave.simulation.corridor import ACTIVE_STATES, route_runtimes, time_to_intersection
from greenwave.simulation.route_model import RouteModel
from greenwave.simulation.route_track import RouteTrack
from greenwave.simulation.state import EngineState


def ambulance_telemetry(
    simulation_id: str, state: EngineState, speed_mps: float, track: RouteTrack
) -> AmbulanceTelemetry:
    return AmbulanceTelemetry(
        id=simulation_id,
        position=track.position_at(state.distance_travelled_m),
        speed_kmh=speed_mps * 3.6,
        status=_ambulance_status(state),
    )


def _ambulance_status(state: EngineState) -> AmbulanceStatus:
    if state.arrived:
        return AmbulanceStatus.ARRIVED
    if state.dwell_remaining_s:
        return AmbulanceStatus.CROSSING_INTERSECTION
    if any(
        not runtime.passed and runtime.state in ACTIVE_STATES
        for runtime in state.intersection_runtimes
    ):
        return AmbulanceStatus.APPROACHING_INTERSECTION
    return AmbulanceStatus.EN_ROUTE


def intersection_telemetry(
    route_model: RouteModel, state: EngineState
) -> list[IntersectionTelemetry]:
    return [
        IntersectionTelemetry(
            id=item.id,
            name=None,
            state=runtime.state,
            is_cascade=runtime.is_cascade,
            tti_seconds=None
            if runtime.passed
            else round(time_to_intersection(item.first_stop_line_m, runtime, state) or 0),
            is_active_corridor=runtime.state in ACTIVE_STATES,
        )
        for item, runtime in route_runtimes(route_model, state)
    ]


def kpi_metrics(
    route: PlannedRoute,
    route_model: RouteModel,
    state: EngineState,
    traffic_density_multiplier: float,
) -> KpiMetrics:
    normal = sum(
        # Same normal-mode model as estimate_times: motion scales with traffic density.
        min(length, max(0.0, state.distance_travelled_m - start))
        * traffic_density_multiplier
        * 3.6
        / speed
        for length, speed, start in zip(
            route.edge_lengths_m, route.edge_speeds_kmh, route.cumulative_m, strict=True
        )
    )
    normal += sum(
        item.delay_seconds for item, runtime in route_runtimes(route_model, state) if runtime.passed
    )
    # The trip ends on arrival (D15); post-arrival recovery ticks (D19) do not add trip time.
    elapsed = state.arrived_at_s if state.arrived_at_s is not None else state.simulated_time_s
    return KpiMetrics(
        current_time_saved_sec=round(normal - elapsed),
        total_time_elapsed_sec=round(elapsed),
    )


def tick_event(
    simulation_id: str,
    state: EngineState,
    now: datetime,
    ambulance: AmbulanceTelemetry,
    kpi: KpiMetrics,
    intersections: list[IntersectionTelemetry],
) -> SimulationTickEvent:
    return SimulationTickEvent(
        schema_version="1.0",
        is_simulated=True,
        event_type="SIMULATION_TICK",
        simulation_id=simulation_id,
        tick=state.tick,
        timestamp=now,
        ambulance=ambulance,
        kpi_metrics=kpi,
        intersections=intersections,
    )


def completed_event(
    simulation_id: str, state: EngineState, now: datetime, kpi: KpiMetrics
) -> SimulationCompletedEvent:
    return SimulationCompletedEvent(
        schema_version="1.0",
        is_simulated=True,
        event_type="SIMULATION_COMPLETED",
        simulation_id=simulation_id,
        tick=state.tick,
        timestamp=now,
        kpi_metrics=kpi,
    )
