"""Exact pre-run standard-traffic estimate: a dry run of disabled motion (spec D4)."""

from math import ceil, inf

from greenwave.its.controller import SimulatedItsController
from greenwave.routing.planner import PlannedRoute
from greenwave.schemas import GreenWaveMode, ItsScenario
from greenwave.simulation.motion import move_one_second
from greenwave.simulation.route_model import RouteModel
from greenwave.simulation.route_track import RouteTrack
from greenwave.simulation.state import EngineState
from greenwave.simulation.state_machine import IntersectionRuntime
from greenwave.simulation_settings import SimulationSettings


def standard_run_seconds(
    route: PlannedRoute,
    route_model: RouteModel,
    density: float,
    settings: SimulationSettings,
) -> float:
    """Simulated seconds a run with ER Green Wave disabled takes to arrive.

    Disabled motion never requests priority, so its every stop-line decision comes from the
    ordinary programme, which is deterministic from t = 0: this drives the same
    :func:`move_one_second` as the engine, against an untouched controller's ordinary queries,
    and returns the engine's ``arrived_at_s`` exactly.
    """
    track = RouteTrack.from_route(route, settings)
    controller = SimulatedItsController(route_model, settings, ItsScenario.NOMINAL)
    state = EngineState(
        simulated_time_s=0,
        distance_travelled_m=0.0,
        current_edge_index=0,
        dwell_remaining_s=0.0,
        dwelling_intersection_id=None,
        v_avg_meters_per_second=max(track.speed_mps(0), settings.speed_floor_meters_per_second),
        intersection_runtimes=tuple(IntersectionRuntime() for _ in route_model.intersections),
        tick=0,
        message_sequence=0,
        arrived=False,
        completed=False,
    )
    stop_lines = sum(len(item.route_stop_lines_m) for item in route_model.intersections)
    bound_s = _slowest_arrival_s(track, stop_lines, settings)
    if bound_s == inf:
        raise RuntimeError("standard run cannot arrive: a route edge has no positive speed")
    max_iterations = ceil(bound_s) + 1
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
        if state.arrived_at_s is not None:
            return state.arrived_at_s
    raise RuntimeError(f"standard run did not arrive within {max_iterations} simulated seconds")


def _slowest_arrival_s(track: RouteTrack, stop_lines: int, settings: SimulationSettings) -> float:
    """An upper bound on the disabled arrival: every edge at its ordinary limit (a crossing never
    drives faster than its ambulance speed or slower than that limit plus its extra time), plus
    the capped extra time at every stop line. Infinite when an edge cannot be driven."""
    seconds = float(stop_lines) * settings.standard_max_red_loss_seconds
    start = 0.0
    for edge in range(track.edge_count):
        end = track.edge_end_m(edge)
        speed = min(track.speed_mps(edge), track.speed_limit_mps(edge))
        seconds += (end - start) / speed if speed > 0 else inf
        start = end
    return seconds
