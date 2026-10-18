"""Subprocess workers: one ETL step or ``load_dataset`` calls in a fresh interpreter."""

import gc
import importlib.util
import json
import resource
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from bench.constants import BACKEND, MANIFEST, PROCESSED, SCRIPT
from bench.machine import proc_status


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
