"""Simulation endpoints: final contract-v1 signatures, stubbed until the engine lands.

Every route raises HTTP 501. The backend branch replaces the bodies; paths, models and
documented errors are frozen (``docs/adr/0003-simulation-contract-v1.md``).
"""

from collections.abc import AsyncIterator
from typing import Annotated, NoReturn

from fastapi import APIRouter, Depends, HTTPException, Path
from fastapi.sse import EventSourceResponse

from greenwave.schemas import (
    ErrorResponse,
    SimulationStartRequest,
    SimulationStartResponse,
    SimulationStreamEvent,
    StopResponse,
)
from greenwave.schemas.simulation import SIMULATION_ID_PATTERN

router = APIRouter(prefix="/api/v1/simulation", tags=["simulation"])

_NOT_IMPLEMENTED = "Simulation engine not implemented yet."
SimulationIdPath = Annotated[str, Path(pattern=SIMULATION_ID_PATTERN)]


def _not_implemented() -> NoReturn:
    raise HTTPException(status_code=501, detail=_NOT_IMPLEMENTED)


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
async def start_simulation(request: SimulationStartRequest) -> SimulationStartResponse:
    _not_implemented()


@router.get(
    "/{simulation_id}/stream",
    response_class=EventSourceResponse,
    # An exception raised inside an SSE generator is not turned into a response, so the stub
    # fails in a dependency. The real route validates the id (404) the same way.
    dependencies=[Depends(_not_implemented)],
    responses={
        200: {
            "description": (
                "Server-Sent Events. Frame: `event:` = event_type, `id:` = tick, `data:` = the "
                "event JSON; first frame `retry: 2000`; closed after a terminal event."
            ),
            "model": SimulationStreamEvent,
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
) -> AsyncIterator[SimulationStreamEvent]:
    # FastAPI's SSE route needs an async generator; the dependency above fails first.
    _not_implemented()
    yield  # pragma: no cover


@router.post(
    "/{simulation_id}/stop",
    response_model=StopResponse,
    responses={404: {"model": ErrorResponse, "description": "SIMULATION_NOT_FOUND"}},
)
async def stop_simulation(simulation_id: SimulationIdPath) -> StopResponse:
    _not_implemented()
