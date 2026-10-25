"""Async lifecycle manager for the one active simulated operation: a run or a comparison pair.

The loop publishes independently of clients, one tick per simulated second at every playback
speed: playback only shortens the wall-clock gap between ticks (1 s at 1x, 0.1 s at 10x), so the
streamed run is identical at every speed.  Missed wall-clock deadlines are logged and the next
iteration starts normally; it never emits a burst of catch-up ticks.  Subscriber queues are
bounded and use drop-oldest for ordinary telemetry, while terminal events always displace a tick.
If the loop itself fails, the run ends with a ``SERVER_ERROR`` cancellation like any other
terminal, so clients learn at once instead of waiting out their silence timeout.  Every run
publishes exactly one terminal, and only the active operation plus the most recent ended runs
(``retained_session_limit``) stay streamable.

A comparison pair (ADR 0008) is one operation of two runs advanced by one shared loop: each
interval steps every unfinished member once, so both always share the same simulated second.
Starting anything supersedes the whole active operation, and stopping either member stops both.
"""

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime

from greenwave.its.gateway import ItsGateway
from greenwave.routing.network_index import RoutingIndex
from greenwave.schemas import (
    CancelReason,
    ComparisonStartRequest,
    ComparisonStartResponse,
    GreenWaveMode,
    SimulationCancelledEvent,
    SimulationStartRequest,
    SimulationStartResponse,
    StopResponse,
)
from greenwave.simulation.assembly import PlannedSimulation, SimulationPlanner, plan_simulation
from greenwave.simulation.engine import SimulationEngine
from greenwave.simulation.events import SimulationEvent, TerminalEvent, is_terminal
from greenwave.simulation.state import EngineState
from greenwave.simulation.subscriber_queue import offer
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
    terminal: TerminalEvent | None = None
    task: asyncio.Task[None] | None = None


class SessionManager:
    """Own the one active operation's task and non-blocking telemetry fan-out."""

    def __init__(
        self,
        index: RoutingIndex,
        settings: SimulationSettings,
        gateway: ItsGateway | None = None,
        clock: Clock | None = None,
        sleep: Sleep = asyncio.sleep,
        planner: SimulationPlanner = plan_simulation,
    ) -> None:
        self._index = index
        self._settings = settings
        self._gateway = gateway
        self._clock = clock or (lambda: datetime.now(UTC))
        self._sleep = sleep
        self._planner = planner
        # Sessions of the active operation (one run or a pair); empty when idle.
        self._operation: tuple[_Session, ...] = ()
        self._sessions: dict[str, _Session] = {}
        self._lock = asyncio.Lock()

    @property
    def _active(self) -> _Session | None:
        """The first session of the active operation (the run itself for a single run)."""
        return self._operation[0] if self._operation else None

    def _check_ids_free(self, *simulation_ids: str) -> None:
        for session in self._operation:
            if session.terminal is None and session.simulation_id in simulation_ids:
                raise SimulationIdInUseError(session.simulation_id)

    async def _plan(self, request: SimulationStartRequest) -> PlannedSimulation:
        # Route search is CPU-bound; keep it off the event loop that runs live sessions.
        return await asyncio.to_thread(
            self._planner, self._index, request, self._settings, self._gateway
        )

    async def start(self, request: SimulationStartRequest) -> SimulationStartResponse:
        """Plan then start a run, superseding a different active operation."""
        async with self._lock:
            self._check_ids_free(request.simulation_id)
            planned = await self._plan(request)
            await self._cancel_operation(CancelReason.SUPERSEDED)
            self._launch((self._session(request, planned),))
            return planned.response

    async def start_comparison(self, request: ComparisonStartRequest) -> ComparisonStartResponse:
        """Plan both runs of a pair, then start them in lockstep, superseding the active one."""
        async with self._lock:
            self._check_ids_free(request.enabled_simulation_id, request.disabled_simulation_id)
            members = [
                request.member(GreenWaveMode.ENABLED),
                request.member(GreenWaveMode.DISABLED),
            ]
            # Both plans succeed before anything is superseded.
            planned: list[PlannedSimulation] = []
            try:
                for member in members:
                    planned.append(await self._plan(member))
            except BaseException:
                for item in planned:
                    item.engine.close()
                raise
            await self._cancel_operation(CancelReason.SUPERSEDED)
            self._launch(tuple(self._session(m, p) for m, p in zip(members, planned, strict=True)))
            enabled, disabled = (p.response for p in planned)
            return ComparisonStartResponse(
                schema_version="1.0",
                is_simulated=True,
                enabled=enabled,
                disabled=disabled,
            )

    @staticmethod
    def _session(request: SimulationStartRequest, planned: PlannedSimulation) -> _Session:
        return _Session(
            simulation_id=request.simulation_id,
            engine=planned.engine,
            state=planned.engine.initial_state(),
            playback_speed=request.playback_speed,
        )

    def _launch(self, sessions: tuple[_Session, ...]) -> None:
        for session in sessions:
            # Re-inserted so a reused id counts as the newest session for eviction.
            self._sessions.pop(session.simulation_id, None)
            self._sessions[session.simulation_id] = session
        self._operation = sessions
        self._evict_retained()
        task = asyncio.create_task(
            self._run(sessions), name=f"simulation-{sessions[0].simulation_id}"
        )
        for session in sessions:
            session.task = task

    async def stop(self, simulation_id: str) -> StopResponse:
        """Stop a live operation through any of its runs; an ended run alone is a no-op."""
        async with self._lock:
            session = self._sessions.get(simulation_id)
            if session is None:
                raise SimulationNotFoundError(simulation_id)
            if session in self._operation:
                await self._cancel_operation(CancelReason.STOPPED, self._operation)
            return StopResponse(
                schema_version="1.0",
                is_simulated=True,
                simulation_id=simulation_id,
                status="STOPPED",
            )

    async def subscribe(self, simulation_id: str) -> AsyncIterator[SimulationEvent]:
        """Yield the current snapshot then live events, closing after a terminal event."""
        session = self._sessions.get(simulation_id)
        if session is None:
            raise SimulationNotFoundError(simulation_id)
        if session.terminal is not None:
            if session.latest is not None:
                yield session.latest
            yield session.terminal
            return

        queue: asyncio.Queue[SimulationEvent] = asyncio.Queue(
            maxsize=self._settings.subscriber_queue_size
        )
        session.subscribers.add(queue)
        if session.latest is not None:
            offer(queue, session.latest)
        try:
            while True:
                event = await queue.get()
                yield event
                if is_terminal(event):
                    return
        finally:
            session.subscribers.discard(queue)

    def exists(self, simulation_id: str) -> bool:
        """Whether a retained live or completed session can be streamed."""
        return simulation_id in self._sessions

    async def shutdown(self) -> None:
        """Cancel any live loop and release all retained subscriber references."""
        await self._cancel_operation(CancelReason.STOPPED)
        for session in tuple(self._sessions.values()):
            session.subscribers.clear()

    def _evict_retained(self) -> None:
        """Drop the oldest ended sessions beyond the limit; the active operation is always kept."""
        excess = len(self._sessions) - self._settings.retained_session_limit
        for simulation_id, session in tuple(self._sessions.items()):
            if excess <= 0:
                break
            if session not in self._operation and session.terminal is not None:
                del self._sessions[simulation_id]
                excess -= 1

    async def _run(self, sessions: tuple[_Session, ...]) -> None:
        try:
            while True:
                started = asyncio.get_running_loop().time()
                live = [session for session in sessions if not session.state.completed]
                if not live:
                    break
                now = self._clock()  # one simulated second, one timestamp, for every member
                for session in live:
                    state, events = session.engine.step(session.state, now)
                    session.state = state
                    for event in events:
                        self._publish(session, event)
                if all(session.state.completed for session in sessions):
                    break
                # Members share one playback speed (a pair is planned from one request).
                remaining = self._settings.tick_interval_seconds / sessions[0].playback_speed - (
                    asyncio.get_running_loop().time() - started
                )
                if remaining > 0:
                    await self._sleep(remaining)
                else:
                    logger.warning(
                        "simulation_tick_deadline_missed", extra={"overrun_ms": -remaining * 1000}
                    )
        except Exception:
            logger.exception(
                "simulation_loop_failed",
                extra={"simulation_id": ",".join(session.simulation_id for session in sessions)},
            )
            for session in sessions:
                self._publish(session, self._cancelled_event(session, CancelReason.SERVER_ERROR))
        finally:
            for session in sessions:
                session.engine.close()
            if self._operation is sessions and all(s.terminal is not None for s in sessions):
                self._operation = ()

    async def _cancel_operation(
        self, reason: CancelReason, sessions: tuple[_Session, ...] | None = None
    ) -> None:
        """Cancel the shared loop once, then end every member that has no terminal yet."""
        sessions = self._operation if sessions is None else sessions
        for task in {session.task for session in sessions if session.task is not None}:
            if not task.done():
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
        for session in sessions:
            session.engine.close()
            self._publish(session, self._cancelled_event(session, reason))
        if self._operation is sessions:
            self._operation = ()

    def _cancelled_event(self, session: _Session, reason: CancelReason) -> SimulationCancelledEvent:
        return SimulationCancelledEvent(
            schema_version="1.0",
            is_simulated=True,
            event_type="SIMULATION_CANCELLED",
            simulation_id=session.simulation_id,
            tick=session.state.tick,
            timestamp=self._clock(),
            reason=reason,
        )

    def _publish(self, session: _Session, event: SimulationEvent) -> None:
        # One terminal per run: a racing stop/supersede, or a failure after the engine's own
        # terminal, finds it already set and publishes nothing more.
        if session.terminal is not None:
            return
        if is_terminal(event):
            session.terminal = event
        else:
            session.latest = event
        for queue in tuple(session.subscribers):
            offer(queue, event)
