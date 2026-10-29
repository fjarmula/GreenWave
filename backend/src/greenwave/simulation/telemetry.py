"""Project engine state onto the telemetry contract: ambulance, intersections, KPIs, events."""

from datetime import datetime

from greenwave.schemas import (
    AmbulanceStatus,
    AmbulanceTelemetry,
    CrossingStrategy,
    GreenWaveMode,
    IntersectionTelemetry,
    KpiMetrics,
    SignalPhaseIndicator,
    SimulationCompletedEvent,
    SimulationTickEvent,
    VehicleType,
)
from greenwave.simulation.corridor import ACTIVE_STATES, route_runtimes, time_to_intersection
from greenwave.simulation.route_model import RouteModel
from greenwave.simulation.route_track import RouteTrack
from greenwave.simulation.standard_estimate import StandardRunProfile
from greenwave.simulation.state import EngineState

# Simulated vehicle ids shown by the dashboard; the mock transport uses the same ones.
VEHICLE_IDS: dict[VehicleType, str] = {
    VehicleType.AMBULANCE: "AMB-KRA-01",
    VehicleType.FIRE_TRUCK: "FIRE-KRA-01",
    VehicleType.POLICE_CAR: "POL-KRA-01",
}


def ambulance_telemetry(
    vehicle_type: VehicleType, state: EngineState, speed_mps: float, track: RouteTrack
) -> AmbulanceTelemetry:
    return AmbulanceTelemetry(
        id=VEHICLE_IDS[vehicle_type],
        position=track.position_at(state.distance_travelled_m),
        speed_kmh=speed_mps * 3.6,
        status=_ambulance_status(state),
    )


def _ambulance_status(state: EngineState) -> AmbulanceStatus:
    if state.arrived:
        return AmbulanceStatus.ARRIVED
    if (
        state.dwell_remaining_s
        or state.dwelling_intersection_id
        or state.cautious_crossing_remaining_m
    ):
        return AmbulanceStatus.CROSSING_INTERSECTION
    if any(
        not runtime.passed and runtime.state in ACTIVE_STATES
        for runtime in state.intersection_runtimes
    ):
        return AmbulanceStatus.APPROACHING_INTERSECTION
    return AmbulanceStatus.EN_ROUTE


def intersection_telemetry(
    route_model: RouteModel, state: EngineState, mode: GreenWaveMode = GreenWaveMode.ENABLED
) -> list[IntersectionTelemetry]:
    def strategy(intersection_id: str) -> CrossingStrategy | None:
        if mode is GreenWaveMode.DISABLED:
            return None
        if intersection_id in state.fallback_intersection_ids:
            return CrossingStrategy.STANDARD_FALLBACK
        return CrossingStrategy.PRIORITY

    return [
        IntersectionTelemetry(
            id=item.id,
            name=item.name,
            state=runtime.state,
            is_cascade=runtime.is_cascade,
            tti_seconds=None
            if runtime.passed
            else round(time_to_intersection(item.first_stop_line_m, runtime, state) or 0),
            is_active_corridor=runtime.state in ACTIVE_STATES,
            crossing_strategy=strategy(item.id),
        )
        for item, runtime in route_runtimes(route_model, state)
    ]


def kpi_metrics(
    state: EngineState,
    standard_profile: StandardRunProfile,
    mode: GreenWaveMode,
) -> KpiMetrics:
    # Recovery after arrival cannot add trip time or erode the saving.
    elapsed = state.arrived_at_s if state.arrived_at_s is not None else state.simulated_time_s
    standard = standard_profile.seconds_at(state.distance_travelled_m)
    return KpiMetrics(
        current_time_saved_sec=0
        if mode is GreenWaveMode.DISABLED
        else round(standard) - round(elapsed),
        total_time_elapsed_sec=round(elapsed),
    )


def tick_event(
    simulation_id: str,
    state: EngineState,
    now: datetime,
    ambulance: AmbulanceTelemetry,
    kpi: KpiMetrics,
    intersections: list[IntersectionTelemetry],
    signal_phases: list[SignalPhaseIndicator],
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
        signal_phases=signal_phases,
    )


def completed_event(
    simulation_id: str,
    state: EngineState,
    now: datetime,
    kpi: KpiMetrics,
    fallback_intersection_ids: list[str] | None = None,
) -> SimulationCompletedEvent:
    return SimulationCompletedEvent(
        schema_version="1.0",
        is_simulated=True,
        event_type="SIMULATION_COMPLETED",
        simulation_id=simulation_id,
        tick=state.tick,
        timestamp=now,
        kpi_metrics=kpi,
        fallback_intersection_ids=fallback_intersection_ids or [],
    )
