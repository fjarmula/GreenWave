from collections.abc import Mapping

from greenwave.schemas import IntersectionState
from greenwave.simulation.corridor import advance_corridor, time_to_intersection
from greenwave.simulation.route_model import RouteIntersection, RouteModel
from greenwave.simulation.state import EngineState
from greenwave.simulation.state_machine import IntersectionRuntime
from greenwave.simulation_settings import SimulationSettings


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


def test_cascade_target_enters_clearing_after_its_source() -> None:
    # 3 m/s: A is 33 s away (inside the 40 s window), B is 67 s away (outside it).
    advance = advance_corridor(_model({"A": ("B",)}), _state(3.0), SimulationSettings())

    assert advance.entered_clearing == ("A", "B")
    assert advance.runtimes[1].state is IntersectionState.CLEARING
    assert advance.runtimes[1].is_cascade


def test_no_cascade_without_targets() -> None:
    advance = advance_corridor(_model({}), _state(3.0), SimulationSettings())

    assert advance.entered_clearing == ("A",)
    assert advance.runtimes[1].state is IntersectionState.NORMAL


def test_passed_intersection_has_no_time_to_intersection() -> None:
    assert time_to_intersection(100.0, IntersectionRuntime(passed=True), _state(3.0)) is None
    assert time_to_intersection(100.0, IntersectionRuntime(), _state(4.0)) == 25.0
