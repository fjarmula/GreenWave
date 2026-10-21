"""Ambulance motion along the route for one simulated second (D13)."""

from collections.abc import Callable
from dataclasses import replace
from math import inf

from greenwave.schemas import GreenWaveMode, SignalPhaseColor
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


def cautious_speed_mps(
    limit_mps: float, remaining_distance_m: float, remaining_extra_s: float
) -> float:
    """Constant speed that drives the rest of a crossing at ``limit_mps`` plus its extra time.

    The extra time is spread in proportion to distance, so this speed holds until the crossing
    ends or the speed limit changes; it is positive and never above ``limit_mps``.
    """
    return 1 / (1 / limit_mps + remaining_extra_s / remaining_distance_m)


def move_one_second(
    state: EngineState,
    track: RouteTrack,
    route_model: RouteModel,
    settings: SimulationSettings,
    green_wave_mode: GreenWaveMode,
    traffic_density_multiplier: float,
    route_movement_color_at: Callable[[str, float], SignalPhaseColor | None],
) -> tuple[EngineState, float]:
    """Spend one simulated second; return the new state and the distance actually driven.

    The ambulance drives at the speed of whichever edge it is on, carrying the rest of the
    second across edge ends; a dwell may start and end mid-second. Arrival is recorded to the
    fraction of a second. At each first stop line, ER Green Wave enabled dwells ``D_min`` (so the
    trip time equals ``T_greenwave``). Disabled asks ``route_movement_color_at`` for the route
    movement at the exact time it reaches the line: GREEN drives on; RED, YELLOW or an unknown
    movement (``None``) starts a controlled crossing of ``standard_crossing_distance_m``, rolled at
    no more than each edge's ordinary limit plus the standard cautious time spread over it, across
    edge ends. A later stop line replaces it. Open-road motion is the same in both modes.
    """
    now, tick = state.simulated_time_s + 1, state.tick + 1
    if state.arrived:
        return replace(state, simulated_time_s=now, tick=tick), 0.0
    budget = 1.0
    distance = state.distance_travelled_m
    dwell, dwelling = state.dwell_remaining_s, state.dwelling_intersection_id
    crossing, cautious = state.cautious_crossing_remaining_m, state.cautious_time_remaining_s
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
        if crossing > 0:
            limit_mps = min(speed, track.speed_limit_mps(edge))
            speed = cautious_speed_mps(limit_mps, crossing, cautious)
        stop = next_stop(route_model, state, distance)
        limit = min(
            track.edge_end_m(edge),
            track.total_distance_m,
            inf if stop is None else stop.first_stop_line_m,
            distance + crossing if crossing > 0 else inf,
        )
        step = min(limit - distance, speed * budget)
        if crossing > 0:
            cautious -= cautious * step / crossing
            crossing -= step
            if crossing <= _DISTANCE_EPSILON_M:
                crossing, cautious = 0.0, 0.0
        if speed * budget < limit - distance:
            distance += step
            break
        distance, budget = limit, budget - (limit - distance) / speed
        if distance >= track.total_distance_m:
            arrived_at = state.simulated_time_s + (1.0 - budget)
            break
        if stop is not None and distance == stop.first_stop_line_m:
            if green_wave_mode is GreenWaveMode.ENABLED:
                dwell = settings.min_intersection_delay_seconds
                dwelling = stop.id if dwell > 0 else None
            elif (
                route_movement_color_at(stop.id, state.simulated_time_s + (1.0 - budget))
                is SignalPhaseColor.GREEN
            ):
                crossing, cautious = 0.0, 0.0
            else:
                crossing = settings.standard_crossing_distance_m
                cautious = (
                    settings.standard_clearance_factor
                    * stop.delay_seconds
                    * traffic_density_multiplier
                )
    moved = distance - state.distance_travelled_m
    arrived = arrived_at is not None
    return replace(
        state,
        simulated_time_s=now,
        tick=tick,
        distance_travelled_m=distance,
        current_edge_index=track.edge_at(distance),
        dwell_remaining_s=dwell,
        dwelling_intersection_id=dwelling,
        cautious_crossing_remaining_m=0.0 if arrived else crossing,
        cautious_time_remaining_s=0.0 if arrived else cautious,
        v_avg_meters_per_second=max(
            settings.speed_floor_meters_per_second,
            settings.speed_ema_alpha * moved
            + (1 - settings.speed_ema_alpha) * state.v_avg_meters_per_second,
        ),
        arrived=arrived,
        arrived_at_s=arrived_at,
    ), moved
