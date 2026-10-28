"""Thin HTTP adapter for incident dispatch: stations, local geocoding, ranking (ADR 0006), and
the PRM team roster with resource-aware ambulance ranking (ADR 0014)."""

from datetime import datetime
from typing import Annotated, cast

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from greenwave.api.simulation import error_response
from greenwave.dataset import ProcessedDataset
from greenwave.etl.prm_roster import PRM_SOURCE
from greenwave.places.address_index import AddressIndex
from greenwave.places.incident_area import IncidentAreaLocator
from greenwave.routing import team_eligibility
from greenwave.routing.errors import DestinationOffNetwork, NoStationReachable
from greenwave.routing.network_index import RoutingIndex
from greenwave.routing.planner import SnappedRouteEndpoint, node_position
from greenwave.routing.station_ranking import RankedStation, StationNode, rank_stations
from greenwave.routing.team_ranking import RankedTeam, TeamRanking, rank_teams
from greenwave.schemas import (
    AreaRuleOutcome,
    DispatchRankRequest,
    DispatchRankResponse,
    ErrorCode,
    ErrorResponse,
    ExcludedTeam,
    GeocodeResponse,
    IncidentArea,
    OnFootLeg,
    RankedCandidate,
    ResourcesResponse,
    RosterInfo,
    SnappedEndpoint,
    StationsResponse,
    Team,
    TeamAssignment,
    VehicleType,
)
from greenwave.schemas.dispatch import LOCAL_ZONE, SelectionReason, local_naive
from greenwave.simulation_settings import SimulationSettings

router = APIRouter(prefix="/api/v1", tags=["dispatch"])


def _address_index(request: Request) -> AddressIndex:
    return cast(AddressIndex, request.app.state.address_index)


def _station_nodes(request: Request) -> tuple[StationNode, ...]:
    return cast(tuple[StationNode, ...], request.app.state.station_nodes)


def _teams(request: Request) -> tuple[team_eligibility.Team, ...]:
    return cast(tuple[team_eligibility.Team, ...], request.app.state.teams)


def _roster(request: Request) -> RosterInfo:
    roster = cast(ProcessedDataset, request.app.state.dataset).roster
    return RosterInfo(
        source=PRM_SOURCE,
        plan_update=roster.plan_update,
        effective_from=roster.effective_from,
        teams_in_scope=roster.teams_in_scope,
    )


def _local_now() -> datetime:
    """The server's Kraków wall-clock time to the minute, the default scenario time."""
    return datetime.now(LOCAL_ZONE).replace(tzinfo=None, second=0, microsecond=0)


@router.get("/stations", response_model=StationsResponse)
async def list_stations(request: Request) -> StationsResponse:
    """Every station that snaps to the network, all vehicle types, sorted by ``station_id``."""
    return StationsResponse(
        schema_version="1.0", stations=[node.station for node in _station_nodes(request)]
    )


@router.get("/geocode", response_model=GeocodeResponse)
async def geocode(
    request: Request,
    q: Annotated[str, Query(min_length=2, max_length=100)],
    limit: Annotated[int, Query(ge=1, le=10)] = 8,
) -> GeocodeResponse:
    """Search the local EMUiA + OSM address index (ADR 0013); never calls an external geocoder."""
    return GeocodeResponse(schema_version="1.0", results=_address_index(request).search(q, limit))


@router.get("/resources", response_model=ResourcesResponse)
async def list_resources(
    request: Request, at: Annotated[datetime | None, Query()] = None
) -> ResourcesResponse:
    """The PRM teams in scope and whether each is on shift at ``at`` (naive local time; default
    the server's local now). Published schedule only: no live availability."""
    moment = local_naive(at) if at is not None else _local_now()
    return ResourcesResponse(
        schema_version="1.0",
        roster=_roster(request),
        at=moment,
        teams=[
            Team(
                team_code=t.team_code,
                team_type=t.team_type,
                station_id=t.station_id,
                base_address=t.base_address,
                area_teryt=list(t.area_teryt),
                weekdays=t.weekdays,
                ready_from_min=t.ready_from_min,
                ready_to_min=t.ready_to_min,
                season_from=t.season_from,
                season_to=t.season_to,
                on_shift=team_eligibility.on_shift(t, moment),
            )
            for t in _teams(request)
        ],
    )


@router.post(
    "/dispatch/rank",
    response_model=DispatchRankResponse,
    responses={
        422: {
            "model": ErrorResponse,
            "description": (
                "DESTINATION_OFF_NETWORK or NO_STATION_REACHABLE (ErrorResponse); "
                "request-schema violations return FastAPI's default validation body."
            ),
        },
    },
)
def rank(body: DispatchRankRequest, request: Request) -> DispatchRankResponse | JSONResponse:
    """Sync on purpose: FastAPI runs it in the thread pool, keeping the CPU work off the loop.

    AMBULANCE ranks eligible PRM teams (ADR 0014) unless ``resource_aware`` is off; fire,
    police and non-resource-aware ambulances rank stations as before.
    """
    index = cast(RoutingIndex, request.app.state.routing_index)
    settings = cast(SimulationSettings, request.app.state.simulation_settings)
    scenario_time = body.scenario_time or _local_now()
    try:
        if body.vehicle_type is VehicleType.AMBULANCE and body.resource_aware:
            area = cast(IncidentAreaLocator, request.app.state.incident_area_locator).locate(
                body.incident
            )
            teams = rank_teams(
                index,
                _station_nodes(request),
                _teams(request),
                body.incident,
                scenario_time,
                body.availability,
                area,
                settings,
                body.time_mode,
                body.traffic_density_multiplier,
            )
            return _team_response(index, teams, scenario_time, _roster(request))
        ranking = rank_stations(
            index,
            _station_nodes(request),
            body.incident,
            body.vehicle_type,
            settings,
            body.traffic_density_multiplier,
        )
    except DestinationOffNetwork as error:
        return error_response(422, ErrorCode.DESTINATION_OFF_NETWORK, str(error))
    except NoStationReachable:
        return error_response(
            422,
            ErrorCode.NO_STATION_REACHABLE,
            f"no {body.vehicle_type.value} station can reach the incident",
        )
    return DispatchRankResponse(
        schema_version="1.0",
        incident_snapped=_snapped(ranking.incident_snap),
        candidates=[_candidate(index, c) for c in ranking.candidates],
        station_at_incident=None,  # deprecated: on-site stations are candidates (ADR 0012)
        scenario_time=scenario_time,
        outcome="OK",
        incident_area=None,
        excluded_teams=[],
        roster=None,
        area_rule=None,
    )


def _snapped(snap: SnappedRouteEndpoint) -> SnappedEndpoint:
    return SnappedEndpoint(position=snap.position, snap_distance_m=snap.snap_distance_m)


def _team_response(
    index: RoutingIndex, ranking: TeamRanking, scenario_time: datetime, roster: RosterInfo
) -> DispatchRankResponse:
    rule = ranking.area_rule
    area = ranking.area
    return DispatchRankResponse(
        schema_version="1.0",
        incident_snapped=_snapped(ranking.incident_snap),
        candidates=[
            _team_candidate(index, c, rule.reason if i == 0 and rule else None)
            for i, c in enumerate(ranking.candidates)
        ],
        station_at_incident=None,
        scenario_time=scenario_time,
        outcome="OK" if ranking.candidates else "NO_ELIGIBLE_RESOURCE",
        incident_area=IncidentArea(
            teryt=area.teryt,
            delegatura_name=area.delegatura_name,
            district_number=area.district_number,
            district_name=area.district_name,
        )
        if area
        else None,
        excluded_teams=[
            ExcludedTeam(team_code=t.team_code, station_id=t.station_id, reason=reason)
            for t, reason in ranking.excluded
        ],
        roster=roster,
        area_rule=AreaRuleOutcome(
            reason=rule.reason,
            chosen_team_code=rule.chosen_team_code,
            nearest_team_code=rule.nearest_team_code,
            in_area_team_code=rule.in_area_team_code,
            delta_seconds=rule.delta_seconds,
        )
        if rule
        else None,
    )


def _team_candidate(
    index: RoutingIndex, c: RankedTeam, reason: SelectionReason | None
) -> RankedCandidate:
    candidate = _candidate(index, c.ranked)
    candidate.team = TeamAssignment(
        team_code=c.team.team_code,
        team_type=c.team.team_type,
        area_teryt=list(c.team.area_teryt),
        in_area=c.in_area,
        availability="assumed_free" if c.assumed_free else "free",
        other_eligible_team_codes=list(c.other_eligible_team_codes),
    )
    candidate.selection_reason = reason
    return candidate


def _candidate(index: RoutingIndex, c: RankedStation) -> RankedCandidate:
    if c.on_site:
        # No drive: the crew walks from the station itself.
        return RankedCandidate(
            station=c.station,
            greenwave_seconds=0.0,
            standard_seconds=0.0,
            distance_m=0.0,
            on_foot=OnFootLeg(
                access_point=c.station.position,
                distance_m=c.walk_m or 0.0,
                seconds=c.walk_seconds or 0.0,
            ),
            on_site=True,
        )
    return RankedCandidate(
        station=c.station,
        greenwave_seconds=c.greenwave_seconds,
        standard_seconds=c.standard_seconds,
        distance_m=c.distance_m,
        on_foot=OnFootLeg(
            access_point=node_position(index, c.on_foot.node_key),
            distance_m=c.on_foot.on_foot_m,
            seconds=c.on_foot.on_foot_seconds,
        )
        if c.on_foot
        else None,
    )
