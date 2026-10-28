"""Paths and parameters shared by the benchmark sections, workers and ``benchmark.py``."""

from pathlib import Path

# Workers re-run the benchmark script itself by path (``--worker``).
SCRIPT = Path(__file__).resolve().parents[1] / "benchmark.py"
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
ETL_REPS = {
    "profile": 3,
    "signals": 3,
    "graph": 3,
    "intersections": 3,
    "neighbours": 5,
    "places": 3,
    "quality": 3,
}
LOAD_COLD_PROCESSES = 10
LOAD_WARM_CALLS = 10
SERVER_RUNS = 5
HEADLINE_STEPS = ("intersections", "neighbours")
