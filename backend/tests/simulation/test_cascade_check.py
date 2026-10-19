from tests.support.route_fixtures import corridor_index, position_at

from greenwave.routing.planner import plan_route
from greenwave.simulation.cascade_check import CascadeMismatch, find_cascade_mismatches
from greenwave.simulation.route_model import build_route_model
from greenwave.simulation_settings import SimulationSettings

_SOURCE_EDGE = "corridor-a"
_TARGET_EDGE = "corridor-twin-1"


def _mismatches(candidate_m: float | None) -> tuple[CascadeMismatch, ...]:
    candidates = {} if candidate_m is None else {(_SOURCE_EDGE, _TARGET_EDGE): candidate_m}
    settings = SimulationSettings()
    index = corridor_index(neighbour_candidates=candidates)
    route = plan_route(index, position_at(7_422_000), position_at(7_422_850.02), settings)
    model = build_route_model(route, index, settings, cascade_enabled=True)
    return find_cascade_mismatches(route, model, index)


def test_no_mismatch_when_candidate_present_and_shorter() -> None:
    assert _mismatches(249.0) == ()


def test_mismatch_when_candidate_missing() -> None:
    (mismatch,) = _mismatches(None)

    assert (
        mismatch.source_id,
        mismatch.target_id,
        mismatch.source_edge_id,
        mismatch.target_edge_id,
        mismatch.along_route_m,
        mismatch.candidate_m,
    ) == ("INT-A", "INT-TWIN", _SOURCE_EDGE, _TARGET_EDGE, 250.0, None)


def test_mismatch_when_candidate_longer_than_along_route() -> None:
    (mismatch,) = _mismatches(250.02)

    assert mismatch.candidate_m == 250.02


def test_boundary_candidate_equal_plus_tolerance_is_ok() -> None:
    assert _mismatches(250.01) == ()
