"""Async lifecycle manager for the one active simulated emergency run.

The loop publishes independently of clients.  Missed wall-clock deadlines are logged and the
next iteration starts normally; it never emits a burst of catch-up ticks.  Subscriber queues are
bounded and use drop-oldest for ordinary telemetry, while terminal events always displace a tick.
"""

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import cast

from greenwave.its.gateway import ItsGateway
from greenwave.routing.estimates import estimate_times
from greenwave.routing.network_index import RoutingIndex
from greenwave.routing.planner import plan_route
from greenwave.schemas import (
    CancelReason,
    SimulationCancelledEvent,
    SimulationCompletedEvent,
    SimulationStartRequest,
    SimulationStartResponse,
    StopResponse,
)
from greenwave.simulation.engine import SimulationEngine
from greenwave.simulation.events import SimulationEvent
from greenwave.simulation.route_model import build_route_model, to_start_response
from greenwave.simulation.state import EngineState
from greenwave.simulation_settings import SimulationSettings

logger = logging.getLogger(__name__)

Clock = Callable[[], datetime]
Sleep = Callable[[float], Awaitable[None]]


class SimulationIdInUseError(Exception):
    """The requested client-selected identifier belongs to an active run."""


class SimulationNotFoundError(Exception):
    """No current or retained simulation has the requested identifier."""


@dataclass(slots=True)
class _Session:
    simulation_id: str
    engine: SimulationEngine
    state: EngineState
    playback_speed: int
    subscribers: set[asyncio.Queue[SimulationEvent]] = field(default_factory=set)
    latest: SimulationEvent | None = None
    terminal: SimulationCancelledEvent | SimulationCompletedEvent | None = None
    task: asyncio.Task[None] | None = None


class SessionManager:
    """Own the single simulation task and non-blocking telemetry fan-out."""

    def __init__(
        self,
        index: RoutingIndex,
        settings: SimulationSettings,
        gateway: ItsGateway,
        clock: Clock | None = None,
        sleep: Sleep = asyncio.sleep,
    ) -> None:
        self._index = index
        self._settings = settings
        self._gateway = gateway
        self._clock = clock or (lambda: datetime.now(UTC))
        self._sleep = sleep
        self._active: _Session | None = None
        self._sessions: dict[str, _Session] = {}
        self._lock = asyncio.Lock()

    async def start(self, request: SimulationStartRequest) -> SimulationStartResponse:
        """Plan then start a run, superseding a different active simulation."""
        async with self._lock:
            if (
                self._active is not None
                and self._active.terminal is None
                and self._active.simulation_id == request.simulation_id
            ):
                raise SimulationIdInUseError(request.simulation_id)

            route = await asyncio.to_thread(
                plan_route, self._index, request.origin, request.destination, self._settings
            )
            route_model = build_route_model(
                route, self._index, self._settings, request.enable_cascade_mode
            )
            estimates = estimate_times(
                route, route_model, request.traffic_density_multiplier, self._settings
            )
            engine = SimulationEngine(
                request.simulation_id,
                route,
                route_model,
                estimates,
                request.traffic_density_multiplier,
                self._settings,
                self._gateway,
            )
            if self._active is not None and self._active.terminal is None:
                await self._cancel(self._active, CancelReason.SUPERSEDED)
            session = _Session(
                simulation_id=request.simulation_id,
                engine=engine,
                state=engine.initial_state(),
                playback_speed=request.playback_speed,
            )
            self._sessions[session.simulation_id] = session
            self._active = session
            session.task = asyncio.create_task(
                self._run(session), name=f"simulation-{session.simulation_id}"
            )
            return to_start_response(
                request.simulation_id, route, route_model, estimates, self._index
            )

    async def stop(self, simulation_id: str) -> StopResponse:
        """Stop a live run; a completed retained run is a successful no-op."""
        session = self._sessions.get(simulation_id)
        if session is None:
            raise SimulationNotFoundError(simulation_id)
        if session.terminal is None:
            await self._cancel(session, CancelReason.STOPPED)
        return StopResponse(
            schema_version="1.0", is_simulated=True, simulation_id=simulation_id, status="STOPPED"
        )

    async def subscribe(self, simulation_id: str) -> AsyncIterator[SimulationEvent]:
        """Yield the current snapshot then live events, closing after a terminal event."""
        session = self._sessions.get(simulation_id)
        if session is None:
            raise SimulationNotFoundError(simulation_id)
        if session.terminal is not None:
            yield session.terminal
            return

        queue: asyncio.Queue[SimulationEvent] = asyncio.Queue(
            maxsize=self._settings.subscriber_queue_size
        )
        session.subscribers.add(queue)
        if session.latest is not None:
            self._put(queue, session.latest, terminal=False)
        try:
            while True:
                event = await queue.get()
                yield event
                if isinstance(event, (SimulationCancelledEvent, SimulationCompletedEvent)):
                    return
        finally:
            session.subscribers.discard(queue)

    def exists(self, simulation_id: str) -> bool:
        """Whether a retained live or completed session can be streamed."""
        return simulation_id in self._sessions

    async def shutdown(self) -> None:
        """Cancel any live loop and release all retained subscriber references."""
        sessions = tuple(self._sessions.values())
        for session in sessions:
            if session.terminal is None:
                await self._cancel(session, CancelReason.STOPPED)
            session.subscribers.clear()

    async def _run(self, session: _Session) -> None:
        try:
            while not session.state.completed:
                started = asyncio.get_running_loop().time()
                state, events = session.engine.run_tick(
                    session.state, self._clock(), session.playback_speed
                )
                session.state = state
                for event in events:
                    self._publish(session, event)
                if session.state.completed:
                    break
                remaining = self._settings.tick_interval_seconds - (
                    asyncio.get_running_loop().time() - started
                )
                if remaining > 0:
                    await self._sleep(remaining)
                else:
                    logger.warning(
                        "simulation_tick_deadline_missed", extra={"overrun_ms": -remaining * 1000}
                    )
        except asyncio.CancelledError:
            raise
        finally:
            if self._active is session and session.terminal is not None:
                self._active = None

    async def _cancel(self, session: _Session, reason: CancelReason) -> None:
        if session.task is not None and not session.task.done():
            session.task.cancel()
            with suppress(asyncio.CancelledError):
                await session.task
        terminal = SimulationCancelledEvent(
            schema_version="1.0",
            is_simulated=True,
            event_type="SIMULATION_CANCELLED",
            simulation_id=session.simulation_id,
            tick=session.state.tick,
            timestamp=self._clock(),
            reason=reason,
        )
        session.terminal = terminal
        self._publish(session, terminal)
        if self._active is session:
            self._active = None

    def _publish(self, session: _Session, event: SimulationEvent) -> None:
        terminal = isinstance(event, (SimulationCancelledEvent, SimulationCompletedEvent))
        if terminal:
            session.terminal = cast(SimulationCancelledEvent | SimulationCompletedEvent, event)
        else:
            session.latest = event
        for queue in tuple(session.subscribers):
            self._put(queue, event, terminal=terminal)

    @staticmethod
    def _put(
        queue: asyncio.Queue[SimulationEvent], event: SimulationEvent, *, terminal: bool
    ) -> None:
        if not queue.full():
            queue.put_nowait(event)
            return
        buffered: list[SimulationEvent] = []
        dropped = False
        while not queue.empty():
            item = queue.get_nowait()
            is_terminal = isinstance(item, (SimulationCancelledEvent, SimulationCompletedEvent))
            if not dropped and (not terminal or not is_terminal):
                dropped = True
                continue
            buffered.append(item)
        for item in buffered:
            queue.put_nowait(item)
        if dropped:
            queue.put_nowait(event)
