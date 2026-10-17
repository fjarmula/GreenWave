"""Bounded per-subscriber delivery that never blocks the simulation loop.

A full queue drops its oldest event to make room; a terminal event is never dropped for another
terminal, so a stream always ends with its terminal event.
"""

import asyncio

from greenwave.simulation.events import SimulationEvent, is_terminal


def offer(queue: asyncio.Queue[SimulationEvent], event: SimulationEvent) -> None:
    if not queue.full():
        queue.put_nowait(event)
        return
    terminal = is_terminal(event)
    buffered: list[SimulationEvent] = []
    dropped = False
    while not queue.empty():
        item = queue.get_nowait()
        if not dropped and (not terminal or not is_terminal(item)):
            dropped = True
            continue
        buffered.append(item)
    for item in buffered:
        queue.put_nowait(item)
    if dropped:
        queue.put_nowait(event)
