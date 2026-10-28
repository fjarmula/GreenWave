from collections.abc import Mapping

from greenwave.simulation.corridor import time_to_intersection
from greenwave.simulation.route_model import RouteIntersection, RouteModel
from greenwave.simulation.state import EngineState
from greenwave.simulation.state_machine import IntersectionRuntime


def _model(cascade_targets: Mapping[str, tuple[str, ...]]) -> RouteModel:
    return RouteModel(
        intersections=(
            RouteIntersection("A", 100.0, 100.0, 10.0),
            RouteIntersection("B", 200.0, 200.0, 10.0),
        ),
        _cascade_targets=cascade_targets,
    )


def _state(speed_mps: float) -> EngineState:
    return EngineState(
        simulated_time_s=0,
        distance_travelled_m=0.0,
        current_edge_index=0,
        dwell_remaining_s=0.0,
        dwelling_intersection_id=None,
        v_avg_meters_per_second=speed_mps,
        intersection_runtimes=(IntersectionRuntime(), IntersectionRuntime()),
        tick=0,
        message_sequence=0,
        arrived=False,
        completed=False,
    )


def test_passed_intersection_has_no_time_to_intersection() -> None:
    assert time_to_intersection(100.0, IntersectionRuntime(passed=True), _state(3.0)) is None
    assert time_to_intersection(100.0, IntersectionRuntime(), _state(4.0)) == 25.0
