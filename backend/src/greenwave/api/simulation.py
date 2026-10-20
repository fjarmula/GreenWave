"""Thin HTTP and SSE adapter for the simulation session manager."""

from collections.abc import AsyncIterator
from typing import Annotated, cast

from fastapi import APIRouter, Path, Request
from fastapi.responses import JSONResponse, StreamingResponse

from greenwave.api.sse import event_frame, retry_frame
from greenwave.routing.errors import DestinationOffNetwork, NoRoute, OriginOffNetwork
from greenwave.schemas import (
    ErrorCode,
    ErrorResponse,
    SimulationStartRequest,
    SimulationStartResponse,
    SimulationStreamEvent,
    StopResponse,
)
from greenwave.schemas.simulation import SIMULATION_ID_PATTERN
from greenwave.simulation.session import (
    SessionManager,
    SimulationIdInUseError,
    SimulationNotFoundError,
)

router = APIRouter(prefix="/api/v1/simulation", tags=["simulation"])

SimulationIdPath = Annotated[str, Path(pattern=SIMULATION_ID_PATTERN)]


def _manager(request: Request) -> SessionManager:
    return cast(SessionManager, request.app.state.session_manager)


def error_response(status_code: int, code: ErrorCode, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=ErrorResponse(schema_version="1.0", error_code=code, message=message).model_dump(
            mode="json"
        ),
    )


@router.post(
    "/start",
    response_model=SimulationStartResponse,
    responses={
        409: {"model": ErrorResponse, "description": "SIMULATION_ID_IN_USE"},
        422: {
            "model": ErrorResponse,
            "description": (
                "ORIGIN_OFF_NETWORK, DESTINATION_OFF_NETWORK or NO_ROUTE (ErrorResponse); "
                "request-schema violations return FastAPI's default validation body."
            ),
        },
    },
)
async def start_simulation(
    request: SimulationStartRequest, http_request: Request
) -> SimulationStartResponse | JSONResponse:
    try:
        return await _manager(http_request).start(request)
    except SimulationIdInUseError:
        return error_response(
            409, ErrorCode.SIMULATION_ID_IN_USE, "simulation id is already active"
        )
    except OriginOffNetwork:
        return error_response(
            422, ErrorCode.ORIGIN_OFF_NETWORK, "origin is outside the routable network"
        )
    except DestinationOffNetwork:
        return error_response(
            422, ErrorCode.DESTINATION_OFF_NETWORK, "destination is outside the routable network"
        )
    except NoRoute:
        return error_response(
            422, ErrorCode.NO_ROUTE, "no route exists between the snapped endpoints"
        )


@router.get(
    "/{simulation_id}/stream",
    response_class=StreamingResponse,
    response_model=None,
    responses={
        200: {
            "model": SimulationStreamEvent,
            "description": "Server-Sent Events. Frame: `event:` = event_type, `id:` = tick, "
            "`data:` = the event JSON; first frame `retry: 2000`; closed after a terminal event.",
            "content": {
                "text/event-stream": {
                    "schema": {"$ref": "#/components/schemas/SimulationStreamEvent"},
                    "itemSchema": {
                        "type": "object",
                        "required": ["data"],
                        "properties": {
                            "data": {
                                "type": "string",
                                "contentMediaType": "application/json",
                                "contentSchema": {
                                    "$ref": "#/components/schemas/SimulationStreamEvent"
                                },
                            },
                            "event": {"type": "string"},
                            "id": {"type": "string"},
                            "retry": {"type": "integer", "minimum": 0},
                        },
                    },
                }
            },
        },
        # Explicit content: the route's response class would otherwise label this event-stream.
        404: {
            "description": "SIMULATION_NOT_FOUND",
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}
            },
        },
    },
)
async def stream_simulation(
    simulation_id: SimulationIdPath,
    request: Request,
) -> StreamingResponse | JSONResponse:
    manager = _manager(request)
    if not manager.exists(simulation_id):
        return error_response(404, ErrorCode.SIMULATION_NOT_FOUND, "simulation was not found")
    stream = manager.subscribe(simulation_id)

    async def frames() -> AsyncIterator[str]:
        yield retry_frame()
        try:
            async for event in stream:
                if await request.is_disconnected():
                    return
                yield event_frame(event)
        except SimulationNotFoundError:
            return

    return StreamingResponse(
        frames(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/{simulation_id}/stop",
    response_model=StopResponse,
    responses={404: {"model": ErrorResponse, "description": "SIMULATION_NOT_FOUND"}},
)
async def stop_simulation(
    simulation_id: SimulationIdPath, request: Request
) -> StopResponse | JSONResponse:
    try:
        return await _manager(request).stop(simulation_id)
    except SimulationNotFoundError:
        return error_response(404, ErrorCode.SIMULATION_NOT_FOUND, "simulation was not found")
