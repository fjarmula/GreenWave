"""Main-only paired driving-time experiment. Run from backend: python -m experiments.grid."""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.metadata
import json
import platform
import subprocess
import time
from collections import Counter
from dataclasses import asdict, dataclass, fields
from datetime import UTC, datetime, timedelta
from itertools import combinations, product
from pathlib import Path
from statistics import mean, median
from typing import TypedDict

import polars as pl

from greenwave.dataset import DatasetSettings
from greenwave.dataset.loader import load_dataset
from greenwave.routing.edge_times import ambulance_edge_seconds
from greenwave.routing.network_index import RoutingIndex, build_routing_index
from greenwave.routing.station_ranking import build_station_nodes, rank_stations
from greenwave.schemas import (
    GreenWaveMode,
    ItsScenario,
    Position,
    SignalPhaseColor,
    SimulationCancelledEvent,
    SimulationStartRequest,
    VehicleType,
)
from greenwave.simulation.assembly import plan_simulation
from greenwave.simulation_settings import SimulationSettings

ROOT = Path(__file__).resolve().parents[2]
START = datetime(2026, 10, 25, tzinfo=UTC)
DENSITIES = (1.0, 1.5, 2.0, 2.5, 3.0)
TIE_TOLERANCE_S = 1e-6


class DriveResult(TypedDict):
    arrival_s: float
    edge_ids: tuple[str, ...]
    polyline: list[tuple[float, float]]
    intersections: int
    controlled_intersection_ids: list[str]
    stop_lines: int
    distance_m: float
    open_road_seconds: float
    standard_profile_seconds: float
    signal_decisions: list[dict[str, object]]
    hold_ticks: list[dict[str, object]]
    fallback_ids: list[str]
    requests: list[dict[str, object]]
    common_slowdown_starts: list[dict[str, object]]
    common_slowdown_seconds_spent: float
    other_extra_seconds: float


@dataclass(frozen=True)
class Incident:
    address: str
    lat: float
    lng: float


@dataclass
class Pair:
    incident: int
    address: str
    station_rank: int
    density: float
    status: str = "pending"
    error: str = ""
    station_id: str = ""
    station_name: str = ""
    origin_lat: float | None = None
    origin_lng: float | None = None
    destination_lat: float | None = None
    destination_lng: float | None = None
    intersections: int | None = None
    stop_lines: int | None = None
    distance_m: float | None = None
    walk_seconds: float = 0
    standard_seconds: float | None = None
    greenwave_seconds: float | None = None
    saved_seconds: float | None = None
    saved_percent: float | None = None
    standard_diagnostics: str = ""
    greenwave_diagnostics: str = ""

    def __post_init__(self) -> None:
        if self.standard_seconds is not None and self.greenwave_seconds is not None:
            self.saved_seconds = self.standard_seconds - self.greenwave_seconds
            self.saved_percent = (
                100 * self.saved_seconds / self.standard_seconds if self.standard_seconds else None
            )


def choose_incidents(addresses: pl.DataFrame) -> list[Incident]:
    """Keep original sample order and label-based duplicate exclusion exactly."""
    rows = list(addresses.sample(n=100, seed=11).iter_rows(named=True))
    labels = {row["label"] for row in rows}
    for row in addresses.sample(n=300, seed=29).iter_rows(named=True):
        if row["label"] not in labels:
            rows.append(row)
            labels.add(row["label"])
        if len(rows) == 200:
            break
    if len(rows) != 200 or len(labels) != 200:
        raise ValueError("Dataset cannot supply the 200 distinct incident addresses in the recipe")
    return [Incident(str(row["label"]), float(row["lat"]), float(row["lng"])) for row in rows]


def grouped_rows(pairs: list[Pair], densities: list[float]) -> list[dict[str, object]]:
    """All marginal and joint strata; undefined statistics stay blank, never zero-filled."""
    maximum = max((p.intersections for p in pairs if p.intersections is not None), default=0)
    dimensions: dict[str, list[float]] = {
        "station_rank": [1, 2, 3],
        "density": densities,
        "intersections": list(range(maximum + 1)),
    }
    result = []
    for size in range(4):
        for names in combinations(dimensions, size):
            for values in product(*(dimensions[name] for name in names)):
                selected = [
                    p
                    for p in pairs
                    if all(getattr(p, n) == v for n, v in zip(names, values, strict=True))
                ]
                completed = [p for p in selected if p.status == "completed"]
                savings = [p.saved_seconds for p in completed if p.saved_seconds is not None]
                percents = [p.saved_percent for p in completed if p.saved_percent is not None]
                standard = [p.standard_seconds for p in completed if p.standard_seconds is not None]
                greenwave = [
                    p.greenwave_seconds for p in completed if p.greenwave_seconds is not None
                ]
                count = len(savings)
                faster = sum(s > TIE_TOLERANCE_S for s in savings)
                slower = sum(s < -TIE_TOLERANCE_S for s in savings)
                statuses = Counter(p.status for p in selected)
                row: dict[str, object] = {
                    "group_by": "+".join(names) or "overall",
                    "station_rank": None,
                    "density": None,
                    "intersections": None,
                    "attempts": len(selected),
                    "count": count,
                    "failed": statuses["failed"],
                    "on_site": statuses["on_site"],
                    "missing_candidate": statuses["missing_candidate"],
                    "faster": faster,
                    "tied": count - faster - slower,
                    "slower": slower,
                    "faster_percent": 100 * faster / count if count else None,
                    "tied_percent": 100 * (count - faster - slower) / count if count else None,
                    "slower_percent": 100 * slower / count if count else None,
                }
                row.update(zip(names, values, strict=True))
                for label, numbers in [
                    ("saved_seconds", savings),
                    ("saved_percent", percents),
                    ("standard_seconds", standard),
                    ("greenwave_seconds", greenwave),
                ]:
                    row[f"mean_{label}"] = mean(numbers) if numbers else None
                    row[f"median_{label}"] = median(numbers) if numbers else None
                result.append(row)
    return result


def fastest_rows(pairs: list[Pair]) -> list[dict[str, object]]:
    result = []
    for incident, density in sorted({(p.incident, p.density) for p in pairs}):
        candidates = [p for p in pairs if p.incident == incident and p.density == density]
        eligible = [p for p in candidates if p.status in {"completed", "on_site"}]
        row: dict[str, object] = {
            "incident": incident,
            "density": density,
            "complete_three_candidates": len(eligible) == 3,
            "available_candidates": len(eligible),
        }
        for mode in ["standard", "greenwave"]:
            known = [
                p
                for p in candidates
                if getattr(p, f"{mode}_seconds") is not None
                and (
                    p.status in {"completed", "on_site"}
                    or (
                        p.status == "failed"
                        and (p.standard_seconds is None or p.greenwave_seconds is None)
                    )
                )
            ]
            row[f"{mode}_available_candidates"] = len(known)
            row[f"{mode}_complete_three_candidates"] = len(known) == 3
            best = min((getattr(p, f"{mode}_seconds") for p in known), default=None)
            winners = [
                p for p in known if abs(getattr(p, f"{mode}_seconds") - best) <= TIE_TOLERANCE_S
            ]
            row[f"{mode}_station_ids"] = "|".join(p.station_id for p in winners)
            row[f"{mode}_station_ranks"] = "|".join(str(p.station_rank) for p in winners)
            row[f"{mode}_seconds"] = best
        result.append(row)
    return result


def run_drive(
    request: SimulationStartRequest,
    index: RoutingIndex,
    settings: SimulationSettings,
    max_seconds: int,
) -> DriveResult:
    """Run the actual engine, including controller feedback; stop measuring at arrival."""
    planned = plan_simulation(index, request, settings)
    engine = planned.engine
    decisions: list[dict[str, object]] = []
    original_color = engine.controller.ordinary_route_color_at
    original_wait = engine.controller.ordinary_route_seconds_until_green

    def observe_color(intersection_id: str, at_simulated_sec: float) -> SignalPhaseColor | None:
        at_s = at_simulated_sec
        color = original_color(intersection_id, at_s)
        decisions.append(
            {
                "intersection_id": intersection_id,
                "at_s": at_s,
                "color": None if color is None else color.value,
                "wait_until_green_s": original_wait(intersection_id, at_s),
            }
        )
        return color

    engine.controller.ordinary_route_color_at = observe_color  # type: ignore[method-assign]
    state = engine.initial_state()
    holds: list[dict[str, object]] = []
    common_starts: list[dict[str, object]] = []
    common_spent = 0.0
    try:
        for _ in range(max_seconds):
            before = state
            state, events = engine.step(state, START + timedelta(seconds=state.tick))
            started = state.slowdown_intersection_ids - before.slowdown_intersection_ids
            common_spent += (
                before.cautious_time_remaining_s
                + len(started) * settings.min_intersection_delay_seconds
                - state.cautious_time_remaining_s
            )
            for owner in sorted(started):
                common_starts.append(
                    {
                        "intersection_id": owner,
                        "tick": state.tick,
                        "extra_s": settings.min_intersection_delay_seconds,
                    }
                )
            # A stationary or partially-held tick is diagnostic, not an exact hold duration.
            if before.dwelling_intersection_id or state.dwelling_intersection_id:
                holds.append(
                    {
                        "tick": state.tick,
                        "before_m": before.distance_travelled_m,
                        "after_m": state.distance_travelled_m,
                        "before_owner": before.dwelling_intersection_id,
                        "after_owner": state.dwelling_intersection_id,
                    }
                )
            for event in events:
                if isinstance(event, SimulationCancelledEvent):
                    raise RuntimeError(f"Engine cancelled: {event.reason.value}")
            if state.arrived_at_s is not None:
                if (
                    request.green_wave_mode is GreenWaveMode.DISABLED
                    and abs(state.arrived_at_s - engine.standard_profile.total_seconds)
                    > TIE_TOLERANCE_S
                ):
                    raise RuntimeError("Actual Standard arrival differs from dry-run profile")
                open_seconds = sum(ambulance_edge_seconds(e, settings) for e in engine.route.edges)
                return {
                    "arrival_s": state.arrived_at_s,
                    "edge_ids": engine.route.edge_ids,
                    "polyline": engine.route.polyline_wgs84,
                    "intersections": len(engine.route_model.intersections),
                    "controlled_intersection_ids": [i.id for i in engine.route_model.intersections],
                    "stop_lines": len(engine.route.stop_lines),
                    "distance_m": engine.route.total_distance_m,
                    "open_road_seconds": open_seconds,
                    "standard_profile_seconds": engine.standard_profile.total_seconds,
                    "signal_decisions": decisions,
                    "hold_ticks": holds,
                    "fallback_ids": sorted(state.fallback_intersection_ids),
                    "requests": [r.model_dump(mode="json") for r in engine.ledger.snapshots()],
                    "common_slowdown_starts": common_starts,
                    "common_slowdown_seconds_spent": common_spent,
                    # Includes cautious ordinary-limit travel and holds, not pure red loss.
                    "other_extra_seconds": state.arrived_at_s - open_seconds - common_spent,
                }
        raise RuntimeError(f"No arrival within {max_seconds} simulated seconds")
    finally:
        engine.close()


def write_csv(path: Path, rows: list[dict[str, object]], columns: list[str] | None = None) -> None:
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns or list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_report(out: Path, pairs: list[Pair], densities: list[float]) -> None:
    groups = grouped_rows(pairs, densities)
    write_csv(out / "grouped.csv", groups)
    best = fastest_rows(pairs)
    if best:
        write_csv(out / "fastest-stations.csv", best)
    slower = [
        asdict(p)
        for p in pairs
        if p.status == "completed"
        and p.saved_seconds is not None
        and p.saved_seconds < -TIE_TOLERANCE_S
    ]
    write_csv(out / "slower-cases.csv", slower, [f.name for f in fields(Pair)])
    summary = {
        "statuses": dict(Counter(p.status for p in pairs)),
        "overall": groups[0],
        "observed_max_intersections": max(
            (p.intersections for p in pairs if p.intersections is not None), default=0
        ),
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    lines = [
        "# Paired driving-time model experiment",
        "",
        "These are simulation model results, not measured real-world benefits.",
        "Density/station combinations repeat incidents and are not independent incidents.",
        "Larger savings from a more distant station do not imply a better dispatch decision.",
        "Driving times exclude walking and post-arrival recovery. Negative savings are retained.",
        "Controlled intersection IDs count signals, not every physical road junction.",
        "Percent savings are computed per pair against Standard, then averaged/median aggregated.",
        f"Ties use an absolute {TIE_TOLERANCE_S:g} second tolerance.",
        "",
        "```json",
        json.dumps(summary, indent=2),
        "```",
        "",
        "| Density | Rank | Pairs | Mean saving (s) | Median (s) | Faster / tied / slower |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for row in groups:
        if row["group_by"] == "station_rank+density":
            lines.append(
                f"| {row['density']} | {row['station_rank']} | {row['count']} | "
                f"{row['mean_saved_seconds']} | {row['median_saved_seconds']} | "
                f"{row['faster']} / {row['tied']} / {row['slower']} |"
            )
    lines += [
        "",
        "See grouped.csv for every marginal/joint stratum, including empty groups from",
        "zero through the observed maximum. Empty statistics are blank (undefined).",
        "all-pairs.csv retains every attempted pair and per-mode diagnostics; slower-cases.csv",
        "duplicates slower rows for inspection. Failed/missing/on-site rows are excluded from",
        "driving-benefit statistics. fastest-stations.csv includes on-site zero-drive candidates",
        "and flags incomplete sets per mode; successful partial-mode results are retained.",
        "Hold ticks include partial ticks and do not claim exact stationary seconds.",
        "Common slowdown consumption is exact; other_extra_seconds includes holds, cautious",
        "time and travel at the ordinary crossing limit. No causal decomposition is inferred.",
        "The old pre-fix results are not numerical acceptance targets or post-fix evidence.",
    ]
    (out / "REPORT.md").write_text("\n".join(lines) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--smoke", action="store_true", help="2 incidents, 3 stations, densities 1/1.5"
    )
    parser.add_argument(
        "--output", type=Path, required=True, help="New output directory; never overwrite"
    )
    parser.add_argument("--max-seconds", type=int, default=36000, help="Per-engine arrival limit")
    args = parser.parse_args()
    if args.max_seconds <= 0:
        parser.error("--max-seconds must be positive")
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    started = time.perf_counter()
    ds = DatasetSettings()
    settings = SimulationSettings(
        **{name: field.default for name, field in SimulationSettings.model_fields.items()}
    )
    data = load_dataset(ds.processed_dir, ds.raw_manifest_path)
    index = build_routing_index(data, settings)
    stations = build_station_nodes(data.stations, index)
    incidents = choose_incidents(data.addresses)
    if args.smoke:
        incidents = incidents[:2]
    densities = list(DENSITIES[:2] if args.smoke else DENSITIES)
    metadata = {
        "revision": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "dirty_status": subprocess.check_output(
            ["git", "status", "--porcelain"], cwd=ROOT, text=True
        ),
        "created_utc": datetime.now(UTC).isoformat(),
        "clock_start": START.isoformat(),
        "manifest_sha256": sha256(ds.raw_manifest_path),
        "processed_files_sha256": {
            p.name: sha256(p)
            for p in sorted(ds.processed_dir.iterdir())
            if p.is_file() and p.name != ".gitkeep"
        },
        "runner_sha256": sha256(Path(__file__)),
        "python": platform.python_version(),
        "polars": importlib.metadata.version("polars"),
        "uv_lock_sha256": sha256(ROOT / "backend/uv.lock"),
        "settings": settings.model_dump(mode="json"),
        "arguments": {"smoke": args.smoke, "output": str(out), "max_seconds": args.max_seconds},
        "sampling": {
            "first_n": 100,
            "first_seed": 11,
            "additional_pool_n": 300,
            "additional_seed": 29,
            "distinct_key": "label",
        },
        "vehicle": "AMBULANCE",
        "its_scenario": "NOMINAL",
        "cascade": True,
        "ranking_density": 1.5,
        "its_outcome_seed": 0,
        "playback_speed": 1,
        "densities": densities,
        "incidents": [asdict(i) for i in incidents],
        "status": "running",
        "settings_source": "declared defaults; simulation environment overrides ignored",
        "tie_tolerance_s": TIE_TOLERANCE_S,
    }
    meta_path = out / "metadata.json"
    meta_path.write_text(json.dumps(metadata, indent=2) + "\n")
    pairs: list[Pair] = []
    try:
        with (out / "all-pairs.csv").open("w", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=[f.name for f in fields(Pair)])
            writer.writeheader()
            for number, incident in enumerate(incidents):
                destination = Position(lat=incident.lat, lng=incident.lng)
                ranking_error = ""
                candidates = []
                try:
                    ranking = rank_stations(
                        index, stations, destination, VehicleType.AMBULANCE, settings, 1.5
                    )
                    candidates = list(ranking.candidates[:3])
                except Exception as exc:
                    ranking_error = f"{type(exc).__name__}: {exc}"
                for rank in range(1, 4):
                    candidate = candidates[rank - 1] if rank <= len(candidates) else None
                    for density in densities:
                        pair = Pair(
                            number,
                            incident.address,
                            rank,
                            density,
                            destination_lat=incident.lat,
                            destination_lng=incident.lng,
                        )
                        if candidate is None:
                            pair.status = "failed" if ranking_error else "missing_candidate"
                            pair.error = (
                                ranking_error or "Ranking returned fewer than three candidates"
                            )
                        else:
                            pair.station_id = candidate.station.station_id
                            pair.station_name = candidate.station.name
                            pair.origin_lat = candidate.station.position.lat
                            pair.origin_lng = candidate.station.position.lng
                            pair.walk_seconds = (
                                (candidate.walk_seconds or 0)
                                if candidate.on_site
                                else (candidate.on_foot.on_foot_seconds if candidate.on_foot else 0)
                            )
                            if candidate.on_site:
                                pair.status, pair.intersections = "on_site", 0
                                pair.standard_seconds = pair.greenwave_seconds = 0.0
                            else:
                                results: dict[str, DriveResult] = {}
                                errors = []
                                for mode in [GreenWaveMode.DISABLED, GreenWaveMode.ENABLED]:
                                    request = SimulationStartRequest(
                                        simulation_id=(
                                            f"SIM-grid-{number}-{rank}-"
                                            f"{int(density * 10)}-{mode.value}"
                                        ),
                                        origin=candidate.station.position,
                                        destination=destination,
                                        vehicle_type=VehicleType.AMBULANCE,
                                        green_wave_mode=mode,
                                        traffic_density_multiplier=density,
                                        enable_cascade_mode=True,
                                        its_scenario=ItsScenario.NOMINAL,
                                    )
                                    try:
                                        results[mode.value] = run_drive(
                                            request, index, settings, args.max_seconds
                                        )
                                    except Exception as exc:
                                        errors.append(f"{mode.value}: {type(exc).__name__}: {exc}")
                                standard = results.get("DISABLED")
                                greenwave = results.get("ENABLED")
                                for label, result in [
                                    ("standard", standard),
                                    ("greenwave", greenwave),
                                ]:
                                    if result:
                                        setattr(pair, f"{label}_seconds", result["arrival_s"])
                                        setattr(pair, f"{label}_diagnostics", json.dumps(result))
                                        pair.intersections = result["intersections"]
                                        pair.stop_lines = result["stop_lines"]
                                        pair.distance_m = result["distance_m"]
                                if (
                                    standard
                                    and greenwave
                                    and (
                                        standard["edge_ids"] != greenwave["edge_ids"]
                                        or standard["polyline"] != greenwave["polyline"]
                                    )
                                ):
                                    errors.append("Paired road geometry differs")
                                pair.status = "failed" if errors else "completed"
                                pair.error = "; ".join(errors)
                                pair.__post_init__()
                        pairs.append(pair)
                        writer.writerow(asdict(pair))
                        stream.flush()
                print(
                    f"{number + 1}/{len(incidents)} incidents; {len(pairs)} pair records",
                    flush=True,
                )
        metadata["status"] = (
            "completed_with_failures" if any(p.status == "failed" for p in pairs) else "completed"
        )
    finally:
        if metadata["status"] == "running":
            metadata["status"] = "interrupted"
        metadata["wall_seconds"] = time.perf_counter() - started
        metadata["pair_records"] = len(pairs)
        meta_path.write_text(json.dumps(metadata, indent=2) + "\n")
        write_report(out, pairs, densities)
    return int(metadata["status"] != "completed")


if __name__ == "__main__":
    raise SystemExit(main())
