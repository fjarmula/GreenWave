"""Rank eligible PRM ambulance teams for an incident (ADR 0014, spec D1 and D4).

Bases with at least one eligible team go through the station ranking; the best in-area base
(lowest reversed-Dijkstra time among bases with an eligible in-area team) always joins its
shortlist. Each base sends one team: in-area first, then by team code. The area rule then picks
the first candidate on the request's ``time_mode`` totals: the fastest in-area team unless an
out-of-area team arrives more than ``area_preference_margin_seconds`` sooner. Simulation only:
no live availability, no official dispatch protocol.
"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from greenwave.places.incident_area import IncidentArea
from greenwave.routing.access import access_nodes
from greenwave.routing.errors import DestinationOffNetwork, NoStationReachable
from greenwave.routing.network_index import RoutingIndex
from greenwave.routing.planner import SnappedRouteEndpoint, node_position, snap_endpoint
from greenwave.routing.station_ranking import (
    MAX_CANDIDATES,
    RankedStation,
    StationNode,
    rank_stations,
)
from greenwave.routing.team_eligibility import (
    Availability,
    ExclusionReason,
    Team,
    classify,
)
from greenwave.schemas import GreenWaveMode, Position, VehicleType
from greenwave.simulation_settings import SimulationSettings

SelectionReason = Literal["NEAREST", "IN_AREA_WITHIN_MARGIN", "NEAREST_OUTSIDE_MARGIN"]


@dataclass(frozen=True)
class RankedTeam:
    ranked: RankedStation
    team: Team  # the team this base sends
    assumed_free: bool  # no availability override: shown as "status unknown"
    in_area: bool | None  # None when the incident's area is unknown
    other_eligible_team_codes: tuple[str, ...]  # the base's other eligible teams


@dataclass(frozen=True)
class AreaRule:
    reason: SelectionReason
    chosen_team_code: str
    nearest_team_code: str  # the fastest candidate's team
    in_area_team_code: str | None  # the fastest in-area candidate's team
    delta_seconds: float | None  # in-area total minus the fastest total


@dataclass(frozen=True)
class TeamRanking:
    incident_snap: SnappedRouteEndpoint
    candidates: tuple[RankedTeam, ...]  # empty: no eligible team; else the recommended first
    area_rule: AreaRule | None  # None exactly when there is no candidate
    excluded: tuple[tuple[Team, ExclusionReason], ...]
    area: IncidentArea | None


def order_by_area_rule(
    candidates: Sequence[RankedTeam], margin_s: float, time_mode: GreenWaveMode
) -> tuple[tuple[RankedTeam, ...], AreaRule]:
    """The D4 order: the chosen candidate, then the rest by ``time_mode`` total (all of them)."""
    if not candidates:
        raise ValueError("order_by_area_rule needs at least one candidate")

    def total(c: RankedTeam) -> float:
        return c.ranked.total_seconds_for(time_mode)

    by_total = sorted(candidates, key=lambda c: (total(c), c.ranked.station.station_id))
    fastest = by_total[0]
    in_area = next((c for c in by_total if c.in_area), None)
    delta = total(in_area) - total(fastest) if in_area is not None else None
    reason: SelectionReason
    if in_area is None or in_area is fastest:
        first, reason = fastest, "NEAREST"
    elif delta is not None and delta <= margin_s:
        first, reason = in_area, "IN_AREA_WITHIN_MARGIN"
    else:
        first, reason = fastest, "NEAREST_OUTSIDE_MARGIN"
    rule = AreaRule(
        reason=reason,
        chosen_team_code=first.team.team_code,
        nearest_team_code=fastest.team.team_code,
        in_area_team_code=in_area.team.team_code if in_area is not None else None,
        delta_seconds=delta,
    )
    return (first, *(c for c in by_total if c is not first)), rule


def _in_area(team: Team, area: IncidentArea | None) -> bool | None:
    return None if area is None else area.teryt in team.area_teryt


def _incident_snap(
    index: RoutingIndex, incident: Position, settings: SimulationSettings
) -> SnappedRouteEndpoint:
    """Where the incident meets the network when no candidate route says so: its snap, or off
    the network the nearest access node. Raises ``DestinationOffNetwork`` beyond walking reach."""
    try:
        return snap_endpoint(index, incident, origin=False)
    except DestinationOffNetwork:
        nearest = access_nodes(index, incident, settings)[0]
        return SnappedRouteEndpoint(
            nearest.node_key, node_position(index, nearest.node_key), nearest.straight_m
        )


def rank_teams(
    index: RoutingIndex,
    station_nodes: Sequence[StationNode],
    teams: Iterable[Team],
    incident: Position,
    at: datetime,
    overrides: Mapping[str, Availability],
    area: IncidentArea | None,
    settings: SimulationSettings,
    time_mode: GreenWaveMode = GreenWaveMode.ENABLED,
    traffic_density_multiplier: float = 1.0,
) -> TeamRanking:
    """Raises ``DestinationOffNetwork``, or ``NoStationReachable`` when eligible teams exist but
    no base can reach the incident (a routing failure, not an availability outcome)."""
    eligibility = classify(teams, at, overrides)
    at_base: dict[str, list[tuple[Team, bool]]] = {}
    for team, assumed_free in eligibility.eligible:
        at_base.setdefault(team.station_id, []).append((team, assumed_free))
    for entries in at_base.values():
        entries.sort(key=lambda e: (_in_area(e[0], area) is not True, e[0].team_code))
    eligible_nodes = [n for n in station_nodes if n.station.station_id in at_base]
    if not eligibility.eligible:
        return TeamRanking(
            _incident_snap(index, incident, settings), (), None, eligibility.excluded, area
        )
    if not eligible_nodes:
        raise NoStationReachable("No eligible ambulance base is on the routable network")

    in_area_bases = frozenset(
        station_id
        for station_id, entries in at_base.items()
        if _in_area(entries[0][0], area) is True
    )
    stations = rank_stations(
        index,
        eligible_nodes,
        incident,
        VehicleType.AMBULANCE,
        settings,
        traffic_density_multiplier,
        time_mode=time_mode,
        include_fastest_of=in_area_bases,
        max_candidates=len(eligible_nodes),
        shortlist_size=len(eligible_nodes),  # at most 8 bases: no motion-time cut
    )
    candidates = [
        RankedTeam(
            ranked=ranked,
            team=at_base[ranked.station.station_id][0][0],
            assumed_free=at_base[ranked.station.station_id][0][1],
            in_area=_in_area(at_base[ranked.station.station_id][0][0], area),
            other_eligible_team_codes=tuple(
                t.team_code for t, _ in at_base[ranked.station.station_id][1:]
            ),
        )
        for ranked in stations.candidates
    ]
    ordered, rule = order_by_area_rule(
        candidates, settings.area_preference_margin_seconds, time_mode
    )
    return TeamRanking(
        stations.incident_snap, ordered[:MAX_CANDIDATES], rule, eligibility.excluded, area
    )
