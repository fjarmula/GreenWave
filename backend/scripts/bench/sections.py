"""Measurement sections: dataset load, server start, routing latency and ETL step times."""

import gc
import json
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path
from typing import Any

import networkx as nx
import numpy as np

from bench.constants import (
    BACKEND,
    ETL_REPS,
    HEADLINE_STEPS,
    LOAD_COLD_PROCESSES,
    LOAD_WARM_CALLS,
    MANIFEST,
    PAIRS_PER_STRATUM,
    PROCESSED,
    SEED,
    SERVER_RUNS,
    STRATA_KM,
    TIMING_PASSES,
    WARMUP_PAIRS,
)
from bench.stats import spread, stats_ms
from bench.workers import run_worker


def section_load(scratch: Path, quick: bool) -> dict[str, Any]:
    cold_n = 2 if quick else LOAD_COLD_PROCESSES
    warm_n = 3 if quick else LOAD_WARM_CALLS
    cold, rss_before, rss_after, peak = [], [], [], []
    counts = None
    for i in range(cold_n):
        out = scratch / f"load_cold_{i}.json"
        run_worker(["--worker", "load", "--calls", "1", "--out", str(out)], scratch / "worker.log")
        rec = json.loads(out.read_text(encoding="utf-8"))
        cold.append(rec["calls_s"][0])
        rss_before.append(rec["rss_before_kib"])
        rss_after.append(rec["rss_after_kib"][0])
        peak.append(rec["peak_rss_kib"])
        counts = rec["counts"]
    out = scratch / "load_warm.json"
    run_worker(
        ["--worker", "load", "--calls", str(warm_n + 1), "--time-hashing", "--out", str(out)],
        scratch / "worker.log",
    )
    warm_rec = json.loads(out.read_text(encoding="utf-8"))
    return {
        "what": "load_dataset(data/processed, MANIFEST.json); imports are not timed. 'cold' = "
        "first call in a fresh process with the files in the OS page cache (not a cold disk). "
        "'warm' = calls 2.. in one process.",
        "counts": counts,
        "cold_processes": stats_ms(cold),
        "cold_runs_s": cold,
        "warm_calls": stats_ms(warm_rec["calls_s"][1:]),
        "warm_runs_s": warm_rec["calls_s"][1:],
        "first_call_in_warm_process_s": warm_rec["calls_s"][0],
        "hashing_of_the_six_files": stats_ms(warm_rec["hashing_calls_s"]),
        "memory_mib": {
            "rss_before_load_median": float(np.median(rss_before)) / 1024,
            "rss_after_load_median": float(np.median(rss_after)) / 1024,
            "rss_after_load_min": min(rss_after) / 1024,
            "rss_after_load_max": max(rss_after) / 1024,
            "peak_rss_median": float(np.median(peak)) / 1024,
            "rss_after_each_warm_call": [v / 1024 for v in warm_rec["rss_after_kib"]],
        },
    }


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def section_serve(quick: bool) -> dict[str, Any]:
    runs = []
    for _ in range(2 if quick else SERVER_RUNS):
        port = free_port()
        url = f"http://127.0.0.1:{port}/api/v1/health"
        started = time.perf_counter()
        process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "greenwave.main:app", "--port", str(port)],
            cwd=BACKEND,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        ready = None
        while time.perf_counter() - started < 60:
            if process.poll() is not None:
                raise RuntimeError(f"uvicorn exited early with {process.returncode}")
            try:
                with urllib.request.urlopen(url, timeout=0.5) as response:
                    if response.status == 200:
                        ready = time.perf_counter() - started
                        break
            except (urllib.error.URLError, OSError):
                time.sleep(0.01)
        process.terminate()
        process.wait(timeout=15)
        if ready is None:
            raise RuntimeError("uvicorn did not answer /api/v1/health within 60 s")
        runs.append(ready)
    return {
        "what": "`python -m uvicorn greenwave.main:app --port <free>` (venv interpreter, no "
        "`uv run` wrapper) from just before Popen to the first /api/v1/health 200; polled every "
        "10 ms, so each value can be up to about 10 ms late. Includes interpreter start, imports, "
        "the lifespan load_dataset and the first request. Fresh process each time.",
        "runs_s": runs,
        "summary": stats_ms(runs),
    }


def best_edge(
    graph: nx.MultiDiGraph, u: str, v: str, key: Callable[[dict[str, Any]], float]
) -> dict[str, Any]:
    return min(graph[u][v].values(), key=key)


def travel_time(attrs: dict[str, Any]) -> float:
    return float(attrs["length_m"]) / (float(attrs["speed_kmh"]) / 3.6)


def weight_callable(_u: str, _v: str, parallel: dict[Any, dict[str, Any]]) -> float:
    return min(travel_time(a) for a in parallel.values())


def _sample_pairs(
    nodes: list[str], xy: np.ndarray, per_stratum: int
) -> tuple[list[tuple[int, int, int]], dict[str, int]]:
    """Seeded node pairs per straight-line stratum: (stratum, source index, target index)."""
    rng = np.random.default_rng(SEED)
    draws = 2_000_000
    first, second = rng.integers(0, len(nodes), draws), rng.integers(0, len(nodes), draws)
    straight_m = np.hypot(*(xy[first] - xy[second]).T)
    pairs: list[tuple[int, int, int]] = []
    quota_met = {}
    for index, (low, high) in enumerate(STRATA_KM):
        chosen = np.nonzero(
            (straight_m >= low * 1000) & (straight_m < high * 1000) & (first != second)
        )[0]
        chosen = chosen[:per_stratum]
        quota_met[f"{low:g}-{high:g} km"] = int(chosen.size)
        pairs += [(index, int(first[i]), int(second[i])) for i in chosen]
    return pairs, quota_met


def _warmup_pairs(nodes: list[str]) -> list[tuple[str, str]]:
    warm_rng = np.random.default_rng(SEED + 1)
    return [
        (nodes[int(a)], nodes[int(b)])
        for a, b in zip(
            warm_rng.integers(0, len(nodes), WARMUP_PAIRS),
            warm_rng.integers(0, len(nodes), WARMUP_PAIRS),
            strict=True,
        )
    ]


def _precomputed_copy(graph: nx.MultiDiGraph) -> nx.MultiDiGraph:
    """Benchmark-only copy with the weight precomputed into an edge attribute."""
    precomputed = graph.copy()
    for *_, attrs in precomputed.edges(keys=True, data=True):
        attrs["travel_time_s"] = travel_time(attrs)
    return precomputed


@dataclass(frozen=True, slots=True)
class _IntersectionLookup:
    """Benchmark-only per-intersection lookup (not the routing step): edge -> INT, INT -> D_v."""

    edge_to_int: dict[str, str]
    delay_of: dict[str, float]
    conflicts: int
    build_s: float

    @classmethod
    def build(cls, dataset: Any) -> "_IntersectionLookup":
        started = time.perf_counter()
        approaches = dataset.signal_approaches.filter(
            dataset.signal_approaches["intersection_id"].is_not_null()
        )
        edge_to_int: dict[str, str] = {}
        conflicts = 0
        for row in approaches.select("intersection_id", "controlled_edge_ids").iter_rows():
            for edge_id in row[1]:
                if edge_to_int.setdefault(edge_id, row[0]) != row[0]:
                    conflicts += 1
        delay_of = dict(
            dataset.intersections.select("intersection_id", "delay_seconds").iter_rows()
        )
        return cls(edge_to_int, delay_of, conflicts, time.perf_counter() - started)

    def along(self, graph: nx.MultiDiGraph, path: list[str]) -> tuple[int, float]:
        seen = set()
        for u, v in pairwise(path):
            owner = self.edge_to_int.get(best_edge(graph, u, v, travel_time)["edge_id"])
            if owner is not None:
                seen.add(owner)
        return len(seen), sum(self.delay_of[i] for i in seen)


@dataclass(slots=True)
class _SearchTimings:
    callable_s: np.ndarray
    precomputed_s: np.ndarray
    paths: list[list[str]]
    cost_mismatch: int


def _time_searches(
    graph: nx.MultiDiGraph,
    precomputed: nx.MultiDiGraph,
    endpoints: list[tuple[str, str]],
    passes: int,
) -> _SearchTimings:
    """Both search variants back to back per pair, every pass; paths from the first pass."""
    count = len(endpoints)
    latency_callable = np.empty((passes, count))
    latency_precomputed = np.empty((passes, count))
    paths: list[list[str]] = [[] for _ in range(count)]
    cost_mismatch = 0
    for round_index in range(passes):
        gc.collect()
        for k, (source, target) in enumerate(endpoints):
            t0 = time.perf_counter()
            cost_a, path_a = nx.bidirectional_dijkstra(
                graph, source, target, weight=weight_callable
            )
            t1 = time.perf_counter()
            cost_b, _ = nx.bidirectional_dijkstra(
                precomputed, source, target, weight="travel_time_s"
            )
            t2 = time.perf_counter()
            latency_callable[round_index, k] = t1 - t0
            latency_precomputed[round_index, k] = t2 - t1
            if round_index == 0:
                paths[k] = path_a
                cost_mismatch += abs(cost_a - cost_b) > 1e-6 * max(1.0, cost_a)
    return _SearchTimings(latency_callable, latency_precomputed, paths, cost_mismatch)


@dataclass(slots=True)
class _LookupTimings:
    latency_s: np.ndarray
    results: list[tuple[int, float]]


def _time_lookups(
    graph: nx.MultiDiGraph, lookup: _IntersectionLookup, paths: list[list[str]], passes: int
) -> _LookupTimings:
    count = len(paths)
    latency_lookup = np.empty((passes, count))
    lookups = [(0, 0.0)] * count
    for round_index in range(passes):
        gc.collect()
        for k in range(count):
            t0 = time.perf_counter()
            lookups[k] = lookup.along(graph, paths[k])
            latency_lookup[round_index, k] = time.perf_counter() - t0
    return _LookupTimings(latency_lookup, lookups)


def _per_pair_values(
    graph: nx.MultiDiGraph,
    pairs: list[tuple[int, int, int]],
    xy: np.ndarray,
    searches: _SearchTimings,
    lookups: _LookupTimings,
) -> list[dict[str, Any]]:
    """Untimed descriptive values per pair."""
    per_pair = []
    for k, (stratum, a, b) in enumerate(pairs):
        edges = [best_edge(graph, u, v, travel_time) for u, v in pairwise(searches.paths[k])]
        per_pair.append(
            {
                "stratum": stratum,
                "straight_line_m": float(np.hypot(*(xy[a] - xy[b]))),
                "route_m": float(sum(e["length_m"] for e in edges)),
                "route_edges": len(edges),
                "route_drive_time_s": float(sum(travel_time(e) for e in edges)),
                "unique_intersections": lookups.results[k][0],
                "delay_sum_s": lookups.results[k][1],
                "callable_ms": float(np.median(searches.callable_s[:, k]) * 1000),
                "precomputed_ms": float(np.median(searches.precomputed_s[:, k]) * 1000),
                "lookup_ms": float(np.median(lookups.latency_s[:, k]) * 1000),
            }
        )
    return per_pair


def _strata_summary(
    pairs: list[tuple[int, int, int]],
    per_pair: list[dict[str, Any]],
    pair_median: dict[str, np.ndarray],
) -> list[dict[str, Any]]:
    strata = []
    for index, (low, high) in enumerate(STRATA_KM):
        members = [k for k, p in enumerate(pairs) if p[0] == index]
        if not members:
            continue
        strata.append(
            {
                "straight_line_km": f"{low:g}-{high:g}" if high != float("inf") else f"{low:g}+",
                "n": len(members),
                "route_km": spread([per_pair[k]["route_m"] / 1000 for k in members]),
                "route_edges": spread([per_pair[k]["route_edges"] for k in members]),
                "latency_callable_weight": stats_ms(pair_median["callable"][members]),
                "latency_precomputed_weight": stats_ms(pair_median["precomputed"][members]),
                "per_int_lookup_sketch": stats_ms(pair_median["lookup"][members]),
                "unique_intersections_per_route": spread(
                    [per_pair[k]["unique_intersections"] for k in members]
                ),
            }
        )
    return strata


def section_routing(quick: bool) -> dict[str, Any]:
    from greenwave.dataset import load_dataset

    per_stratum = 20 if quick else PAIRS_PER_STRATUM
    passes = 2 if quick else TIMING_PASSES
    dataset = load_dataset(PROCESSED, MANIFEST)
    graph = dataset.graph

    speeds = [d["speed_kmh"] for *_, d in graph.edges(data=True)]
    if min(speeds) <= 0:
        raise RuntimeError("an edge has speed_kmh <= 0")

    started = time.perf_counter()
    largest = max(nx.strongly_connected_components(graph), key=len)
    scc_s = time.perf_counter() - started
    nodes = sorted(largest)
    xy = np.array([[graph.nodes[n]["x_m"], graph.nodes[n]["y_m"]] for n in nodes])

    pairs, quota_met = _sample_pairs(nodes, xy, per_stratum)
    warm_pairs = _warmup_pairs(nodes)
    precomputed = _precomputed_copy(graph)
    for source, target in warm_pairs:
        if source != target:
            nx.bidirectional_dijkstra(graph, source, target, weight=weight_callable)
            nx.bidirectional_dijkstra(precomputed, source, target, weight="travel_time_s")
    lookup = _IntersectionLookup.build(dataset)

    endpoints = [(nodes[a], nodes[b]) for _, a, b in pairs]
    searches = _time_searches(graph, precomputed, endpoints, passes)
    lookups = _time_lookups(graph, lookup, searches.paths, passes)
    per_pair = _per_pair_values(graph, pairs, xy, searches, lookups)
    pair_median = {
        "callable": np.median(searches.callable_s, axis=0),
        "precomputed": np.median(searches.precomputed_s, axis=0),
        "lookup": np.median(lookups.latency_s, axis=0),
    }
    strata = _strata_summary(pairs, per_pair, pair_median)
    return {
        "what": "networkx.bidirectional_dijkstra on the loaded MultiDiGraph, weight = "
        "length_m / (speed_kmh / 3.6) seconds (minimum over parallel edges). 'callable' computes "
        "the "
        "weight inside the search; 'precomputed' uses an edge attribute on a benchmark-only copy "
        "of "
        "the graph. Intersection delays are NOT in the weight (D_v is once per unique INT, not per "
        "edge). 'per_int_lookup_sketch' = edge choice along the found path plus the unique-INT "
        "lookup; benchmark-only, not the routing step.",
        "seed": SEED,
        "graph": {"nodes": graph.number_of_nodes(), "edges": graph.number_of_edges()},
        "largest_scc_nodes": len(largest),
        "largest_scc_seconds": scc_s,
        "strata_requested_per_stratum": per_stratum,
        "strata_pairs_drawn": quota_met,
        "pairs": len(pairs),
        "passes_per_pair": passes,
        "warmup_pairs": WARMUP_PAIRS,
        "per_pair_value": "median of the passes; statistics are over pairs",
        "percentile_method": "numpy linear interpolation",
        "pooled_all_pairs": {
            "latency_callable_weight": stats_ms(pair_median["callable"], p99=True),
            "latency_precomputed_weight": stats_ms(pair_median["precomputed"], p99=True),
            "per_int_lookup_sketch": stats_ms(pair_median["lookup"], p99=True),
            "max_single_timing_callable_ms": float(searches.callable_s.max() * 1000),
            "max_single_timing_precomputed_ms": float(searches.precomputed_s.max() * 1000),
        },
        "by_straight_line_stratum": strata,
        "cost_mismatches_callable_vs_precomputed": int(searches.cost_mismatch),
        "edge_to_intersection_conflicts": lookup.conflicts,
        "lookup_tables_build_s": lookup.build_s,
        "per_pair": per_pair,
        "raw_timings_s": {
            "callable": searches.callable_s.tolist(),
            "precomputed": searches.precomputed_s.tolist(),
            "lookup": lookups.latency_s.tolist(),
        },
    }


def section_etl(scratch: Path, quick: bool, only_steps: list[str]) -> dict[str, Any]:
    data = scratch / "data"
    (data / "processed").mkdir(parents=True, exist_ok=True)
    for name in ("raw", "overrides"):
        link = data / name
        if not link.exists():
            link.symlink_to(BACKEND / "data" / name, target_is_directory=True)
    steps: dict[str, Any] = {}
    for step, reps in ETL_REPS.items():
        if step not in only_steps:
            continue
        runs = []
        for i in range(1 if quick else reps):
            out = scratch / f"etl_{step}_{i}.json"
            started = time.perf_counter()
            run_worker(
                ["--worker", "etl", "--step", step, "--scratch", str(scratch), "--out", str(out)],
                scratch / "worker.log",
            )
            wall = time.perf_counter() - started
            record = json.loads(out.read_text(encoding="utf-8"))
            record["subprocess_wall_s"] = wall
            runs.append(record)
            print(f"  etl {step} run {i + 1}: main() {record['main_s']:.1f} s", flush=True)
        main_s = [r["main_s"] for r in runs]
        steps[step] = {
            "headline": step in HEADLINE_STEPS,
            "needed_for_server_artifacts": step in HEADLINE_STEPS,
            "runs": runs,
            "main_s": {
                "n": len(main_s),
                "min": min(main_s),
                "median": float(np.median(main_s)),
                "max": max(main_s),
            },
            "first_run_main_s": main_s[0],
        }
    headline = [steps[s]["main_s"]["median"] for s in HEADLINE_STEPS if s in steps]
    return {
        "what": "Each run: a fresh `python scripts/benchmark.py --worker etl` process imports "
        "scripts/run_etl.py and calls its main() with sys.argv = [run_etl.py, <step>] after "
        "setting "
        "DATA_DIR, OVERRIDES_DIR and REPORT_PATH to a scratch copy (raw and overrides are symlinks "
        "to the repo, read-only use). main_s therefore includes argparse, logging.basicConfig, the "
        "step and its print; it excludes interpreter start and imports (see subprocess_wall_s). "
        "The "
        "page cache is warm after the first run, so run 1 is reported separately. Steps profile, "
        "signals and graph are not required for the server artifacts.",
        "scratch_processed_dir_is_outside_repo": True,
        "steps": steps,
        "headline_sum_of_medians_s": float(sum(headline))
        if len(headline) == len(HEADLINE_STEPS)
        else None,
        "repetitions": {s: (1 if quick else n) for s, n in ETL_REPS.items() if s in only_steps},
    }
