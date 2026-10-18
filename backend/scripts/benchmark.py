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
import hashlib
import json
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from bench.constants import (
    ETL_REPS,
    LOAD_COLD_PROCESSES,
    LOAD_WARM_CALLS,
    PAIRS_PER_STRATUM,
    PROCESSED,
    REPO,
    RESULTS_DIR,
    SEED,
    SERVER_RUNS,
    STRATA_KM,
    TIMING_PASSES,
    WARMUP_PAIRS,
)
from bench.machine import environment, hash_tree, machine_state, now_iso
from bench.results import LIMITATIONS, save, timed_section
from bench.sections import section_etl, section_load, section_routing, section_serve
from bench.workers import worker_etl, worker_load


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
