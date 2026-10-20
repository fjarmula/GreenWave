import json
from pathlib import Path

import polars as pl
import pytest

from greenwave.artifacts import BUS_LANE_CROSSCHECK_FILENAME, INTERSECTIONS_FILENAME
from greenwave.etl.config import ROUTE_DETOUR_RATIO_RANGE, STREET_LENGTH_RATIO_RANGE
from greenwave.etl.intersections_pipeline import NEAR_MISSES_FILENAME
from greenwave.etl.manifest import load_manifest
from greenwave.etl.prepare import TERTIARY_PLUS_FILENAME
from greenwave.etl.quality import QUALITY_INPUT_FILENAMES, build_quality, run_quality, write_quality
from greenwave.schemas import DatasetQualityResponse, QualityCheck, QualityStatus
from tests.support.processed import Layout, write_route_checks, write_street_table

CHECK_IDS = [
    "near_misses",
    "street_lengths",
    "route_sanity",
    "signal_snapping",
    "signals_needing_review",
    "bus_lane_crosscheck",
    "road_attributes",
]
NEAR_MISS_SCHEMA = {
    "kind": pl.String,
    "distance_m": pl.Float64,
    "street": pl.String,
    "other_street": pl.String,
    "highway": pl.String,
    "other_highway": pl.String,
}
BUS_LANE_SCHEMA = {
    "objectid": pl.Int64,
    "kategoria": pl.String,
    "organizacja": pl.String,
    "street": pl.String,
    "from": pl.String,
    "to": pl.String,
    "csv_length_m": pl.Float64,
    "street_in_ulice": pl.Boolean,
    "osm_edges_on_street": pl.Int64,
    "osm_bus_lane_km_on_street": pl.Float64,
    "status": pl.String,
}


def raw_dir(layout: Layout) -> Path:
    return layout.manifest.parent


def summary(layout: Layout) -> DatasetQualityResponse:
    return build_quality(layout.processed, raw_dir(layout), load_manifest(layout.manifest))


def check(layout: Layout, check_id: str) -> QualityCheck:
    return next(c for c in summary(layout).checks if c.id == check_id)


def near_miss_rows(count: int, street: str = "Testowa") -> list[dict[str, object]]:
    return [
        {
            "kind": "end_to_segment",
            "distance_m": 0.5 + i,
            "street": f"{street} {i}",
            "other_street": "Inna",
            "highway": "tertiary",
            "other_highway": "service",
        }
        for i in range(count)
    ]


def write_near_misses(
    layout: Layout, after_welding: int, tertiary_plus: int, welded: int = 0
) -> None:
    pl.DataFrame(near_miss_rows(after_welding), schema=NEAR_MISS_SCHEMA).write_csv(
        layout.processed / NEAR_MISSES_FILENAME
    )
    pl.DataFrame(
        [
            row | {"weld_status": "welded (inserted_vertex)" if i < welded else "not welded: far"}
            for i, row in enumerate(near_miss_rows(tertiary_plus))
        ],
        schema=NEAR_MISS_SCHEMA | {"weld_status": pl.String},
    ).write_csv(layout.processed / TERTIARY_PLUS_FILENAME)


def set_needs_review(layout: Layout, flagged: int) -> None:
    path = layout.processed / INTERSECTIONS_FILENAME
    frame = pl.read_parquet(path)
    flags = [i < flagged for i in range(frame.height)]
    frame.with_columns(pl.Series("needs_review", flags)).write_parquet(path)


def bus_lane_row(objectid: int, status: str, street: str = "ul. Testowa") -> dict[str, object]:
    return {
        "objectid": objectid,
        "kategoria": "pas autobusowy",
        "organizacja": "stała",
        "street": street,
        "from": "A",
        "to": "B",
        "csv_length_m": 100.0,
        "street_in_ulice": True,
        "osm_edges_on_street": 1,
        "osm_bus_lane_km_on_street": 0.0,
        "status": status,
    }


def write_bus_lanes(layout: Layout, rows: list[dict[str, object]]) -> None:
    pl.DataFrame(rows, schema=BUS_LANE_SCHEMA).write_csv(
        layout.processed / BUS_LANE_CROSSCHECK_FILENAME
    )


def test_checks_come_in_spec_order_with_schema_markers(layout: Layout) -> None:
    result = summary(layout)

    assert [c.id for c in result.checks] == CHECK_IDS
    assert result.schema_version == "1.0"
    assert result.is_simulated is True
    assert len(result.manifest_sha256) == 64


@pytest.mark.parametrize(("tertiary_plus", "status"), [(0, "info"), (1, "warn")])
def test_near_misses_warn_only_with_tertiary_plus_rows(
    layout: Layout, tertiary_plus: int, status: str
) -> None:
    write_near_misses(layout, after_welding=3, tertiary_plus=tertiary_plus)

    result = check(layout, "near_misses")

    assert result.status == QualityStatus(status)
    assert result.metrics["near_misses_after_welding"] == 3
    assert result.metrics["tertiary_plus_cases"] == tertiary_plus


def test_near_misses_say_tertiary_plus_cases_were_found_before_welding(layout: Layout) -> None:
    write_near_misses(layout, after_welding=3, tertiary_plus=4, welded=1)

    result = check(layout, "near_misses")

    assert result.metrics["tertiary_plus_cases"] == 4
    assert result.metrics["tertiary_plus_welded"] == 1
    assert "Before welding, 4 involved tertiary-or-higher roads" in result.headline
    assert "1 of them were welded" in result.headline
    assert any(sample.endswith("welded (inserted_vertex)") for sample in result.samples)


def test_street_lengths_share_uses_the_configured_ratio_range(layout: Layout) -> None:
    low, high = STREET_LENGTH_RATIO_RANGE
    rows = [
        {"normalised_name": "a", "graph_name": "A", "ulice_name": "A", "ratio": low},
        {"normalised_name": "b", "graph_name": "B", "ulice_name": "B", "ratio": high},
        {"normalised_name": "c", "graph_name": "C", "ulice_name": "C", "ratio": high + 0.01},
        {"normalised_name": "d", "graph_name": "D", "ulice_name": "D", "ratio": low - 0.01},
        {"normalised_name": "e", "graph_name": None, "ulice_name": "E", "ratio": None},
        {"normalised_name": "f", "graph_name": "F", "ulice_name": None, "ratio": None},
    ]
    for row in rows:
        row["graph_km"] = 1.0 if row["graph_name"] else None
        row["ulice_km"] = 1.0 if row["ulice_name"] else None
        row["status"] = "x"
    write_street_table(layout.processed, rows)

    result = check(layout, "street_lengths")

    assert result.status == QualityStatus.INFO
    assert result.metrics["streets_compared"] == 4
    assert result.metrics["share_within_range"] == 0.5
    assert result.metrics["ulice_only_streets"] == 1
    assert result.metrics["graph_only_streets"] == 1


@pytest.mark.parametrize(
    ("ratios", "status"),
    [
        ([ROUTE_DETOUR_RATIO_RANGE[0], ROUTE_DETOUR_RATIO_RANGE[1]], "pass"),
        ([1.2, ROUTE_DETOUR_RATIO_RANGE[1] + 0.01], "warn"),
        ([1.2, None], "warn"),
    ],
)
def test_route_sanity_passes_only_when_every_route_is_in_range(
    layout: Layout, ratios: list[float | None], status: str
) -> None:
    write_route_checks(
        layout.processed, [(f"Start {i}", f"End {i}", r) for i, r in enumerate(ratios)]
    )

    result = check(layout, "route_sanity")

    assert result.status == QualityStatus(status)
    assert result.metrics["routes_checked"] == 2


def test_signal_snapping_reports_attached_and_unsnapped(layout: Layout) -> None:
    report = json.loads((layout.processed / "etl_report.json").read_text(encoding="utf-8"))
    snapping = report["intersections"]["snapping"]

    result = check(layout, "signal_snapping")

    assert result.status == QualityStatus.INFO
    assert result.metrics["attached_signals"] == snapping["attached_signals"]
    assert result.metrics["unsnapped_signals"] == len(snapping["unsnapped"])


@pytest.mark.parametrize(("flagged", "status"), [(0, "info"), (1, "warn")])
def test_signals_needing_review_warns_when_any_is_flagged(
    layout: Layout, flagged: int, status: str
) -> None:
    set_needs_review(layout, flagged)

    result = check(layout, "signals_needing_review")

    assert result.status == QualityStatus(status)
    assert result.metrics["needing_review"] == flagged
    assert len(result.samples) == flagged


def test_bus_lane_crosscheck_counts_each_status(layout: Layout) -> None:
    write_bus_lanes(
        layout,
        [
            bus_lane_row(1, "osm_has_bus_lane"),
            bus_lane_row(2, "osm_has_bus_lane"),
            bus_lane_row(3, "street_not_found"),
        ],
    )

    result = check(layout, "bus_lane_crosscheck")

    assert result.status == QualityStatus.INFO
    assert result.metrics == {
        "osm_has_bus_lane": 2,
        "osm_street_without_bus_lane": 0,
        "street_not_found": 1,
        "unparsed": 0,
    }


def test_empty_bus_lane_crosscheck_is_info_with_zero_counts(layout: Layout) -> None:
    write_bus_lanes(layout, [])

    result = check(layout, "bus_lane_crosscheck")

    assert result.status == QualityStatus.INFO
    assert set(result.metrics.values()) == {0}
    assert result.samples == []


def test_every_check_has_at_most_four_metrics(layout: Layout) -> None:
    """The panel shows four metrics per check; a fifth would be silently hidden."""
    assert all(len(c.metrics) <= 4 for c in summary(layout).checks)


def test_street_share_metric_matches_the_headline_percent(layout: Layout) -> None:
    rows = [
        {"normalised_name": name, "graph_name": name, "ulice_name": name, "ratio": ratio}
        for name, ratio in (("a", 1.0), ("b", 1.0), ("c", 5.0))
    ]
    for row in rows:
        row |= {"graph_km": 1.0, "ulice_km": 1.0, "status": "x"}
    write_street_table(layout.processed, rows)

    result = check(layout, "street_lengths")

    assert result.metrics["share_within_range"] == 0.67
    assert result.headline.startswith("67% of 3 streets")


def test_road_attributes_summarise_the_report_section(layout: Layout) -> None:
    report = json.loads((layout.processed / "etl_report.json").read_text(encoding="utf-8"))
    road = report["road_attributes"]

    result = check(layout, "road_attributes")

    assert result.status == QualityStatus.INFO
    assert result.metrics["bus_lane_km"] == pytest.approx(road["km_by_bus_lane"].get("true", 0.0))
    assert result.metrics["tram_track_km"] == pytest.approx(road["tram"]["km_marked"])
    assert result.metrics["calming_points_on_network"] == road["calming"]["points_on_edges"]


def test_samples_capped_at_five(layout: Layout) -> None:
    write_near_misses(layout, after_welding=12, tertiary_plus=12)
    write_bus_lanes(layout, [bus_lane_row(i, "street_not_found") for i in range(12)])

    result = summary(layout)

    assert all(len(c.samples) <= 5 for c in result.checks)
    assert len(next(c for c in result.checks if c.id == "near_misses").samples) == 5


def test_polish_diacritics_round_trip(layout: Layout) -> None:
    write_bus_lanes(layout, [bus_lane_row(1, "street_not_found", street="ul. Źródlana Łąka")])

    sha256 = write_quality(summary(layout), layout.processed)

    text = (layout.processed / "data_quality.json").read_text(encoding="utf-8")
    assert "ul. Źródlana Łąka" in text  # ensure_ascii=False: no \u escapes
    loaded = DatasetQualityResponse.model_validate_json(text)
    samples = next(c for c in loaded.checks if c.id == "bus_lane_crosscheck").samples
    assert any("ul. Źródlana Łąka" in sample for sample in samples)
    assert len(sha256) == 64


def test_quality_output_is_byte_identical_across_runs(layout: Layout) -> None:
    path = layout.processed / "data_quality.json"
    first_hash = write_quality(summary(layout), layout.processed)
    first = path.read_bytes()
    second_hash = write_quality(summary(layout), layout.processed)

    assert path.read_bytes() == first
    assert first_hash == second_hash


def test_msip_timestamp_parsed_from_aktualnosc(layout: Layout) -> None:
    (raw_dir(layout) / "krakow").mkdir(exist_ok=True)
    (raw_dir(layout) / "krakow" / "__Aktualnosc__.txt").write_text(
        "Data wygenerowania plików: 2026-10-13_00:47:34", encoding="utf-8"
    )

    assert summary(layout).msip_export_timestamp == "2026-10-13 00:47:34"


def test_msip_timestamp_is_none_without_the_file(layout: Layout) -> None:
    assert summary(layout).msip_export_timestamp is None


def test_sources_come_from_the_manifest(layout: Layout) -> None:
    manifest = load_manifest(layout.manifest)

    sources = summary(layout).sources

    assert [s.path for s in sources] == [e.path for e in manifest.entries]
    assert all(s.retrieved_on == "2026-10-14" for s in sources)


def test_run_quality_records_consumed_and_written_hashes(layout: Layout) -> None:
    section = run_quality(raw_dir(layout), layout.processed)

    assert set(section.consumed_sha256) == set(QUALITY_INPUT_FILENAMES)
    assert set(section.artifact_sha256) == {"data_quality.json"}
    written = json.loads((layout.processed / "data_quality.json").read_text(encoding="utf-8"))
    assert section.manifest_sha256 == written["manifest_sha256"]
