"""Refactor guard: prove a change leaves every ETL output byte-identical. Run from ``backend/``.

    uv run python scripts/etl_equivalence.py run SCRATCH_DIR OUT.json
    uv run python scripts/etl_equivalence.py compare BASE.json NEW.json [--allow NAME ...]

``run`` calls ``main()`` of scripts/run_etl.py for every step (the CLI code path) with DATA_DIR
pointed at ``SCRATCH_DIR/data``; ``raw/`` and ``overrides/`` are symlinks to the repo and are only
read, so nothing inside the repository is written. It records the sha256 of every output file, a
hash of ``etl_report.json`` without its volatile fields, and the wall time of each step.

``compare`` exits 1 when any entry differs, except the names given with ``--allow``. Make the
baseline with two ``run``s on the unchanged code: entries that differ between those two are the
only ones a refactor may be allowed to change (in practice ``etl_report.json``, whose raw bytes
carry timestamps).
"""

import argparse
import hashlib
import importlib.util
import json
import sys
import time
from pathlib import Path

from greenwave.etl.overrides import OVERRIDE_FILENAME

BACKEND = Path(__file__).resolve().parents[1]
STEPS = (
    "profile",
    "signals",
    "graph",
    "draft-overrides",
    "override-map",
    "intersections",
    "neighbours",
    "roundabouts",
    "cluster-map",
)
# generated_at_utc is a timestamp; override_file is the scratch run's own path.
VOLATILE_REPORT_KEYS = frozenset({"generated_at_utc", "override_file"})
TIMING_KEY = "_timing"
STRIPPED_REPORT_KEY = "etl_report.json#stripped"


def _strip(value: object) -> object:
    if isinstance(value, dict):
        return {k: _strip(v) for k, v in value.items() if k not in VOLATILE_REPORT_KEYS}
    if isinstance(value, list):
        return [_strip(v) for v in value]
    return value


def require_committed_override() -> Path:
    """The hand-verified override is an input; never let ``draft-overrides`` stand in for it."""
    path = BACKEND / "data" / "overrides" / OVERRIDE_FILENAME
    if not path.is_file():
        raise SystemExit(f"committed override file is missing: {path}")
    return path


def run(scratch: Path, out: Path) -> int:
    require_committed_override()
    data = scratch.resolve() / "data"
    if BACKEND.parent in data.parents:
        raise SystemExit("the scratch directory must be outside the repository")
    (data / "processed").mkdir(parents=True, exist_ok=False)
    for name in ("raw", "overrides"):
        (data / name).symlink_to(BACKEND / "data" / name, target_is_directory=True)
    spec = importlib.util.spec_from_file_location("run_etl", BACKEND / "scripts" / "run_etl.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.DATA_DIR = data
    module.OVERRIDES_DIR = data / "overrides"
    module.REPORT_PATH = data / "processed" / "etl_report.json"

    timing: dict[str, float] = {}
    for step in STEPS:
        sys.argv = ["run_etl.py", step]
        started = time.perf_counter()
        if module.main() != 0:
            raise SystemExit(f"step {step} failed")
        timing[step] = round(time.perf_counter() - started, 2)

    processed = data / "processed"
    result: dict[str, object] = {TIMING_KEY: timing}
    for path in sorted(processed.rglob("*")):
        if path.is_file():
            result[str(path.relative_to(processed))] = hashlib.sha256(path.read_bytes()).hexdigest()
    report = json.loads((processed / "etl_report.json").read_text(encoding="utf-8"))
    result[STRIPPED_REPORT_KEY] = hashlib.sha256(
        json.dumps(_strip(report), sort_keys=True).encode()
    ).hexdigest()
    out.write_text(json.dumps(result, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {out} ({len(result) - 1} entries), step seconds: {timing}")
    return 0


def compare(base_path: Path, new_path: Path, allow: set[str]) -> int:
    base, new = (json.loads(p.read_text(encoding="utf-8")) for p in (base_path, new_path))
    keys = sorted((set(base) | set(new)) - {TIMING_KEY})
    differ = [k for k in keys if base.get(k) != new.get(k)]
    for key in differ:
        print(("allowed " if key in allow else "DIFF    ") + key)
    print(f"{len(keys)} entries, {len(differ)} differ")
    print(f"step seconds base={base.get(TIMING_KEY)} new={new.get(TIMING_KEY)}")
    return 1 if set(differ) - allow else 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    commands = parser.add_subparsers(dest="command", required=True)
    run_parser = commands.add_parser("run")
    run_parser.add_argument("scratch", type=Path)
    run_parser.add_argument("out", type=Path)
    compare_parser = commands.add_parser("compare")
    compare_parser.add_argument("base", type=Path)
    compare_parser.add_argument("new", type=Path)
    compare_parser.add_argument("--allow", nargs="*", default=[])
    args = parser.parse_args()
    if args.command == "run":
        return run(args.scratch, args.out)
    return compare(args.base, args.new, set(args.allow))


if __name__ == "__main__":
    raise SystemExit(main())
