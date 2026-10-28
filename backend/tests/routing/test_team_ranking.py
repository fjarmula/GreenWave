from dataclasses import replace
from datetime import datetime

import pytest
from tests.support.route_fixtures import corridor_index, corridor_stations, position_at

from greenwave.places.incident_area import IncidentArea
from greenwave.routing.errors import NoStationReachable
from greenwave.routing.network_index import RoutingIndex
from greenwave.routing.station_ranking import RankedStation, StationNode, build_station_nodes
from greenwave.routing.team_eligibility import Availability, Team
from greenwave.routing.team_ranking import (
    RankedTeam,
    TeamRanking,
    order_by_area_rule,
    rank_teams,
)
from greenwave.schemas import GreenWaveMode, Position, Station, VehicleType
from greenwave.simulation_settings import SimulationSettings

_X = 7_421_000.0
NOON = datetime(2026, 10, 27, 12, 0)
EVENING = datetime(2026, 10, 27, 21, 0)
PODGORZE = IncidentArea("1261049", "Podgórze", 13, "Podgórze")
OUT, IN = ("1261039",), ("1261049",)


def team(code: str, station_id: str, area: tuple[str, ...] = OUT, **fields: int) -> Team:
    base = Team(
        code, "P2", station_id, f"base of {station_id}", area, "1234567", 0, 1440, "01-01", "12-31"
    )
    return replace(base, **fields)


# --- order_by_area_rule (D4) on stub candidates ------------------------------------------------


def stub(code: str, greenwave: float, standard: float, in_area: bool | None) -> RankedTeam:
    station = Station(
        station_id=f"STN-A-{code[-4:]}",
        vehicle_type=VehicleType.AMBULANCE,
        source_kind="prm_base",
        name=code,
        position=Position(lat=50.0, lng=19.9),
    )
    ranked = RankedStation(station, greenwave, standard, 1000.0)
    return RankedTeam(ranked, team(code, station.station_id), True, in_area, ())


def first_and_rule(candidates: list[RankedTeam], mode: GreenWaveMode = GreenWaveMode.ENABLED):
    ordered, rule = order_by_area_rule(candidates, 60.0, mode)
    return ordered[0].team.team_code, rule


def test_in_area_within_margin_chosen() -> None:
    first, rule = first_and_rule(
        [stub("K01 0001", 100, 150, False), stub("K01 0002", 140, 190, True)]
    )

    assert first == "K01 0002"
    assert rule.reason == "IN_AREA_WITHIN_MARGIN"


def test_out_of_area_more_than_margin_faster_chosen() -> None:
    first, rule = first_and_rule(
        [stub("K01 0001", 100, 150, False), stub("K01 0002", 175, 225, True)]
    )

    assert first == "K01 0001"
    assert rule.reason == "NEAREST_OUTSIDE_MARGIN"


def test_exactly_60_s_prefers_in_area() -> None:
    first, rule = first_and_rule(
        [stub("K01 0001", 100, 150, False), stub("K01 0002", 160, 210, True)]
    )

    assert (first, rule.reason) == ("K01 0002", "IN_AREA_WITHIN_MARGIN")


def test_fastest_in_area_is_nearest() -> None:
    first, rule = first_and_rule(
        [stub("K01 0001", 80, 150, True), stub("K01 0002", 90, 140, False)]
    )

    assert (first, rule.reason, rule.delta_seconds) == ("K01 0001", "NEAREST", 0.0)


def test_unknown_area_is_pure_nearest() -> None:
    first, rule = first_and_rule(
        [stub("K01 0001", 120, 150, None), stub("K01 0002", 100, 140, None)]
    )

    assert first == "K01 0002"
    assert (rule.reason, rule.in_area_team_code, rule.delta_seconds) == ("NEAREST", None, None)


def test_no_in_area_team_is_nearest() -> None:
    first, rule = first_and_rule(
        [stub("K01 0001", 120, 150, False), stub("K01 0002", 100, 140, False)]
    )

    assert (first, rule.reason) == ("K01 0002", "NEAREST")


def test_time_mode_disabled_uses_standard_totals() -> None:
    # Green wave: in-area +70 s (outside the margin); standard: +40 s (within it).
    candidates = [stub("K01 0001", 100, 200, False), stub("K01 0002", 170, 240, True)]

    assert first_and_rule(candidates, GreenWaveMode.ENABLED)[1].reason == "NEAREST_OUTSIDE_MARGIN"
    first, rule = first_and_rule(candidates, GreenWaveMode.DISABLED)
    assert (first, rule.reason) == ("K01 0002", "IN_AREA_WITHIN_MARGIN")


def test_area_rule_reports_delta_and_codes() -> None:
    _, rule = first_and_rule([stub("K01 0001", 100, 150, False), stub("K01 0002", 175, 225, True)])

    assert rule.chosen_team_code == "K01 0001"
    assert rule.nearest_team_code == "K01 0001"
    assert rule.in_area_team_code == "K01 0002"
    assert rule.delta_seconds == pytest.approx(75.0)


def test_rest_follow_by_total() -> None:
    ordered, _ = order_by_area_rule(
        [
            stub("K01 0001", 100, 150, False),
            stub("K01 0002", 130, 190, True),
            stub("K01 0003", 120, 190, False),
            stub("K01 0004", 110, 190, False),
        ],
        60.0,
        GreenWaveMode.ENABLED,
    )

    assert [c.team.team_code for c in ordered] == ["K01 0002", "K01 0001", "K01 0004", "K01 0003"]


# --- rank_teams on the corridor fixture ----------------------------------------------------------
# Ambulance stations STN-A-0001..0004 lie along a one-way corridor towards the incident (0004 is
# nearest, 0001 farthest); STN-A-0005 is on an island.

INCIDENT = position_at(_X + 1_950.02)


def corridor() -> tuple[RoutingIndex, tuple[StationNode, ...]]:
    index = corridor_index()
    return index, build_station_nodes(corridor_stations(), index)


def rank(
    teams: tuple[Team, ...],
    overrides: dict[str, Availability] | None = None,
    *,
    at: datetime = NOON,
    area: IncidentArea | None = PODGORZE,
    **settings: float,
) -> TeamRanking:
    index, nodes = corridor()
    return rank_teams(
        index, nodes, teams, INCIDENT, at, overrides or {}, area, SimulationSettings(**settings)
    )


def codes(ranking: TeamRanking) -> list[str]:
    return [c.team.team_code for c in ranking.candidates]


def test_ranks_teams_by_base() -> None:
    ranking = rank((team("K01 001", "STN-A-0001"), team("K01 004", "STN-A-0004")))

    assert codes(ranking) == ["K01 004", "K01 001"]
    assert ranking.area_rule is not None and ranking.area_rule.reason == "NEAREST"
    assert ranking.candidates[0].in_area is False
    assert ranking.area == PODGORZE


def test_shared_base_lists_other_eligible_codes() -> None:
    teams = (
        team("K01 010", "STN-A-0004"),
        team("K01 012", "STN-A-0004"),
        team("K01 014", "STN-A-0004"),
    )

    ranking = rank(teams, {"K01 014": "busy"})

    [candidate] = ranking.candidates
    assert candidate.team.team_code == "K01 010"
    assert candidate.other_eligible_team_codes == ("K01 012",)
    assert [(t.team_code, reason) for t, reason in ranking.excluded] == [
        ("K01 014", "BUSY_OVERRIDE")
    ]


def test_in_area_team_chosen_first_at_its_base() -> None:
    ranking = rank((team("K01 010", "STN-A-0004"), team("K01 020", "STN-A-0004", IN)))

    [candidate] = ranking.candidates
    assert (candidate.team.team_code, candidate.in_area) == ("K01 020", True)
    assert candidate.other_eligible_team_codes == ("K01 010",)


def test_assumed_free_unless_marked_free() -> None:
    ranking = rank(
        (team("K01 004", "STN-A-0004"), team("K01 003", "STN-A-0003")), {"K01 004": "free"}
    )

    assert [(c.team.team_code, c.assumed_free) for c in ranking.candidates] == [
        ("K01 004", False),
        ("K01 003", True),
    ]


def test_all_busy_gives_no_candidates() -> None:
    teams = (team("K01 001", "STN-A-0001"), team("K01 004", "STN-A-0004"))

    ranking = rank(teams, {"K01 001": "busy", "K01 004": "busy"})

    assert ranking.candidates == ()
    assert ranking.area_rule is None
    assert [(t.team_code, r) for t, r in ranking.excluded] == [
        ("K01 001", "BUSY_OVERRIDE"),
        ("K01 004", "BUSY_OVERRIDE"),
    ]
    assert ranking.incident_snap.snap_distance_m >= 0


def test_off_shift_team_excluded_with_reason() -> None:
    teams = (
        team("K01 004", "STN-A-0004", ready_from_min=420, ready_to_min=1140),
        team("K01 003", "STN-A-0003"),
    )

    ranking = rank(teams, at=EVENING)

    assert codes(ranking) == ["K01 003"]
    assert [(t.team_code, r) for t, r in ranking.excluded] == [("K01 004", "OFF_SHIFT")]


def test_in_area_base_beyond_shortlist_considered() -> None:
    teams = (team("K01 001", "STN-A-0001", IN), team("K01 004", "STN-A-0004"))

    outside = rank(teams, dispatch_shortlist_size=1, area_preference_margin_seconds=0)
    within = rank(teams, dispatch_shortlist_size=1, area_preference_margin_seconds=10_000)

    assert outside.area_rule is not None and within.area_rule is not None
    assert outside.area_rule.reason == "NEAREST_OUTSIDE_MARGIN"
    assert outside.area_rule.in_area_team_code == "K01 001"
    assert outside.area_rule.delta_seconds is not None and outside.area_rule.delta_seconds > 0
    assert within.area_rule.reason == "IN_AREA_WITHIN_MARGIN"
    assert codes(within) == ["K01 001", "K01 004"]


def test_busy_in_area_base_not_forced_into_shortlist() -> None:
    # STN-A-0002 is the nearer in-area base, but its only team is busy: the forced shortlist
    # entry must be STN-A-0001, chosen after eligibility.
    teams = (
        team("K01 001", "STN-A-0001", IN),
        team("K01 002", "STN-A-0002", IN),
        team("K01 004", "STN-A-0004"),
    )

    ranking = rank(
        teams, {"K01 002": "busy"}, dispatch_shortlist_size=1, area_preference_margin_seconds=0
    )

    assert ranking.area_rule is not None
    assert ranking.area_rule.in_area_team_code == "K01 001"
    assert "K01 002" not in codes(ranking)


def test_at_most_three_candidates() -> None:
    teams = tuple(team(f"K01 00{i}", f"STN-A-000{i}") for i in range(1, 5))

    assert codes(rank(teams)) == ["K01 004", "K01 003", "K01 002"]


def test_eligible_but_unreachable_raises() -> None:
    with pytest.raises(NoStationReachable):
        rank((team("K01 005", "STN-A-0005"),))


def test_eligible_team_without_routable_base_raises() -> None:
    with pytest.raises(NoStationReachable):
        rank_teams(
            corridor_index(),
            (),
            (team("K01 001", "STN-A-0001"),),
            INCIDENT,
            NOON,
            {},
            None,
            SimulationSettings(),
        )


def test_team_of_an_unknown_station_is_ignored() -> None:
    ranking = rank((team("K01 004", "STN-A-0004"), team("K01 099", "STN-A-0099")))

    assert codes(ranking) == ["K01 004"]


def test_team_ranking_estimates_every_eligible_base() -> None:
    """No motion-time cut for teams: every eligible base gets the full estimate."""
    teams = (
        team("K01 001", "STN-A-0001"),
        team("K01 002", "STN-A-0002"),
        team("K01 004", "STN-A-0004"),
    )

    ranking = rank(teams, area=None, dispatch_shortlist_size=1)

    assert sorted(codes(ranking)) == ["K01 001", "K01 002", "K01 004"]
