"""Ambulance motion along the route for one simulated second (D13)."""

from dataclasses import replace
from math import inf

from greenwave.schemas import GreenWaveMode
from greenwave.simulation.corridor import route_runtimes
from greenwave.simulation.route_model import RouteIntersection, RouteModel
from greenwave.simulation.route_track import RouteTrack
from greenwave.simulation.state import EngineState
from greenwave.simulation_settings import SimulationSettings

_TIME_EPSILON_S = 1e-9
_DISTANCE_EPSILON_M = 1e-9


def next_stop(
    route_model: RouteModel, state: EngineState, distance_m: float
) -> RouteIntersection | None:
    """The first unpassed intersection whose first stop line is strictly ahead."""
    return next(
        (
            item
            for item, runtime in route_runtimes(route_model, state)
            if not runtime.passed and item.first_stop_line_m > distance_m
        ),
        None,
    )


def move_one_second(
    state: EngineState,
    track: RouteTrack,
    route_model: RouteModel,
    settings: SimulationSettings,
    green_wave_mode: GreenWaveMode,
    traffic_density_multiplier: float,
) -> tuple[EngineState, float]:
    """Spend one simulated second; return the new state and the distance actually driven.

    The ambulance drives at the speed of whichever edge it is on, carrying the rest of the
    second across edge ends; a dwell may start and end mid-second. Arrival is recorded to the
    fraction of a second. At each first stop line, ER Green Wave enabled dwells ``D_min`` (so the
    trip time equals ``T_greenwave``); disabled dwells the standard clearance and then drives the
    controlled-crossing distance capped at each edge's ordinary speed limit, across edge ends.
    Open-road motion is the same in both modes.
    """
    now, tick = state.simulated_time_s + 1, state.tick + 1
    if state.arrived:
        return replace(state, simulated_time_s=now, tick=tick), 0.0
    budget = 1.0
    distance = state.distance_travelled_m
    dwell, dwelling = state.dwell_remaining_s, state.dwelling_intersection_id
    capped = state.speed_limited_remaining_m
    arrived_at: float | None = None
    while budget > _TIME_EPSILON_S:
        if dwell > 0:
            spent = min(dwell, budget)
            dwell, budget = dwell - spent, budget - spent
            if dwell <= _TIME_EPSILON_S:
                dwell, dwelling = 0.0, None
            continue
        edge = track.edge_at(distance)
        speed = track.speed_mps(edge)
        if capped > 0:
            speed = min(speed, track.speed_limit_mps(edge))
        stop = next_stop(route_model, state, distance)
        limit = min(
            track.edge_end_m(edge),
            track.total_distance_m,
            inf if stop is None else stop.first_stop_line_m,
            distance + capped if capped > 0 else inf,
        )
        needed = (limit - distance) / speed
        if needed > budget:
            capped = max(0.0, capped - speed * budget)
            distance += speed * budget
            break
        capped = max(0.0, capped - (limit - distance))
        if capped <= _DISTANCE_EPSILON_M:
            capped = 0.0
        distance, budget = limit, budget - needed
        if distance >= track.total_distance_m:
            arrived_at = state.simulated_time_s + (1.0 - budget)
            break
        if stop is not None and distance == stop.first_stop_line_m:
            if green_wave_mode is GreenWaveMode.ENABLED:
                dwell = settings.min_intersection_delay_seconds
            else:
                dwell = (
                    settings.standard_clearance_factor
                    * stop.delay_seconds
                    * traffic_density_multiplier
                )
                capped = settings.standard_crossing_distance_m
            dwelling = stop.id if dwell > 0 else None
    moved = distance - state.distance_travelled_m
    return replace(
        state,
        simulated_time_s=now,
        tick=tick,
        distance_travelled_m=distance,
        current_edge_index=track.edge_at(distance),
        dwell_remaining_s=dwell,
        dwelling_intersection_id=dwelling,
        speed_limited_remaining_m=0.0 if arrived_at is not None else capped,
        v_avg_meters_per_second=max(
            settings.speed_floor_meters_per_second,
            settings.speed_ema_alpha * moved
            + (1 - settings.speed_ema_alpha) * state.v_avg_meters_per_second,
        ),
        arrived=arrived_at is not None,
        arrived_at_s=arrived_at,
    ), (0.0 if arrived_at is not None else moved)
