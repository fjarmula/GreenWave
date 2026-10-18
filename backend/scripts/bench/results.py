"""Result file writing, per-section machine-state bracketing and the stated limitations."""

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from bench.machine import machine_state

LIMITATIONS = [
    "One development machine (see environment and machine state), not the demo machine. The CPU "
    "governor was powersave; the clock and the busiest process names are recorded at the start "
    "and end of the run and of each section, and other programs (a desktop session) may have "
    "been using the machine.",
    "'Cold' load means a fresh process with the files in the OS page cache; caches were not "
    "dropped "
    "(needs root), so it is not a cold-disk time.",
    "The search weight uses speed_kmh; the ambulance model uses V_ambulance(e) = min(max(1.3 * "
    "speed_kmh, 30), 90) km/h, which changes edge costs and possibly the chosen routes and the "
    "search effort. Not measured here.",
    "Intersection delays (D_v, D_min) are not in the search weight; delay-aware route choice, the "
    "traffic multiplier, the state machine, the 1 Hz loop, SSE streaming and concurrent requests "
    "are not measured.",
    "The per-intersection lookup and the precomputed-weight copy are benchmark-only code, not the "
    "routing implementation.",
    "Latency depends on the sampled pairs and the fixed seed; the pairs are not real ambulance "
    "routes. 3 to 5 ETL repetitions show spread only, not a distribution.",
    "Timings use time.perf_counter with garbage collection enabled (gc.collect() before each "
    "pass), so collector pauses are inside the measured values.",
]


def save(result: dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def timed_section(result: dict[str, Any], name: str, body: Callable[[], dict[str, Any]]) -> None:
    start = machine_state()
    section = body()
    section["machine_state_start"] = start
    section["machine_state_end"] = machine_state()
    result["sections"][name] = section
