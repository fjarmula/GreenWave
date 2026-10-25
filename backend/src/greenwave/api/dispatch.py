"""Thin HTTP adapter for incident dispatch: stations, local geocoding, ranking (ADR 0006)."""

from typing import Annotated, cast

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from greenwave.api.simulation import error_response
from greenwave.places.address_index import AddressIndex
from greenwave.routing.errors import DestinationOffNetwork, NoStationReachable
from greenwave.routing.network_index import RoutingIndex
from greenwave.routing.planner import node_position
from greenwave.routing.station_ranking import StationNode, rank_stations
from greenwave.schemas import (
    DispatchRankRequest,
    DispatchRankResponse,
    ErrorCode,
    ErrorResponse,
    GeocodeResponse,
    OnFootLeg,
    RankedCandidate,
    SnappedEndpoint,
    StationsResponse,
)
from greenwave.simulation_settings import SimulationSettings

router = APIRouter(prefix="/api/v1", tags=["dispatch"])


def _address_index(request: Request) -> AddressIndex:
    return cast(AddressIndex, request.app.state.address_index)


def _station_nodes(request: Request) -> tuple[StationNode, ...]:
    return cast(tuple[StationNode, ...], request.app.state.station_nodes)


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
    """Search the local OSM address index; never calls an external geocoder."""
    return GeocodeResponse(schema_version="1.0", results=_address_index(request).search(q, limit))


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
    """Sync on purpose: FastAPI runs it in the thread pool, keeping the CPU work off the loop."""
    try:
        ranking = rank_stations(
            cast(RoutingIndex, request.app.state.routing_index),
            _station_nodes(request),
            body.incident,
            body.vehicle_type,
            cast(SimulationSettings, request.app.state.simulation_settings),
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
    index = cast(RoutingIndex, request.app.state.routing_index)
    return DispatchRankResponse(
        schema_version="1.0",
        incident_snapped=SnappedEndpoint(
            position=ranking.incident_snap.position,
            snap_distance_m=ranking.incident_snap.snap_distance_m,
        ),
        candidates=[
            RankedCandidate(
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
            for c in ranking.candidates
        ],
        station_at_incident=ranking.station_at_incident,
    )
