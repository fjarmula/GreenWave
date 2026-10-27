"""Step ``quality``: summarise the ETL diagnostics into ``data_quality.json`` for the dashboard.

Reads processed outputs of the graph, intersections and neighbours steps and the ``places``
report section (run it after ``neighbours`` and ``places``). The status labels only report; they
reuse the analysis ranges in ``etl.config`` and add no thresholds. Output is deterministic: same
inputs, same bytes.
"""

import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any, cast

import polars as pl
from pydantic import BaseModel

from greenwave.artifacts import (
    BUS_LANE_CROSSCHECK_FILENAME,
    INTERSECTIONS_FILENAME,
    QUALITY_FILENAME,
    REPORT_FILENAME,
    artifact_hashes,
)
from greenwave.etl.bus_lanes import (
    STATUS_OSM_HAS_BUS_LANE,
    STATUS_OSM_STREET_WITHOUT_BUS_LANE,
    STATUS_STREET_NOT_FOUND,
    STATUS_UNPARSED,
)
from greenwave.etl.config import ROUTE_DETOUR_RATIO_RANGE, STREET_LENGTH_RATIO_RANGE
from greenwave.etl.graph_pipeline import ROUTES_FILENAME, STREET_TABLE_FILENAME
from greenwave.etl.intersections_pipeline import NEAR_MISSES_FILENAME
from greenwave.etl.manifest import MANIFEST_FILENAME, Manifest, load_manifest
from greenwave.etl.prepare import TERTIARY_PLUS_FILENAME
from greenwave.schemas.dataset_quality import (
    DatasetQualityResponse,
    QualityCheck,
    QualitySource,
    QualityStatus,
)

MAX_SAMPLES = 5
AKTUALNOSC_PATH = Path("krakow") / "__Aktualnosc__.txt"
_MSIP_TIMESTAMP = re.compile(r"(\d{4}-\d{2}-\d{2})_(\d{2}:\d{2}:\d{2})")
_BUS_LANE_STATUSES = (
    STATUS_OSM_HAS_BUS_LANE,
    STATUS_OSM_STREET_WITHOUT_BUS_LANE,
    STATUS_STREET_NOT_FOUND,
    STATUS_UNPARSED,
)

# The processed files this step reads (etl_report.json aside: its sections are written by the
# same steps as these files). Their hashes are recorded as ``consumed_sha256``.
QUALITY_INPUT_FILENAMES = (
    NEAR_MISSES_FILENAME,
    TERTIARY_PLUS_FILENAME,
    STREET_TABLE_FILENAME,
    ROUTES_FILENAME,
    INTERSECTIONS_FILENAME,
    BUS_LANE_CROSSCHECK_FILENAME,
)


class QualityInputError(RuntimeError):
    """An input of the quality step is missing; the message names the step that writes it."""


class QualitySection(BaseModel):
    """Report section ``quality``: integrity records against mixed runs (not security)."""

    manifest_sha256: str
    consumed_sha256: dict[str, str]
    artifact_sha256: dict[str, str]


def _round(value: float) -> float:
    return round(float(value), 3)


def _read_csv(path: Path) -> pl.DataFrame:
    if path.stat().st_size == 0:
        return pl.DataFrame()
    return pl.read_csv(path, infer_schema_length=None)


def _column(frame: pl.DataFrame, name: str) -> list[Any]:
    return frame[name].to_list() if name in frame.columns else [None] * frame.height


def _named(value: object) -> str:
    return str(value) if value else "unnamed"


def _near_miss_sample(row: dict[str, Any]) -> str:
    sample = (
        f"{_named(row.get('street'))} ({row.get('highway')}) / "
        f"{_named(row.get('other_street'))} ({row.get('other_highway')}): "
        f"{float(row['distance_m']):.1f} m gap"
    )
    return f"{sample}, {row['weld_status']}" if row.get("weld_status") else sample


def _near_misses(processed_dir: Path) -> QualityCheck:
    after = _read_csv(processed_dir / NEAR_MISSES_FILENAME)
    tertiary = _read_csv(processed_dir / TERTIARY_PLUS_FILENAME)
    # The tertiary-plus file lists cases found before welding, each with its weld outcome.
    welded = sum(str(status).startswith("welded") for status in _column(tertiary, "weld_status"))
    shown = tertiary if tertiary.height else after
    if shown.height:
        shown = shown.sort("distance_m", maintain_order=True)
    return QualityCheck(
        id="near_misses",
        title="Near misses",
        status=QualityStatus.WARN if tertiary.height else QualityStatus.INFO,
        headline=(
            f"{after.height} near misses (road ends close to a road they do not join) remain "
            f"after welding. Before welding, {tertiary.height} involved tertiary-or-higher "
            f"roads; {welded} of them were welded."
        ),
        metrics={
            "near_misses_after_welding": after.height,
            "tertiary_plus_cases": tertiary.height,
            "tertiary_plus_welded": welded,
        },
        samples=[_near_miss_sample(row) for row in shown.head(MAX_SAMPLES).iter_rows(named=True)],
    )


def _street_lengths(processed_dir: Path) -> QualityCheck:
    low, high = STREET_LENGTH_RATIO_RANGE
    table = _read_csv(processed_dir / STREET_TABLE_FILENAME)
    rows = list(table.iter_rows(named=True))
    matched = [r for r in rows if r["graph_km"] is not None and r["ulice_km"] is not None]
    within = [r for r in matched if r["ratio"] is not None and low <= r["ratio"] <= high]
    outside = sorted(
        (r for r in matched if r not in within and r["ratio"]),
        key=lambda r: (-abs(math.log(r["ratio"])), str(r["normalised_name"])),
    )
    # Whole percent, so the metric and the headline show the same number.
    share = round(len(within) / len(matched), 2) if matched else 0.0
    return QualityCheck(
        id="street_lengths",
        title="Street lengths vs city register",
        status=QualityStatus.INFO,
        headline=(
            f"{share:.0%} of {len(matched)} streets matched by name between OSM and the city "
            f"street register (Ulice) have an OSM length within {low}-{high} times the "
            "register length."
        ),
        metrics={
            "streets_compared": len(matched),
            "share_within_range": share,
            "ulice_only_streets": sum(r["graph_km"] is None for r in rows),
            "graph_only_streets": sum(r["ulice_km"] is None for r in rows),
        },
        samples=[
            f"{r['graph_name'] or r['ulice_name']}: OSM {r['graph_km']:.2f} km, "
            f"Ulice {r['ulice_km']:.2f} km (ratio {r['ratio']:.2f})"
            for r in outside[:MAX_SAMPLES]
        ],
    )


def _route_sanity(processed_dir: Path) -> QualityCheck:
    low, high = ROUTE_DETOUR_RATIO_RANGE
    document = json.loads((processed_dir / ROUTES_FILENAME).read_text(encoding="utf-8"))
    routes = [
        f["properties"] for f in document["features"] if f["properties"].get("kind") == "route"
    ]

    def within(route: dict[str, Any]) -> bool:
        ratio = route.get("detour_ratio")
        return bool(route.get("route_found")) and ratio is not None and low <= ratio <= high

    def sample(route: dict[str, Any]) -> str:
        ratio = route.get("detour_ratio")
        found = route.get("route_found") and ratio is not None
        outcome = f"detour ratio {ratio:.2f}" if found else "no route found"
        return f"{route.get('from')} → {route.get('to')}: {outcome}"

    inside = sum(within(r) for r in routes)
    ratios = [r["detour_ratio"] for r in routes if r.get("detour_ratio") is not None]
    metrics: dict[str, float] = {"routes_checked": len(routes), "routes_within_range": inside}
    if ratios:
        metrics["max_detour_ratio"] = _round(max(ratios))
    ordered = sorted(routes, key=within)  # stable: routes outside the range first
    return QualityCheck(
        id="route_sanity",
        title="Route sanity",
        status=QualityStatus.PASS if inside == len(routes) else QualityStatus.WARN,
        headline=(
            f"{inside} of {len(routes)} shortest routes between named places have a detour "
            f"ratio (route length / straight line) within {low}-{high}."
        ),
        metrics=metrics,
        samples=[sample(r) for r in ordered[:MAX_SAMPLES]],
    )


def _signal_snapping(report: dict[str, Any]) -> QualityCheck:
    snapping = report["intersections"]["snapping"]
    unsnapped = cast("list[dict[str, Any]]", snapping["unsnapped"])
    tolerance = snapping.get("tolerance_m")
    metrics: dict[str, float] = {
        "attached_signals": snapping["attached_signals"],
        "unsnapped_signals": len(unsnapped),
    }
    if tolerance is not None:
        metrics["snap_tolerance_m"] = tolerance
    within = f" within {tolerance:g} m" if tolerance is not None else ""
    return QualityCheck(
        id="signal_snapping",
        title="Signal snapping",
        status=QualityStatus.INFO,
        headline=(
            f"{snapping['attached_signals']} OSM signals attached to the road graph; "
            f"{len(unsnapped)} had no road{within}."
        ),
        metrics=metrics,
        samples=[
            f"{u.get('signal')} ({u.get('type')}): nearest road "
            f"{_named(u.get('nearest_street'))} at {float(u.get('nearest_edge_m') or 0):.0f} m"
            for u in sorted(unsnapped, key=lambda u: str(u.get("signal")))[:MAX_SAMPLES]
        ],
    )


def _signals_needing_review(processed_dir: Path) -> QualityCheck:
    frame = pl.read_parquet(
        processed_dir / INTERSECTIONS_FILENAME, columns=["intersection_id", "name", "needs_review"]
    )
    flagged = frame.filter(pl.col("needs_review")).sort("intersection_id")
    return QualityCheck(
        id="signals_needing_review",
        title="Signals needing review",
        status=QualityStatus.WARN if flagged.height else QualityStatus.INFO,
        headline=(
            f"{flagged.height} of {frame.height} intersections have a signal whose OSM tags "
            "were flagged for manual review."
        ),
        metrics={"intersections": frame.height, "needing_review": flagged.height},
        samples=[
            f"{row['intersection_id']} {row['name']}" if row["name"] else row["intersection_id"]
            for row in flagged.head(MAX_SAMPLES).iter_rows(named=True)
        ],
    )


def _bus_lane_crosscheck(processed_dir: Path) -> QualityCheck:
    table = _read_csv(processed_dir / BUS_LANE_CROSSCHECK_FILENAME)
    statuses = _column(table, "status")
    counts = {status: statuses.count(status) for status in _BUS_LANE_STATUSES}
    rows = list(table.iter_rows(named=True)) if table.height else []
    mismatches = sorted(
        (r for r in rows if r["status"] != STATUS_OSM_HAS_BUS_LANE),
        key=lambda r: int(r["objectid"]),
    )
    return QualityCheck(
        id="bus_lane_crosscheck",
        title="Bus-lane cross-check",
        status=QualityStatus.INFO,
        headline=(
            f"{counts[STATUS_OSM_HAS_BUS_LANE]} of {table.height} sections of the city bus-lane "
            "register have an OSM bus lane on the same street."
        ),
        metrics=counts,  # the register total is in the headline (the panel shows four metrics)
        samples=[
            f"{r['street']} ({r['from']} - {r['to']}): {str(r['status']).replace('_', ' ')}"
            if r["street"]
            else f"section {r['objectid']}: {str(r['status']).replace('_', ' ')}"
            for r in mismatches[:MAX_SAMPLES]
        ],
    )


def _road_attributes(report: dict[str, Any]) -> QualityCheck:
    road = report["road_attributes"]
    bus_km = float(road["km_by_bus_lane"].get("true", 0.0))
    tram_km = float(road["tram"]["km_marked"])
    calming = int(road["calming"]["points_on_edges"])
    return QualityCheck(
        id="road_attributes",
        title="Road attributes",
        status=QualityStatus.INFO,
        headline=(
            f"{bus_km:.1f} km with a bus lane and {tram_km:.1f} km along tram track "
            f"(directed edges); {calming} traffic-calming points on the network."
        ),
        metrics={
            "bus_lane_km": _round(bus_km),
            "tram_track_km": _round(tram_km),
            "calming_points_on_network": calming,
            "total_directed_km": _round(road["total_directed_km"]),
        },
        samples=[],
    )


def _percent(part: int, whole: int) -> float:
    return 100.0 * part / whole if whole else 0.0


def _address_reconciliation(report: dict[str, Any]) -> QualityCheck:
    r = report["places"]["addresses"]["reconciliation"]
    total = int(r["municipal_total"])
    clean_m, max_m = float(r["thresholds_m"]["clean"]), float(r["thresholds_m"]["max"])
    return QualityCheck(
        id="address_reconciliation",
        title="Municipal addresses (EMUiA)",
        status=QualityStatus.INFO,
        headline=(
            f"{total:,} EMUiA addresses: "
            f"{_percent(r['matched_clean'], total):.1f}% match OSM within {clean_m:.0f} m, "
            f"{_percent(r['matched_disagreement'], total):.1f}% differ by "
            f"{clean_m:.0f}\u2013{max_m:.0f} m, "
            f"{_percent(r['municipal_only_gap_closed'], total):.1f}% fill gaps OSM lacks. "
            f"{int(r['osm_only_fallback']):,} OSM-only addresses kept as fallback."
        ),
        metrics={
            name: int(r[name])
            for name in (
                "matched_clean",
                "matched_disagreement",
                "municipal_only_gap_closed",
                "osm_only_fallback",
            )
        },
        samples=list(r["examples"]["matched_disagreement"])[:MAX_SAMPLES],
    )


def _address_gap_examples(report: dict[str, Any]) -> QualityCheck:
    r = report["places"]["addresses"]["reconciliation"]
    examples = r["examples"]
    return QualityCheck(
        id="address_gap_examples",
        title="Addresses only in EMUiA",
        status=QualityStatus.INFO,
        headline=(
            f"{int(r['municipal_only_gap_closed']):,} addresses exist only in EMUiA. "
            f"{int(r['matched_name_variant']):,} street-name variants were matched to OSM and "
            "not counted as gaps."
        ),
        metrics={
            "matched_name_variant": int(r["matched_name_variant"]),
            "same_key_beyond_limit": int(r["same_key_beyond_limit"]),
        },
        # Gaps first, then clean matches, so every example class reaches the panel.
        samples=[*examples["municipal_only_gap_closed"][:3], *examples["matched_clean"][:2]],
    )


def msip_export_timestamp(raw_dir: Path) -> str | None:
    """``Data wygenerowania plików: 2026-10-13_00:47:34`` -> ``2026-10-13 00:47:34``."""
    path = raw_dir / AKTUALNOSC_PATH
    if not path.is_file():
        return None
    match = _MSIP_TIMESTAMP.search(path.read_text(encoding="utf-8-sig"))
    return f"{match.group(1)} {match.group(2)}" if match else None


def build_quality(processed_dir: Path, raw_dir: Path, manifest: Manifest) -> DatasetQualityResponse:
    report = json.loads((processed_dir / REPORT_FILENAME).read_text(encoding="utf-8"))
    return DatasetQualityResponse(
        schema_version="1.0",
        is_simulated=True,
        manifest_sha256=hashlib.sha256((raw_dir / MANIFEST_FILENAME).read_bytes()).hexdigest(),
        msip_export_timestamp=msip_export_timestamp(raw_dir),
        checks=[
            _near_misses(processed_dir),
            _street_lengths(processed_dir),
            _route_sanity(processed_dir),
            _signal_snapping(report),
            _signals_needing_review(processed_dir),
            _bus_lane_crosscheck(processed_dir),
            _road_attributes(report),
            _address_reconciliation(report),
            _address_gap_examples(report),
        ],
        sources=[
            QualitySource(
                path=entry.path,
                source=entry.source,
                licence=entry.licence or "",
                attribution=entry.attribution or "",
                retrieved_on=entry.retrieved_on,
            )
            for entry in manifest.entries
        ],
    )


def write_quality(summary: DatasetQualityResponse, processed_dir: Path) -> str:
    """Write ``data_quality.json`` (UTF-8, sorted keys) and return its sha256."""
    text = json.dumps(summary.model_dump(mode="json"), ensure_ascii=False, sort_keys=True, indent=2)
    path = processed_dir / QUALITY_FILENAME
    path.write_text(text + "\n", encoding="utf-8")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_quality(raw_dir: Path, processed_dir: Path) -> QualitySection:
    missing = [
        name
        for name in (*QUALITY_INPUT_FILENAMES, REPORT_FILENAME)
        if not (processed_dir / name).is_file()
    ]
    if missing:
        raise QualityInputError(
            f"{', '.join(missing)} missing in {processed_dir}; run the graph, intersections and "
            "neighbours steps before `quality`"
        )
    report = json.loads((processed_dir / REPORT_FILENAME).read_text(encoding="utf-8"))
    if "places" not in report:
        raise QualityInputError(
            f"{REPORT_FILENAME} has no places section; run the places step before `quality`"
        )
    consumed = artifact_hashes(processed_dir, QUALITY_INPUT_FILENAMES)  # hashed before reading
    summary = build_quality(processed_dir, raw_dir, load_manifest(raw_dir / MANIFEST_FILENAME))
    return QualitySection(
        manifest_sha256=summary.manifest_sha256,
        consumed_sha256=consumed,
        artifact_sha256={QUALITY_FILENAME: write_quality(summary, processed_dir)},
    )
