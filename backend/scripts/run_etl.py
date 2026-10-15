"""ETL command line: raw data -> ``backend/data/processed/``. Run from ``backend/``.

    uv run python scripts/run_etl.py <step>

Steps, in dependency order (each step re-reads the raw data, except ``neighbours``):
    profile          T1: profile the raw data -> etl_report.json (section ``profile``)
    signals          T2: signals.parquet + section ``signals``
    graph            T3: road_nodes/road_edges.parquet, street and route checks, section ``graph``
    draft-overrides  draft the roundabout override file (never overwrites an existing one)
    override-map     check page for data/overrides/roundabouts.json
    intersections    T4: network_*.parquet, intersections.parquet, signal_approaches.parquet, ids
    neighbours       T5: approach_neighbours.parquet (reads the processed T4 artifacts)
    roundabouts      roundabout inventory report (analysis only)
    cluster-map      signal-radius decision aid: signal_cluster_map.html
"""

import argparse
import json
import logging
from pathlib import Path

import polars as pl

from greenwave.etl.cluster_map import render_cluster_map
from greenwave.etl.graph import build_graph
from greenwave.etl.graph_pipeline import run_graph
from greenwave.etl.intersections_pipeline import run_intersections
from greenwave.etl.io import update_report_section
from greenwave.etl.neighbours_pipeline import run_neighbours
from greenwave.etl.override_map import render_override_map
from greenwave.etl.overrides import (
    OVERRIDE_FILENAME,
    draft_override_entries,
    load_overrides,
    write_overrides,
)
from greenwave.etl.prepare import prepare_scan
from greenwave.etl.profile import run_profile
from greenwave.etl.roundabouts import analyse_roundabouts
from greenwave.etl.signals import build_signals

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
OVERRIDES_DIR = DATA_DIR / "overrides"
REPORT_PATH = DATA_DIR / "processed" / "etl_report.json"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "step",
        choices=[
            "profile",
            "signals",
            "graph",
            "draft-overrides",
            "override-map",
            "intersections",
            "neighbours",
            "roundabouts",
            "cluster-map",
        ],
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if args.step == "profile":
        update_report_section(REPORT_PATH, "profile", run_profile(DATA_DIR / "raw"))
        print(f"wrote profile section to {REPORT_PATH}")
    elif args.step == "signals":
        prepared = prepare_scan(DATA_DIR / "raw")
        result = build_signals(prepared.scan, prepared.inputs_sha256)
        signals_path = DATA_DIR / "processed" / "signals.parquet"
        result.frame.write_parquet(signals_path)
        update_report_section(REPORT_PATH, "signals", result.report)
        print(f"wrote {signals_path} ({result.frame.height} rows) and the signals report section")
    elif args.step == "graph":
        section = run_graph(DATA_DIR / "raw", DATA_DIR / "processed")
        update_report_section(REPORT_PATH, "graph", section)
        print("wrote road_nodes/road_edges parquet, street and route checks, and the graph section")
    elif args.step == "draft-overrides":
        scan = prepare_scan(DATA_DIR / "raw").scan
        drafts, geojson = draft_override_entries(build_graph(scan.drivable_ways).graph)
        target = OVERRIDES_DIR / OVERRIDE_FILENAME
        if target.exists():  # never overwrite hand edits
            target = DATA_DIR / "processed" / "roundabouts.draft.json"
        write_overrides(drafts, target)
        candidates = DATA_DIR / "processed" / "roundabout_override_candidates.geojson"
        candidates.write_text(json.dumps(geojson, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"wrote {target} and {candidates}")
        for entry in drafts.entries:
            rings, arms = len(entry.ring_edge_ids), len(entry.entry_arm_edge_ids)
            print(f"  {entry.name}: {rings} ring / {arms} arm edges")
    elif args.step == "override-map":
        prepared = prepare_scan(DATA_DIR / "raw")
        scan = prepared.scan
        signals = build_signals(scan, prepared.inputs_sha256).frame
        counted = signals.filter(pl.col("counts_in_delay"))
        target = DATA_DIR / "processed" / "roundabout_override_check.html"
        render_override_map(
            build_graph(scan.drivable_ways).graph,
            load_overrides(OVERRIDES_DIR / OVERRIDE_FILENAME),
            counted.select("x_m", "y_m").to_numpy(),
            target,
        )
        print(f"wrote {target}")
    elif args.step == "intersections":
        section = run_intersections(DATA_DIR / "raw", DATA_DIR / "processed", OVERRIDES_DIR)
        update_report_section(REPORT_PATH, "intersections", section)
        print(
            "wrote network, intersections, approaches, ids, welds, near-misses and the report "
            f"section ({section.grouping.intersections_total} intersections)"
        )
    elif args.step == "neighbours":
        section = run_neighbours(DATA_DIR / "raw", DATA_DIR / "processed")
        update_report_section(REPORT_PATH, "neighbours", section)
        print(f"wrote approach_neighbours.parquet ({section.report.pairs} pairs)")
    elif args.step == "roundabouts":
        prepared = prepare_scan(DATA_DIR / "raw")
        scan = prepared.scan
        signals = build_signals(scan, prepared.inputs_sha256)
        section = analyse_roundabouts(scan.drivable_ways, signals.frame)
        update_report_section(REPORT_PATH, "roundabouts", section)
        print(f"wrote roundabouts section ({section.rings_total} rings)")
    else:
        map_path = DATA_DIR / "processed" / "signal_cluster_map.html"
        missing = render_cluster_map(prepare_scan(DATA_DIR / "raw").scan, map_path)
        print(f"wrote {map_path}" + (f" (not located: {', '.join(missing)})" if missing else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
