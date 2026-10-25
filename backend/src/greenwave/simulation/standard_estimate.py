"""Exact pre-run standard-traffic estimate: a dry run of disabled motion (spec D4)."""

from math import ceil

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
    max_iterations = ceil(route.total_distance_m / settings.speed_floor_meters_per_second) + 10_000
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
