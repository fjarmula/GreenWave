"""T8 benchmark: measurements only. Not collected by pytest, not run by CI, results not committed.

    uv run python scripts/benchmark.py --scratch /path/outside/the/repo
    uv run python scripts/benchmark.py --scratch DIR --quick --only load,serve,routing

Sections (``--only`` picks some): ``load`` (load_dataset cold and warm, memory, hashing share),
``serve`` (uvicorn process start to the first /api/v1/health 200), ``routing`` (shortest-path
latency on the loaded network) and ``etl`` (wall time per ETL step, each in a fresh subprocess).

The ETL steps write to ``<scratch>/data/processed``; ``data/processed`` of the repo is only read
(its files are hashed before and after the run to show that). Results are written to
``data/processed/benchmarks/`` (gitignored). The two search variants are timed back to back for
each pair within every pass (callable weight first, then precomputed weight), so slow clock drift
hits both alike; the fixed order is a possible small bias, and the difference between them is a
single-run indication, not a precise comparison. Everything here is benchmark-only code: the
shortest path search, the precomputed-weight copy and the per-intersection lookup are NOT the
routing step.
"""

import argparse
import gc
import hashlib
import importlib.metadata
import importlib.util
import json
import os
import platform
import resource
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from datetime import UTC, datetime
from itertools import pairwise
from pathlib import Path
from typing import Any

import networkx as nx
import numpy as np

SCRIPT = Path(__file__).resolve()
BACKEND = SCRIPT.parents[1]
REPO = BACKEND.parent
PROCESSED = BACKEND / "data" / "processed"
MANIFEST = BACKEND / "data" / "raw" / "MANIFEST.json"
RESULTS_DIR = PROCESSED / "benchmarks"

SEED = 20261015
STRATA_KM = ((0.0, 1.0), (1.0, 3.0), (3.0, 6.0), (6.0, 10.0), (10.0, float("inf")))
PAIRS_PER_STRATUM = 200
TIMING_PASSES = 5
WARMUP_PAIRS = 50
ETL_REPS = {"profile": 3, "signals": 3, "graph": 3, "intersections": 3, "neighbours": 5}
LOAD_COLD_PROCESSES = 10
LOAD_WARM_CALLS = 10
SERVER_RUNS = 5
HEADLINE_STEPS = ("intersections", "neighbours")


# ----------------------------------------------------------------------------- helpers


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def read_text(path: str) -> str | None:
    try:
        return Path(path).read_text(encoding="utf-8").strip()
    except OSError:
        return None


def proc_status(field: str) -> int | None:
    """kB value of a /proc/self/status field (VmRSS, VmHWM)."""
    for line in (read_text("/proc/self/status") or "").splitlines():
        if line.startswith(field + ":"):
            return int(line.split()[1])
    return None


def machine_state() -> dict[str, Any]:
    """Governor, clock, load and the names (only) of the busiest processes."""
    clocks_khz = []
    for path in Path("/sys/devices/system/cpu").glob("cpu[0-9]*/cpufreq/scaling_cur_freq"):
        value = read_text(str(path))
        if value and value.isdigit():
            clocks_khz.append(int(value))
    ps = subprocess.run(
        ["ps", "-eo", "comm=", "--sort=-%cpu"], capture_output=True, text=True, check=False
    )
    return {
        "utc": now_iso(),
        "governor": read_text("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor"),
        "clock_mhz_mean": round(sum(clocks_khz) / len(clocks_khz) / 1000, 1)
        if clocks_khz
        else None,
        "clock_mhz_max_core": round(max(clocks_khz) / 1000, 1) if clocks_khz else None,
        "loadavg_1_5_15": [round(v, 2) for v in os.getloadavg()],
        "busiest_process_names": ps.stdout.split("\n")[:10],
    }


def environment() -> dict[str, Any]:
    cpuinfo = read_text("/proc/cpuinfo") or ""
    model = next(
        (ln.split(":", 1)[1].strip() for ln in cpuinfo.splitlines() if "model name" in ln), None
    )
    meminfo = read_text("/proc/meminfo") or ""
    mem_kb = next(
        (int(ln.split()[1]) for ln in meminfo.splitlines() if ln.startswith("MemTotal")), None
    )
    libraries = {}
    for name in ("networkx", "polars", "shapely", "numpy", "pydantic", "fastapi", "uvicorn"):
        try:
            libraries[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            libraries[name] = None
    commit = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=False,
    ).stdout.strip()
    dirty = bool(
        subprocess.run(
            ["git", "status", "--porcelain"], cwd=REPO, capture_output=True, text=True, check=False
        ).stdout.strip()
    )
    return {
        "cpu_model": model,
        "logical_cpus": os.cpu_count(),
        "ram_total_gib": round(mem_kb / 1024 / 1024, 1) if mem_kb else None,
        "os": f"{platform.system()} {platform.release()}",
        "python": platform.python_version(),
        "libraries": libraries,
        "git_commit": commit,
        "git_tree_has_uncommitted_changes": dirty,
    }


def stats_ms(values_s: Any, p99: bool = False) -> dict[str, float | int]:
    """min / median / p95 (/ p99) / max of timings given in seconds, reported in milliseconds."""
    a = np.asarray(values_s, dtype=float) * 1000.0
    out: dict[str, float | int] = {
        "n": int(a.size),
        "min_ms": float(a.min()),
        "median_ms": float(np.median(a)),
        "p95_ms": float(np.percentile(a, 95)),
        "max_ms": float(a.max()),
    }
    if p99:
        out["p99_ms"] = float(np.percentile(a, 99))
    return out


def spread(values: Any) -> dict[str, float | int]:
    a = np.asarray(values, dtype=float)
    return {
        "n": int(a.size),
        "min": float(a.min()),
        "p25": float(np.percentile(a, 25)),
        "median": float(np.median(a)),
        "p75": float(np.percentile(a, 75)),
        "max": float(a.max()),
    }


def hash_tree(root: Path, exclude: tuple[str, ...]) -> dict[str, str]:
    digests = {}
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        relative = path.relative_to(root)
        if relative.parts[0] in exclude:
            continue
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            while chunk := handle.read(1 << 20):
                digest.update(chunk)
        digests[str(relative)] = digest.hexdigest()
    return digests


def save(result: dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def timed_section(result: dict[str, Any], name: str, body: Callable[[], dict[str, Any]]) -> None:
    start = machine_state()
    section = body()
    section["machine_state_start"] = start
    section["machine_state_end"] = machine_state()
    result["sections"][name] = section


# ----------------------------------------------------------------------------- workers


def worker_etl(step: str, scratch: Path, out: Path) -> None:
    """Run ``main()`` of scripts/run_etl.py (the CLI code path) against the scratch directory."""
    spec = importlib.util.spec_from_file_location("run_etl", SCRIPT.parent / "run_etl.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    data = scratch / "data"
    module.DATA_DIR = data
    module.OVERRIDES_DIR = data / "overrides"
    module.REPORT_PATH = data / "processed" / "etl_report.json"
    sys.argv = ["run_etl.py", step]
    gc.collect()
    started = time.perf_counter()
    code = module.main()
    elapsed = time.perf_counter() - started
    out.write_text(
        json.dumps(
            {
                "step": step,
                "exit_code": code,
                "main_s": elapsed,
                "peak_rss_mib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
            }
        ),
        encoding="utf-8",
    )


def worker_load(calls: int, time_hashing: bool, out: Path) -> None:
    from greenwave.dataset import load_dataset
    from greenwave.etl.intersections_pipeline import T4_ARTIFACT_FILENAMES, artifact_hashes
    from greenwave.etl.neighbours_pipeline import NEIGHBOURS_FILENAME

    record: dict[str, Any] = {
        "rss_before_kib": proc_status("VmRSS"),
        "calls_s": [],
        "rss_after_kib": [],
    }
    dataset = None
    for _ in range(calls):
        dataset = None
        gc.collect()
        started = time.perf_counter()
        dataset = load_dataset(PROCESSED, MANIFEST)
        record["calls_s"].append(time.perf_counter() - started)
        record["rss_after_kib"].append(proc_status("VmRSS"))
    record["peak_rss_kib"] = proc_status("VmHWM")
    record["counts"] = dataset.counts.model_dump() if dataset else None
    if time_hashing:
        names = (*T4_ARTIFACT_FILENAMES, NEIGHBOURS_FILENAME)
        record["hashing_calls_s"] = []
        for _ in range(10):
            started = time.perf_counter()
            artifact_hashes(PROCESSED, names)
            record["hashing_calls_s"].append(time.perf_counter() - started)
    out.write_text(json.dumps(record), encoding="utf-8")


# ----------------------------------------------------------------------------- sections


def run_worker(args: list[str], log: Path) -> None:
    with log.open("w", encoding="utf-8") as handle:
        done = subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            cwd=BACKEND,
            stdout=handle,
            stderr=handle,
            check=False,
        )
    if done.returncode != 0:
        tail = "\n".join(log.read_text(encoding="utf-8").splitlines()[-15:])
        raise RuntimeError(f"worker {args} failed with {done.returncode}:\n{tail}")


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


def section_routing(quick: bool) -> dict[str, Any]:
    from greenwave.dataset import load_dataset

    per_stratum = 20 if quick else PAIRS_PER_STRATUM
    passes = 2 if quick else TIMING_PASSES
    dataset = load_dataset(PROCESSED, MANIFEST)
    graph = dataset.graph

    speeds = [d["speed_kmh"] for *_, d in graph.edges(data=True)]
    if min(speeds) <= 0:
        raise RuntimeError("an edge has speed_kmh <= 0")

    def travel_time(attrs: dict[str, Any]) -> float:
        return float(attrs["length_m"]) / (float(attrs["speed_kmh"]) / 3.6)

    def weight_callable(_u: str, _v: str, parallel: dict[Any, dict[str, Any]]) -> float:
        return min(travel_time(a) for a in parallel.values())

    started = time.perf_counter()
    largest = max(nx.strongly_connected_components(graph), key=len)
    scc_s = time.perf_counter() - started
    nodes = sorted(largest)
    xy = np.array([[graph.nodes[n]["x_m"], graph.nodes[n]["y_m"]] for n in nodes])

    rng = np.random.default_rng(SEED)
    draws = 2_000_000
    first, second = rng.integers(0, len(nodes), draws), rng.integers(0, len(nodes), draws)
    straight_m = np.hypot(*(xy[first] - xy[second]).T)
    pairs: list[tuple[int, int, int]] = []  # (stratum, source index, target index)
    quota_met = {}
    for index, (low, high) in enumerate(STRATA_KM):
        chosen = np.nonzero(
            (straight_m >= low * 1000) & (straight_m < high * 1000) & (first != second)
        )[0]
        chosen = chosen[:per_stratum]
        quota_met[f"{low:g}-{high:g} km"] = int(chosen.size)
        pairs += [(index, int(first[i]), int(second[i])) for i in chosen]
    warm_rng = np.random.default_rng(SEED + 1)
    warm_pairs = [
        (nodes[int(a)], nodes[int(b)])
        for a, b in zip(
            warm_rng.integers(0, len(nodes), WARMUP_PAIRS),
            warm_rng.integers(0, len(nodes), WARMUP_PAIRS),
            strict=True,
        )
    ]

    # Benchmark-only copy with the weight precomputed into an edge attribute.
    precomputed = graph.copy()
    for *_, attrs in precomputed.edges(keys=True, data=True):
        attrs["travel_time_s"] = travel_time(attrs)

    for source, target in warm_pairs:
        if source != target:
            nx.bidirectional_dijkstra(graph, source, target, weight=weight_callable)
            nx.bidirectional_dijkstra(precomputed, source, target, weight="travel_time_s")

    # Benchmark-only per-intersection lookup (not the routing step): edge -> INT, INT -> D_v.
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
    delay_of = dict(dataset.intersections.select("intersection_id", "delay_seconds").iter_rows())
    lookup_build_s = time.perf_counter() - started

    def per_int_lookup(path: list[str]) -> tuple[int, float]:
        seen = set()
        for u, v in pairwise(path):
            owner = edge_to_int.get(best_edge(graph, u, v, travel_time)["edge_id"])
            if owner is not None:
                seen.add(owner)
        return len(seen), sum(delay_of[i] for i in seen)

    count = len(pairs)
    latency_callable = np.empty((passes, count))
    latency_precomputed = np.empty((passes, count))
    latency_lookup = np.empty((passes, count))
    paths: list[list[str]] = [[] for _ in range(count)]
    cost_mismatch = 0
    for round_index in range(passes):
        gc.collect()
        for k, (_, a, b) in enumerate(pairs):
            source, target = nodes[a], nodes[b]
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
    lookups = [(0, 0.0)] * count
    for round_index in range(passes):
        gc.collect()
        for k in range(count):
            t0 = time.perf_counter()
            lookups[k] = per_int_lookup(paths[k])
            latency_lookup[round_index, k] = time.perf_counter() - t0

    # untimed descriptive values per pair
    per_pair = []
    for k, (stratum, a, b) in enumerate(pairs):
        edges = [best_edge(graph, u, v, travel_time) for u, v in pairwise(paths[k])]
        per_pair.append(
            {
                "stratum": stratum,
                "straight_line_m": float(np.hypot(*(xy[a] - xy[b]))),
                "route_m": float(sum(e["length_m"] for e in edges)),
                "route_edges": len(edges),
                "route_drive_time_s": float(sum(travel_time(e) for e in edges)),
                "unique_intersections": lookups[k][0],
                "delay_sum_s": lookups[k][1],
                "callable_ms": float(np.median(latency_callable[:, k]) * 1000),
                "precomputed_ms": float(np.median(latency_precomputed[:, k]) * 1000),
                "lookup_ms": float(np.median(latency_lookup[:, k]) * 1000),
            }
        )
    pair_median = {
        "callable": np.median(latency_callable, axis=0),
        "precomputed": np.median(latency_precomputed, axis=0),
        "lookup": np.median(latency_lookup, axis=0),
    }
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
        "pairs": count,
        "passes_per_pair": passes,
        "warmup_pairs": WARMUP_PAIRS,
        "per_pair_value": "median of the passes; statistics are over pairs",
        "percentile_method": "numpy linear interpolation",
        "pooled_all_pairs": {
            "latency_callable_weight": stats_ms(pair_median["callable"], p99=True),
            "latency_precomputed_weight": stats_ms(pair_median["precomputed"], p99=True),
            "per_int_lookup_sketch": stats_ms(pair_median["lookup"], p99=True),
            "max_single_timing_callable_ms": float(latency_callable.max() * 1000),
            "max_single_timing_precomputed_ms": float(latency_precomputed.max() * 1000),
        },
        "by_straight_line_stratum": strata,
        "cost_mismatches_callable_vs_precomputed": int(cost_mismatch),
        "edge_to_intersection_conflicts": conflicts,
        "lookup_tables_build_s": lookup_build_s,
        "per_pair": per_pair,
        "raw_timings_s": {
            "callable": latency_callable.tolist(),
            "precomputed": latency_precomputed.tolist(),
            "lookup": latency_lookup.tolist(),
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


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("--scratch", type=Path, help="scratch directory outside the repository")
    parser.add_argument("--quick", action="store_true", help="tiny run to test the script")
    parser.add_argument("--only", default="load,serve,routing,etl")
    parser.add_argument("--etl-steps", default=",".join(ETL_REPS))
    parser.add_argument("--worker", choices=["etl", "load"])
    parser.add_argument("--step")
    parser.add_argument("--calls", type=int, default=1)
    parser.add_argument("--time-hashing", action="store_true")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    if args.worker == "etl":
        worker_etl(args.step, args.scratch, args.out)
        return 0
    if args.worker == "load":
        worker_load(args.calls, args.time_hashing, args.out)
        return 0

    if args.scratch is None:
        parser.error("--scratch is required")
    scratch = args.scratch.resolve()
    if scratch == REPO or REPO in scratch.parents:
        parser.error("the scratch directory must be outside the repository")
    scratch.mkdir(parents=True, exist_ok=True)

    sections = args.only.split(",")
    started_utc = now_iso()
    hashes_before = hash_tree(PROCESSED, exclude=("benchmarks",))
    result: dict[str, Any] = {
        "schema": "greenwave-benchmark-1",
        "started_utc": started_utc,
        "quick": args.quick,
        "environment": environment(),
        "machine_state_run_start": machine_state(),
        "parameters": {
            "seed": SEED,
            "strata_km": [[lo, None if hi == float("inf") else hi] for lo, hi in STRATA_KM],
            "pairs_per_stratum": PAIRS_PER_STRATUM,
            "timing_passes": TIMING_PASSES,
            "warmup_pairs": WARMUP_PAIRS,
            "etl_repetitions": ETL_REPS,
            "load_cold_processes": LOAD_COLD_PROCESSES,
            "load_warm_calls": LOAD_WARM_CALLS,
            "server_runs": SERVER_RUNS,
            "quick_mode_shrinks_these": args.quick,
        },
        "limitations": LIMITATIONS,
        "sections": {},
    }
    target = (
        RESULTS_DIR
        / f"benchmark_{datetime.now(UTC):%Y%m%dT%H%M%SZ}{'_quick' if args.quick else ''}.json"
    )

    plan: list[tuple[str, Callable[[], dict[str, Any]]]] = [
        ("load", lambda: section_load(scratch, args.quick)),
        ("serve", lambda: section_serve(args.quick)),
        ("routing", lambda: section_routing(args.quick)),
        ("etl", lambda: section_etl(scratch, args.quick, args.etl_steps.split(","))),
    ]
    for name, body in plan:
        if name in sections:
            print(f"[{now_iso()}] section {name}", flush=True)
            timed_section(result, name, body)
            save(result, target)

    hashes_after = hash_tree(PROCESSED, exclude=("benchmarks",))
    changed = sorted(
        k
        for k in hashes_before.keys() | hashes_after.keys()
        if hashes_before.get(k) != hashes_after.get(k)
    )
    result["data_processed_unchanged"] = {
        "files_hashed": len(hashes_before),
        "excluded": ["benchmarks/"],
        "unchanged": not changed,
        "changed_files": changed,
        "digest_before": hashlib.sha256(
            json.dumps(hashes_before, sort_keys=True).encode()
        ).hexdigest(),
        "digest_after": hashlib.sha256(
            json.dumps(hashes_after, sort_keys=True).encode()
        ).hexdigest(),
    }
    result["machine_state_run_end"] = machine_state()
    result["finished_utc"] = now_iso()
    save(result, target)
    print(f"saved {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
