"""Sample real Kraków dispatches and run each in both modes, the way a session steps the engine.

    uv run python scripts/sample_runs.py --routes 40 --seed 11 [--cascade] [--density 1.5]

Each incident is a random address (``addresses.sample(n, seed)``); its origin is the best-ranked
ambulance station (``rank_stations``). Every pair is planned with ``plan_simulation`` and stepped
with ``engine.step`` until the run completes. One row per (route, mode):

    route mode est_normal est_greenwave est_standard arrived_at terminal min_kmh
    zero_ticks_outside_hold intersections

then a summary per mode: terminal-reason counts, the minimum pre-arrival speed (the arrival tick
excluded; ENABLED ticks that start or end held at a stop line, ``dwelling_intersection_id`` set,
are safety holds and counted separately), and for completed ENABLED runs the largest
``|arrived_at - est_greenwave|``, for completed DISABLED runs the largest
``|arrived_at - est_standard|`` (``standard_run_seconds``, the pre-run standard estimate) and
the slowest standard estimate in milliseconds. Measurements only: not collected by pytest,
not run by CI.
"""

import argparse
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from math import inf

from greenwave.dataset import DatasetSettings
from greenwave.dataset.loader import load_dataset
from greenwave.routing.errors import DestinationOffNetwork, NoStationReachable
from greenwave.routing.network_index import RoutingIndex, build_routing_index
from greenwave.routing.station_ranking import build_station_nodes, rank_stations
from greenwave.schemas import (
    GreenWaveMode,
    Position,
    SimulationCancelledEvent,
    SimulationCompletedEvent,
    SimulationStartRequest,
    VehicleType,
)
from greenwave.simulation.assembly import plan_simulation
from greenwave.simulation.standard_estimate import standard_run_seconds
from greenwave.simulation_settings import SimulationSettings

_START = datetime(2026, 10, 25, tzinfo=UTC)


@dataclass
class RunResult:
    route: int
    mode: GreenWaveMode
    est_normal: float
    est_greenwave: float
    est_standard: float
    est_standard_ms: float
    arrived_at: float | None
    terminal: str
    min_kmh: float
    zero_ticks_outside_hold: int
    hold_ticks: int
    intersections: int


@dataclass
class ModeSummary:
    terminals: Counter[str] = field(default_factory=Counter)
    min_kmh: float = inf
    hold_ticks: int = 0
    zero_ticks_outside_hold: int = 0
    max_greenwave_error_s: float = 0.0
    max_standard_error_s: float = 0.0
    max_standard_ms: float = 0.0


def run_once(
    route: int,
    request: SimulationStartRequest,
    index: RoutingIndex,
    settings: SimulationSettings,
) -> RunResult:
    planned = plan_simulation(index, request, settings)
    engine = planned.engine
    started = time.perf_counter()
    est_standard = standard_run_seconds(
        engine.route, engine.route_model, request.traffic_density_multiplier, settings
    )
    est_standard_ms = (time.perf_counter() - started) * 1000
    assert planned.response.estimated_standard_time_sec == round(est_standard)
    state = engine.initial_state()
    terminal = "none"
    min_kmh, zero_ticks, hold_ticks = inf, 0, 0
    while not state.completed:
        before = state
        state, events = engine.step(state, _START + timedelta(seconds=state.tick))
        for event in events:
            if isinstance(event, SimulationCompletedEvent):
                terminal = "completed"
            elif isinstance(event, SimulationCancelledEvent):
                terminal = event.reason.value
        if before.arrived or state.arrived:
            continue  # the arrival tick drives only part of the second
        held = (
            before.dwelling_intersection_id is not None
            or state.dwelling_intersection_id is not None
        )
        kmh = (state.distance_travelled_m - before.distance_travelled_m) * 3.6
        if held and request.green_wave_mode is GreenWaveMode.ENABLED:
            hold_ticks += 1
            continue
        if state.completed and terminal != "completed":
            continue  # a cancelled run's last tick
        min_kmh = min(min_kmh, kmh)
        zero_ticks += kmh == 0.0
    return RunResult(
        route=route,
        mode=request.green_wave_mode,
        est_normal=engine.estimates.normal_seconds,
        est_greenwave=engine.estimates.greenwave_seconds,
        est_standard=est_standard,
        est_standard_ms=est_standard_ms,
        arrived_at=state.arrived_at_s,
        terminal=terminal,
        min_kmh=min_kmh,
        zero_ticks_outside_hold=zero_ticks,
        hold_ticks=hold_ticks,
        intersections=len(engine.route_model.intersections),
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("--routes", type=int, default=40)
    parser.add_argument("--seed", type=int, default=11)
    parser.add_argument("--cascade", action="store_true")
    parser.add_argument("--density", type=float, default=1.0)
    args = parser.parse_args()

    dataset_settings = DatasetSettings()
    dataset = load_dataset(dataset_settings.processed_dir, dataset_settings.raw_manifest_path)
    settings = SimulationSettings()
    index = build_routing_index(dataset, settings)
    stations = build_station_nodes(dataset.stations, index)

    results: list[RunResult] = []
    skipped = 0
    sample = dataset.addresses.sample(n=args.routes, seed=args.seed)
    for route, row in enumerate(sample.iter_rows(named=True)):
        incident = Position(lat=row["lat"], lng=row["lng"])
        try:
            ranking = rank_stations(
                index, stations, incident, VehicleType.AMBULANCE, settings, args.density
            )
        except (DestinationOffNetwork, NoStationReachable) as error:
            print(f"{route:>3} skipped: {type(error).__name__}")
            skipped += 1
            continue
        origin = ranking.candidates[0].station.position
        for mode in (GreenWaveMode.ENABLED, GreenWaveMode.DISABLED):
            request = SimulationStartRequest(
                simulation_id=f"SIM-sample-{route}-{mode.value.lower()}",
                origin=origin,
                destination=incident,
                traffic_density_multiplier=args.density,
                enable_cascade_mode=args.cascade,
                vehicle_type=VehicleType.AMBULANCE,
                green_wave_mode=mode,
            )
            results.append(run_once(route, request, index, settings))

    print(
        "route mode     est_normal est_greenwave est_standard arrived_at terminal          "
        "min_kmh zero_ticks_outside_hold intersections"
    )
    for r in results:
        arrived = "-" if r.arrived_at is None else f"{r.arrived_at:.2f}"
        print(
            f"{r.route:>5} {r.mode.value:<8} {r.est_normal:>10.1f} {r.est_greenwave:>13.2f} "
            f"{r.est_standard:>12.2f} {arrived:>10} {r.terminal:<17} {r.min_kmh:>7.1f} "
            f"{r.zero_ticks_outside_hold:>23} "
            f"{r.intersections:>13}"
        )

    print(
        f"\nsummary (routes {args.routes}, seed {args.seed}, cascade {args.cascade}, "
        f"density {args.density}, skipped {skipped})"
    )
    for mode in (GreenWaveMode.ENABLED, GreenWaveMode.DISABLED):
        summary = ModeSummary()
        for r in (r for r in results if r.mode is mode):
            summary.terminals[r.terminal] += 1
            summary.min_kmh = min(summary.min_kmh, r.min_kmh)
            summary.hold_ticks += r.hold_ticks
            summary.zero_ticks_outside_hold += r.zero_ticks_outside_hold
            if mode is GreenWaveMode.ENABLED and r.terminal == "completed" and r.arrived_at:
                error = abs(r.arrived_at - r.est_greenwave)
                summary.max_greenwave_error_s = max(summary.max_greenwave_error_s, error)
            if mode is GreenWaveMode.DISABLED and r.terminal == "completed" and r.arrived_at:
                error = abs(r.arrived_at - r.est_standard)
                summary.max_standard_error_s = max(summary.max_standard_error_s, error)
            summary.max_standard_ms = max(summary.max_standard_ms, r.est_standard_ms)
        line = (
            f"{mode.value}: terminals {dict(summary.terminals)}; min pre-arrival "
            f"{summary.min_kmh:.1f} km/h; zero ticks outside holds "
            f"{summary.zero_ticks_outside_hold}"
        )
        if mode is GreenWaveMode.ENABLED:
            line += (
                f"; safety-hold ticks {summary.hold_ticks}; max |arrived_at - est_greenwave| "
                f"{summary.max_greenwave_error_s:.3f} s"
            )
        else:
            line += f"; max |arrived_at - est_standard| {summary.max_standard_error_s:.3f} s"
        line += f"; slowest standard estimate {summary.max_standard_ms:.1f} ms"
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
