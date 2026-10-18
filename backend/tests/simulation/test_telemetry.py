from dataclasses import replace

import pytest

from greenwave.routing.planner import PlannedRoute, SnappedRouteEndpoint
from greenwave.schemas import AmbulanceStatus, IntersectionState, Position
from greenwave.simulation.route_track import RouteTrack
from greenwave.simulation.state import EngineState
from greenwave.simulation.state_machine import IntersectionRuntime
from greenwave.simulation.telemetry import ambulance_telemetry
from greenwave.simulation_settings import SimulationSettings

_ACTIVE = IntersectionRuntime(state=IntersectionState.CLEARING)


def _track() -> RouteTrack:
    route = PlannedRoute(
        edge_ids=("only",),
        edge_lengths_m=(100.0,),
        edge_speeds_kmh=(36.0,),
        cumulative_m=(0.0,),
        total_distance_m=100.0,
        polyline_wgs84=[(19.0, 50.0), (19.1, 50.0)],
        origin_snap=SnappedRouteEndpoint("origin", Position(lat=50.0, lng=19.0), 0),
        destination_snap=SnappedRouteEndpoint("destination", Position(lat=50.0, lng=19.1), 0),
        stop_lines=(),
    )
    return RouteTrack.from_route(route, SimulationSettings())


_BASE = EngineState(
    simulated_time_s=5,
    distance_travelled_m=50.0,
    current_edge_index=0,
    dwell_remaining_s=0.0,
    dwelling_intersection_id=None,
    v_avg_meters_per_second=10.0,
    intersection_runtimes=(_ACTIVE,),
    tick=5,
    message_sequence=0,
    arrived=False,
    completed=False,
)


@pytest.mark.parametrize(
    ("state", "expected"),
    [
        (replace(_BASE, arrived=True, dwell_remaining_s=1.0), AmbulanceStatus.ARRIVED),
        (replace(_BASE, dwell_remaining_s=0.5), AmbulanceStatus.CROSSING_INTERSECTION),
        (_BASE, AmbulanceStatus.APPROACHING_INTERSECTION),
        (replace(_BASE, intersection_runtimes=(IntersectionRuntime(),)), AmbulanceStatus.EN_ROUTE),
    ],
)
def test_status_priority_arrived_then_crossing_then_approaching(
    state: EngineState, expected: AmbulanceStatus
) -> None:
    assert ambulance_telemetry("SIM-1", state, 10.0, _track()).status is expected
