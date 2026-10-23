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


def next_stop_line(
    route_model: RouteModel, state: EngineState, distance_m: float
) -> tuple[float, list[RouteIntersection]] | None:
    """The nearest route stop line strictly ahead of any unpassed intersection, and its owners."""
    lines = [
        (line_m, item)
        for item, runtime in route_runtimes(route_model, state)
        if not runtime.passed
        for line_m in item.route_stop_lines_m
        if line_m > distance_m
    ]
    if not lines:
        return None
    nearest = min(line_m for line_m, _ in lines)
    return nearest, [item for line_m, item in lines if line_m == nearest]


def cautious_speed_mps(
    limit_mps: float, remaining_distance_m: float, remaining_extra_s: float
) -> float:
    """Constant speed that drives the rest of a crossing at ``limit_mps`` plus its extra time.

    The extra time is spread in proportion to distance, so this speed holds until the crossing
    ends or the speed limit changes; it is positive and never above ``limit_mps``.
    """
    return 1 / (1 / limit_mps + remaining_extra_s / remaining_distance_m)


def greenwave_slowdown(
    item_line_m: float, window_start_m: float, speed_mps: float, settings: SimulationSettings
) -> float:
    """Metres over which ER Green Wave spreads ``D_min``, starting at ``window_start_m``.

    The whole window up to the stop line, extended past it when spreading ``D_min`` over the
    window alone would drop below the rolling floor. An ambulance already at or below the floor
    uses the window as-is.
    """
    window_m = item_line_m - window_start_m
    floor_mps = settings.greenwave_min_rolling_speed_kmh / 3.6
    if speed_mps <= floor_mps:
        return window_m
    needed_m = settings.min_intersection_delay_seconds / (1 / floor_mps - 1 / speed_mps)
    return max(window_m, needed_m)


def _window_start_m(
    route_model: RouteModel, stop: RouteIntersection, settings: SimulationSettings
) -> float:
    """Where ``stop``'s slowdown begins: its approach window, never before the previous line."""
    previous = max(
        (
            item.first_stop_line_m
            for item in route_model.intersections
            if item.first_stop_line_m < stop.first_stop_line_m
        ),
        default=0.0,
    )
    return max(previous, stop.first_stop_line_m - settings.greenwave_approach_distance_m)


def move_one_second(
    state: EngineState,
    track: RouteTrack,
    route_model: RouteModel,
    settings: SimulationSettings,
    green_wave_mode: GreenWaveMode,
    traffic_density_multiplier: float,
    route_movement_color_at: Callable[[str, float], SignalPhaseColor | None],
    may_leave_stop_line: Callable[[float], bool] = lambda _distance_m: True,
) -> tuple[EngineState, float]:
    """Spend one simulated second; return the new state and the distance actually driven.

    The ambulance drives at the speed of whichever edge it is on, carrying the rest of the
    second across edge ends. Arrival is recorded to the fraction of a second. ER Green Wave
    enabled spends each intersection's ``D_min`` as a rolling slowdown (so the trip time equals
    ``T_greenwave``): from ``greenwave_approach_distance_m`` before its first stop line (never
    before the previous one) it drives a constant reduced share of the ambulance speed that adds
    exactly ``D_min``, never below ``greenwave_min_rolling_speed_kmh``, continuing past the line
    when the window is too short. At the line it stays, ``dwelling_intersection_id`` set, until
    ``may_leave_stop_line(distance)`` says every light it faces there was shown green; a priority
    requested too late for its approach therefore holds the ambulance instead of showing it drive
    through red. Disabled asks ``route_movement_color_at`` for the route
    movement at the exact time it reaches each route stop line, including lines inside a junction:
    GREEN drives on; RED, YELLOW or an unknown movement (``None``) starts a controlled crossing of
    ``standard_crossing_distance_m``, rolled at no more than each edge's ordinary limit plus the
    standard cautious time spread over it, across edge ends. A later stop line replaces it.
    Open-road motion is the same in both modes.
    """
    now, tick = state.simulated_time_s + 1, state.tick + 1
    if state.arrived:
        return replace(state, simulated_time_s=now, tick=tick), 0.0
    budget = 1.0
    distance = state.distance_travelled_m
    dwell, dwelling = state.dwell_remaining_s, state.dwelling_intersection_id
    crossing, cautious = state.cautious_crossing_remaining_m, state.cautious_time_remaining_s
    slowdown = state.slowdown_intersection_id
    enabled = green_wave_mode is GreenWaveMode.ENABLED
    arrived_at: float | None = None
    while budget > _TIME_EPSILON_S:
        if dwell > 0:
            spent = min(dwell, budget)
            dwell, budget = dwell - spent, budget - spent
            if dwell <= _TIME_EPSILON_S:
                dwell = 0.0
            continue
        if dwelling is not None:
            if not may_leave_stop_line(distance):
                break  # held at the stop line for the rest of this second
            dwelling = None
        edge = track.edge_at(distance)
        speed = track.speed_mps(edge)
        window_start = inf
        if enabled:
            stop = next_stop(route_model, state, distance)
            line = None if stop is None else (stop.first_stop_line_m, [stop])
            if stop is not None and slowdown != stop.id:
                window_start = _window_start_m(route_model, stop, settings)
                if distance >= window_start:
                    window_start, slowdown = inf, stop.id
                    added = greenwave_slowdown(stop.first_stop_line_m, distance, speed, settings)
                    if added <= _DISTANCE_EPSILON_M:
                        # No room to roll (route starts on the line at or below the floor).
                        dwell, dwelling = settings.min_intersection_delay_seconds, stop.id
                        continue
                    # A slowdown still running past the previous line keeps its own extra time.
                    # It never runs past the destination, so every D_min is spent before
                    # arrival and the trip still takes T_greenwave.
                    crossing = min(crossing + added, track.total_distance_m - distance)
                    cautious += settings.min_intersection_delay_seconds
        else:
            line = next_stop_line(route_model, state, distance)
        if crossing > 0:
            limit_mps = speed if enabled else min(speed, track.speed_limit_mps(edge))
            speed = cautious_speed_mps(limit_mps, crossing, cautious)
        limit = min(
            track.edge_end_m(edge),
            track.total_distance_m,
            inf if line is None else line[0],
            window_start,
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
        if line is not None and distance == line[0]:
            if enabled:
                dwelling = line[1][0].id  # safety hold; the slowdown carries on past the line
                continue
            at_s = state.simulated_time_s + (1.0 - budget)
            facing = [
                item
                for item in line[1]
                if route_movement_color_at(item.id, at_s) is not SignalPhaseColor.GREEN
            ]
            crossing = settings.standard_crossing_distance_m if facing else 0.0
            cautious = (
                settings.standard_clearance_factor
                * max((item.delay_seconds for item in facing), default=0.0)
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
        slowdown_intersection_id=slowdown,
    ), moved
