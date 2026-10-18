"""Machine and environment description recorded with every benchmark run."""

import hashlib
import importlib.metadata
import os
import platform
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from bench.constants import REPO


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
