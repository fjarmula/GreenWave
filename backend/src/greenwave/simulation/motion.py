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
    route_model: RouteModel,
    state: EngineState,
    distance_m: float,
    skip: frozenset[str] = frozenset(),
) -> RouteIntersection | None:
    """The first unpassed intersection not in ``skip`` whose first stop line is strictly ahead."""
    return next(
        (
            item
            for item, runtime in route_runtimes(route_model, state)
            if not runtime.passed and item.id not in skip and item.first_stop_line_m > distance_m
        ),
        None,
    )


def next_stop_line(
    route_model: RouteModel,
    state: EngineState,
    distance_m: float,
    only: frozenset[str] | None = None,
) -> tuple[float, list[RouteIntersection]] | None:
    """The nearest route stop line strictly ahead of any unpassed intersection, and its owners.

    ``only`` limits the owners to those intersections (every one when ``None``).
    """
    lines = [
        (line_m, item)
        for item, runtime in route_runtimes(route_model, state)
        if not runtime.passed and (only is None or item.id in only)
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
    """Metres over which both modes spread ``D_min``, starting at ``window_start_m``.

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


def standard_crossing(
    wait_s: float | None,
    delay_s: float,
    limit_mps: float,
    density: float,
    settings: SimulationSettings,
) -> tuple[float, float]:
    """``(length_m, extra_s)`` of a standard-traffic crossing at a red or yellow route line.

    The extra time scales with the wait for the ordinary green (``delay_s``, the intersection's
    normal delay, when the movement is unknown) and traffic density, capped at
    ``standard_max_red_loss_seconds``. The crossing lasts at least
    ``standard_crossing_distance_m`` and extends so the speed spreading the extra time over it
    never drops below ``standard_min_rolling_speed_kmh``. A limit already at or below that floor
    adds no extra time: the vehicle is already slow there.
    """
    floor_mps = settings.standard_min_rolling_speed_kmh / 3.6
    if limit_mps <= floor_mps:
        return settings.standard_crossing_distance_m, 0.0
    wait = delay_s if wait_s is None else wait_s
    extra_s = min(
        settings.standard_clearance_factor * wait * density,
        settings.standard_max_red_loss_seconds,
    )
    length_m = max(settings.standard_crossing_distance_m, extra_s / (1 / floor_mps - 1 / limit_mps))
    return length_m, extra_s


def _ordinary_limit_mps(track: RouteTrack, edge: int) -> float:
    return min(track.speed_mps(edge), track.speed_limit_mps(edge))


def _sized_standard_crossing(
    track: RouteTrack,
    line_m: float,
    wait_s: float | None,
    delay_s: float,
    density: float,
    settings: SimulationSettings,
) -> tuple[float, float]:
    """:func:`standard_crossing` sized from the lowest ordinary limit it covers past ``line_m``.

    The extra time is spread in proportion to distance, so the speed on every covered edge stays
    at or above the floor reached on the slowest one. A lower limit lengthens the crossing, which
    can cover a further edge; the limit only falls, and the route has finitely many edges. An
    edge at or below the floor past the line ends the crossing where it starts, with the extra
    time capped so the edges before it still hold the floor; only an edge at or below the floor
    at the line itself adds no extra time.
    """
    floor_mps = settings.standard_min_rolling_speed_kmh / 3.6
    first = track.edge_at(line_m)
    limit = _ordinary_limit_mps(track, first)
    while True:
        length, extra = standard_crossing(wait_s, delay_s, limit, density, settings)
        end_m = line_m + length
        edge, lowest = first, limit
        while edge + 1 < track.edge_count and track.edge_end_m(edge) < end_m:
            edge_limit = _ordinary_limit_mps(track, edge + 1)
            if limit > floor_mps and edge_limit <= floor_mps:
                slow_start_m = track.edge_end_m(edge)
                return slow_start_m - line_m, min(
                    extra, (slow_start_m - line_m) * (1 / floor_mps - 1 / lowest)
                )
            edge += 1
            lowest = min(lowest, edge_limit)
        if lowest >= limit:
            return length, extra
        limit = lowest


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


def _standard_decision(
    owners: list[RouteIntersection],
    at_s: float,
    distance_m: float,
    track: RouteTrack,
    density: float,
    settings: SimulationSettings,
    route_movement_color_at: Callable[[str, float], SignalPhaseColor | None],
    route_seconds_until_green: Callable[[str, float], float | None],
) -> tuple[float, float]:
    """Replace only the signal-dependent crossing; common D_min is independent.

    GREEN clears the previous cautious crossing. Other colours start a fresh one, including
    additional lines in the same intersection. Neither decision can erase common delay.
    """
    facing = [
        item
        for item in owners
        if route_movement_color_at(item.id, at_s) is not SignalPhaseColor.GREEN
    ]
    if not facing:
        return 0.0, 0.0
    waits = [
        item.delay_seconds if wait is None else wait
        for item in facing
        for wait in (route_seconds_until_green(item.id, at_s),)
    ]
    length, added = _sized_standard_crossing(
        track,
        distance_m,
        max(waits),
        max(item.delay_seconds for item in facing),
        density,
        settings,
    )
    return length, added


def move_one_second(
    state: EngineState,
    track: RouteTrack,
    route_model: RouteModel,
    settings: SimulationSettings,
    green_wave_mode: GreenWaveMode,
    traffic_density_multiplier: float,
    route_movement_color_at: Callable[[str, float], SignalPhaseColor | None],
    may_leave_stop_line: Callable[[float], bool] = lambda _distance_m: True,
    route_seconds_until_green: Callable[[str, float], float | None] = lambda _id, _t: None,
) -> tuple[EngineState, float]:
    """Spend one simulated second; return the new state and the distance actually driven.

    Both modes spend D_min once per unique controlled intersection as a common rolling
    approach slowdown, extended past the line and truncated at the destination while retaining
    its full time budget. Existing greenwave_* settings govern this common window for compatibility.
    Standard and STANDARD_FALLBACK additionally decide at every route stop line: green clears
    the signal-dependent crossing; red/yellow/unknown start a floored, capped cautious crossing.
    Common and cautious time-per-metre contributions add when windows overlap. Component floor
    sizing is unchanged; simultaneous contributions or destination truncation can reduce the
    combined speed further. Priority crossings still wait for confirmed green at the line.
    Arrival records fractional driving time and clears both rolling budgets; recovery is separate.
    """
    now, tick = state.simulated_time_s + 1, state.tick + 1
    if state.arrived:
        return replace(state, simulated_time_s=now, tick=tick), 0.0
    budget = 1.0
    distance = state.distance_travelled_m
    dwell, dwelling = state.dwell_remaining_s, state.dwelling_intersection_id
    crossing, cautious = state.cautious_crossing_remaining_m, state.cautious_time_remaining_s
    slowdown = state.slowdown_intersection_id
    standard_m = state.standard_crossing_remaining_m
    standard_s = state.standard_time_remaining_s
    slowed = state.slowdown_intersection_ids
    enabled = green_wave_mode is GreenWaveMode.ENABLED
    fallback = state.fallback_intersection_ids
    # Intersections crossed by standard rules: every one when disabled, failed ones when enabled.
    standard_ids = (
        frozenset(item.id for item in route_model.intersections)
        if not enabled
        else fallback & {item.id for item in route_model.intersections}
    )
    arrived_at: float | None = None

    def decide(owners: list[RouteIntersection]) -> None:
        nonlocal standard_m, standard_s
        standard_m, standard_s = _standard_decision(
            owners,
            state.simulated_time_s + (1.0 - budget),
            distance,
            track,
            traffic_density_multiplier,
            settings,
            route_movement_color_at,
            route_seconds_until_green,
        )

    if state.tick == 0:
        # Strictly-ahead line searches intentionally exclude a line exactly at the origin.
        at_origin = [
            item for item in route_model.intersections if distance in item.route_stop_lines_m
        ]
        ordinary = [item for item in at_origin if item.id in standard_ids]
        if ordinary:
            decide(ordinary)
        priority = [item for item in at_origin if item.id not in standard_ids]
        if priority:
            dwelling = priority[0].id

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
            if dwelling in fallback:
                # The request failed while held: cross this line by the ordinary programme now.
                decide(
                    [
                        item
                        for item, runtime in route_runtimes(route_model, state)
                        if not runtime.passed
                        and item.id in standard_ids
                        and distance in item.route_stop_lines_m
                    ]
                )
            dwelling = None
        edge = track.edge_at(distance)
        speed = track.speed_mps(edge)
        window_start = inf
        line = next_stop_line(route_model, state, distance, standard_ids) if standard_ids else None
        if enabled:
            stop = next_stop(route_model, state, distance, fallback)
            if stop is not None:
                if line is None or stop.first_stop_line_m < line[0]:
                    line = (stop.first_stop_line_m, [stop])
                elif stop.first_stop_line_m == line[0]:
                    line = (line[0], [stop, *line[1]])
        # Start each controlled intersection's common window once, in either mode and fallback.
        # Identity, rather than stop-line count or request status, prevents duplicate charging.
        common = next(
            (
                item
                for item in route_model.intersections
                if item.id not in slowed and item.first_stop_line_m >= distance
            ),
            None,
        )
        if common is not None:
            window_start = _window_start_m(route_model, common, settings)
            if distance >= window_start:
                window_start, slowdown = inf, common.id
                slowed = slowed | {common.id}
                added = greenwave_slowdown(common.first_stop_line_m, distance, speed, settings)
                if added <= _DISTANCE_EPSILON_M:
                    # A route starting on a line needs room past it to spend the common delay.
                    added = track.total_distance_m - distance
                crossing = min(crossing + added, track.total_distance_m - distance)
                cautious += settings.min_intersection_delay_seconds
                # Another intersection may start at this same position.
                continue
        # Add the two time-per-metre contributions independently. A cautious crossing may be
        # replaced by a later stop-line decision, but the common budget always survives.
        limit_mps = _ordinary_limit_mps(track, edge) if standard_m > 0 else speed
        seconds_per_m = 1 / limit_mps
        if crossing > 0:
            seconds_per_m += cautious / crossing
        if standard_m > 0:
            seconds_per_m += standard_s / standard_m
        speed = 1 / seconds_per_m
        limit = min(
            track.edge_end_m(edge),
            track.total_distance_m,
            inf if line is None else line[0],
            window_start,
            distance + crossing if crossing > 0 else inf,
            distance + standard_m if standard_m > 0 else inf,
        )
        step = min(limit - distance, speed * budget)
        if crossing > 0:
            cautious -= cautious * step / crossing
            crossing -= step
            if crossing <= _DISTANCE_EPSILON_M:
                crossing, cautious = 0.0, 0.0
        if standard_m > 0:
            standard_s -= standard_s * step / standard_m
            standard_m -= step
            if standard_m <= _DISTANCE_EPSILON_M:
                standard_m, standard_s = 0.0, 0.0
        if speed * budget < limit - distance:
            distance += step
            break
        distance, budget = limit, budget - (limit - distance) / speed
        if distance >= track.total_distance_m:
            arrived_at = state.simulated_time_s + (1.0 - budget)
            break
        if line is not None and distance == line[0]:
            owners = [item for item in line[1] if item.id in standard_ids]
            if owners:
                decide(owners)
            prioritised = [item for item in line[1] if item.id not in standard_ids]
            if prioritised:
                dwelling = prioritised[0].id  # safety hold; the slowdown carries on past the line
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
        crossing_is_standard=not arrived and standard_m > 0,
        standard_crossing_remaining_m=0.0 if arrived else standard_m,
        standard_time_remaining_s=0.0 if arrived else standard_s,
        slowdown_intersection_ids=slowed,
        v_avg_meters_per_second=max(
            settings.speed_floor_meters_per_second,
            settings.speed_ema_alpha * moved
            + (1 - settings.speed_ema_alpha) * state.v_avg_meters_per_second,
        ),
        arrived=arrived,
        arrived_at_s=arrived_at,
        slowdown_intersection_id=slowdown,
    ), moved
