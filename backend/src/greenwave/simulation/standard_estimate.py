"""Exact pre-run standard-traffic estimate: a dry run of disabled motion (spec D4)."""

from bisect import bisect_left
from dataclasses import dataclass
from math import ceil, inf

from greenwave.its.controller import SimulatedItsController
from greenwave.routing.planner import PlannedRoute
from greenwave.schemas import GreenWaveMode, ItsScenario
from greenwave.simulation.motion import move_one_second
from greenwave.simulation.route_model import RouteModel
from greenwave.simulation.route_track import RouteTrack
from greenwave.simulation.state import initial_engine_state
from greenwave.simulation_settings import SimulationSettings


@dataclass(frozen=True, slots=True)
class StandardRunProfile:
    """Disabled motion sampled each second, with an exact final arrival sample."""

    distances_m: tuple[float, ...]
    seconds: tuple[float, ...]

    @property
    def total_seconds(self) -> float:
        return self.seconds[-1]

    def seconds_at(self, distance_m: float) -> float:
        """Time to the same route position; interpolate within a one-second sample."""
        if distance_m <= 0:
            return 0.0
        right = bisect_left(self.distances_m, distance_m)
        if right >= len(self.distances_m):
            return self.total_seconds
        left = right - 1
        fraction = (distance_m - self.distances_m[left]) / (
            self.distances_m[right] - self.distances_m[left]
        )
        return self.seconds[left] + fraction * (self.seconds[right] - self.seconds[left])


def standard_run_seconds(
    route: PlannedRoute,
    route_model: RouteModel,
    density: float,
    settings: SimulationSettings,
) -> float:
    """Exact pre-run standard arrival time, shared with ranking and the start response."""
    return standard_run_profile(route, route_model, density, settings).total_seconds


def standard_run_profile(
    route: PlannedRoute,
    route_model: RouteModel,
    density: float,
    settings: SimulationSettings,
) -> StandardRunProfile:
    """Simulated seconds a run with ER Green Wave disabled takes to arrive.

    Disabled motion never requests priority, so its every stop-line decision comes from the
    ordinary programme, which is deterministic from t = 0: this drives the same
    :func:`move_one_second` as the engine, against an untouched controller's ordinary queries,
    and records the engine's ``arrived_at_s`` exactly.
    """
    track = RouteTrack.from_route(route, settings)
    controller = SimulatedItsController(route_model, settings, ItsScenario.NOMINAL)
    state = initial_engine_state(
        len(route_model.intersections),
        max(track.speed_mps(0), settings.speed_floor_meters_per_second),
    )
    stop_lines = sum(len(item.route_stop_lines_m) for item in route_model.intersections)
    bound_s = _slowest_arrival_s(track, stop_lines, settings)
    if bound_s == inf:
        raise RuntimeError("standard run cannot arrive: a route edge has no positive speed")
    max_iterations = ceil(bound_s) + 1
    distances = [0.0]
    seconds = [0.0]
    for _ in range(max_iterations):
        state, _moved = move_one_second(
            state,
            track,
            route_model,
            settings,
            GreenWaveMode.DISABLED,
            density,
            controller.ordinary_route_color_at,
            route_seconds_until_green=controller.ordinary_route_seconds_until_green,
        )
        distances.append(state.distance_travelled_m)
        seconds.append(
            state.arrived_at_s if state.arrived_at_s is not None else float(state.simulated_time_s)
        )
        if state.arrived_at_s is not None:
            controller.close()
            return StandardRunProfile(tuple(distances), tuple(seconds))
    raise RuntimeError(f"standard run did not arrive within {max_iterations} simulated seconds")


def _slowest_arrival_s(track: RouteTrack, stop_lines: int, settings: SimulationSettings) -> float:
    """An upper bound on the disabled arrival: every edge at its ordinary limit (a crossing never
    drives faster than its ambulance speed or slower than that limit plus its extra time), plus
    the capped extra time at every stop line and an upper bound on common delay
    (one common budget per line overestimates multi-line intersections).
    Infinite when an edge cannot be driven."""
    seconds = float(stop_lines) * (
        settings.standard_max_red_loss_seconds + settings.min_intersection_delay_seconds
    )
    start = 0.0
    for edge in range(track.edge_count):
        end = track.edge_end_m(edge)
        speed = min(track.speed_mps(edge), track.speed_limit_mps(edge))
        seconds += (end - start) / speed if speed > 0 else inf
        start = end
    return seconds
