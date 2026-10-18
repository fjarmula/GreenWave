"""Summary statistics of timings and of descriptive values."""

from typing import Any

import numpy as np


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
