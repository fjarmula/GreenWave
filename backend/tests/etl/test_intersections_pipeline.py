import json
from pathlib import Path

import polars as pl
import pytest

from greenwave.etl.config import PEDESTRIAN_CROSSING_DELAY_SECONDS, SIGNAL_DELAY_SECONDS
from greenwave.etl.graph_io import read_graph
from greenwave.etl.intersections_pipeline import (
    APPROACHES_FILENAME,
    IDS_FILENAME,
    INTERSECTIONS_FILENAME,
    NETWORK_EDGES_FILENAME,
    NETWORK_NODES_FILENAME,
    T4_ARTIFACT_FILENAMES,
    run_intersections,
)
from greenwave.etl.io import REPORT_FILENAME, update_report_section
from greenwave.etl.manifest import MANIFEST_FILENAME, sha256_of_file
from greenwave.etl.neighbours_pipeline import (
    NEIGHBOURS_FILENAME,
    StaleArtifactError,
    run_neighbours,
)
from tests.support.pipeline_fixtures import make_raw


def test_pipeline_writes_all_artifacts_and_ties_ids_to_the_manifest(tmp_path: Path) -> None:
    raw = make_raw(tmp_path)
    processed = tmp_path / "processed"

    section = run_intersections(raw, processed, tmp_path / "overrides")

    ids = json.loads((processed / IDS_FILENAME).read_text(encoding="utf-8"))
    assert ids["valid_for"]["manifest_sha256"] == sha256_of_file(raw / MANIFEST_FILENAME)
    assert [i["id"] for i in ids["intersections"]] == ["INT-0001", "INT-0002"]
    intersections = pl.read_parquet(processed / INTERSECTIONS_FILENAME)
    first = intersections.filter(pl.col("kind") == "signalised_junction").to_dicts()[0]
    assert first["name"] == "Aleja Testowa / Poprzeczna"
    assert first["approaches"] == 2
    assert first["street_names_in_ulice"] == [True, False]
    assert intersections.filter(pl.col("kind") == "pedestrian_crossing").height == 1

    graph = read_graph(processed, NETWORK_NODES_FILENAME, NETWORK_EDGES_FILENAME)
    assert graph.number_of_edges() > 0
    assert any(d["edge_id"].endswith("~0") for *_, d in graph.edges(data=True))

    assert section.snapping.unsnapped == []
    assert section.grouping.intersections_signalised_junction == 1
    assert section.grouping.intersections_pedestrian_crossing == 1
    assert section.grouping.intersections_midblock_signal == 0
    # three name components in total (two at the junction, one at the crossing); two are in Ulice
    assert section.welds.welded == 1  # the stem that stopped 0.6 m short of the main road
    assert section.welds.welds[0].action == "inserted_vertex"
    assert (processed / "welds.csv").is_file()
    assert (processed / "near_misses_tertiary_plus.csv").is_file()
    assert section.near_misses_before_welding.near_misses == 1
    assert section.near_misses_after_welding.near_misses == 0
    assert section.names.components_total == 3
    assert section.names.components_found_in_ulice == 2
    assert section.assignment_distance.approaches == 2
    assert section.assignment_distance.limit_m == 50.0
    assert section.manifest_sha256 == ids["valid_for"]["manifest_sha256"]


def test_pipeline_output_is_deterministic(tmp_path: Path) -> None:
    raw = make_raw(tmp_path)

    run_intersections(raw, tmp_path / "a", tmp_path / "overrides")
    run_intersections(raw, tmp_path / "b", tmp_path / "overrides")

    for name in (IDS_FILENAME, INTERSECTIONS_FILENAME):
        assert (tmp_path / "a" / name).read_bytes() == (tmp_path / "b" / name).read_bytes()


def test_neighbours_step_reads_the_processed_artifacts_and_refuses_a_stale_manifest(
    tmp_path: Path,
) -> None:
    raw = make_raw(tmp_path)
    processed = tmp_path / "processed"
    update_report_section(
        processed / REPORT_FILENAME,
        "intersections",
        run_intersections(raw, processed, tmp_path / "overrides"),
    )

    section = run_neighbours(raw, processed, threshold_meters=250.0)

    pairs = pl.read_parquet(processed / NEIGHBOURS_FILENAME)
    assert section.report.pairs == pairs.height > 0
    assert section.report.approach_edges > 0
    assert (pairs["from_intersection_id"] != pairs["to_intersection_id"]).all()
    assert (pairs["distance_m"] <= 250.0).all()
    assert section.report.candidate_set_only.startswith("Candidate set only")

    manifest = raw / MANIFEST_FILENAME
    manifest.write_text(manifest.read_text(encoding="utf-8") + "\n", encoding="utf-8")
    with pytest.raises(StaleArtifactError, match="re-run the intersections step"):
        run_neighbours(raw, processed)


def _build_t4(tmp_path: Path) -> tuple[Path, Path]:
    raw = make_raw(tmp_path)
    processed = tmp_path / "processed"
    update_report_section(
        processed / REPORT_FILENAME,
        "intersections",
        run_intersections(raw, processed, tmp_path / "overrides"),
    )
    return raw, processed


def test_the_section_records_the_hash_of_every_artifact_and_the_delays_used(
    tmp_path: Path,
) -> None:
    raw = make_raw(tmp_path)
    processed = tmp_path / "processed"

    section = run_intersections(raw, processed, tmp_path / "overrides")

    assert section.artifact_sha256 == {
        name: sha256_of_file(processed / name) for name in T4_ARTIFACT_FILENAMES
    }
    assert set(section.artifact_sha256) == {
        "network_nodes.parquet",
        "network_edges.parquet",
        "intersections.parquet",
        "signal_approaches.parquet",
        "intersection_ids.json",
    }
    assert section.delay_seconds_by_kind == {
        "signalised_junction": SIGNAL_DELAY_SECONDS,
        "midblock_signal": SIGNAL_DELAY_SECONDS,
        "pedestrian_crossing": PEDESTRIAN_CROSSING_DELAY_SECONDS,
    }
    delays = pl.read_parquet(processed / INTERSECTIONS_FILENAME).select("kind", "delay_seconds")
    assert dict(delays.iter_rows()) == {
        "signalised_junction": SIGNAL_DELAY_SECONDS,
        "pedestrian_crossing": PEDESTRIAN_CROSSING_DELAY_SECONDS,
    }


def test_the_neighbours_step_records_its_output_and_the_files_it_read(tmp_path: Path) -> None:
    raw, processed = _build_t4(tmp_path)
    recorded = json.loads((processed / REPORT_FILENAME).read_text(encoding="utf-8"))

    section = run_neighbours(raw, processed)

    assert section.artifact_sha256 == {
        NEIGHBOURS_FILENAME: sha256_of_file(processed / NEIGHBOURS_FILENAME)
    }
    assert section.consumed_sha256 == recorded["intersections"]["artifact_sha256"]


def test_the_neighbours_step_detects_a_t4_file_changed_after_the_intersections_step(
    tmp_path: Path,
) -> None:
    raw, processed = _build_t4(tmp_path)
    path = processed / APPROACHES_FILENAME
    path.write_bytes(path.read_bytes() + b"x")

    with pytest.raises(StaleArtifactError, match=APPROACHES_FILENAME) as error:
        run_neighbours(raw, processed)
    assert "re-run the intersections step" in str(error.value)


def test_the_neighbours_step_detects_a_t4_rerun_whose_section_was_not_recorded(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    raw, processed = _build_t4(tmp_path)
    monkeypatch.setattr(
        "greenwave.etl.intersections_pipeline.kind_delay_seconds",
        lambda: {
            k: 99.0 for k in ("signalised_junction", "midblock_signal", "pedestrian_crossing")
        },
    )
    run_intersections(raw, processed, tmp_path / "overrides")  # changed setting, report not updated

    with pytest.raises(StaleArtifactError, match=INTERSECTIONS_FILENAME):
        run_neighbours(raw, processed)


@pytest.mark.parametrize("drop", ["section", "field", "one_file"])
def test_the_neighbours_step_asks_for_a_rerun_when_the_hashes_are_missing(
    tmp_path: Path, drop: str
) -> None:
    raw, processed = _build_t4(tmp_path)
    report_path = processed / REPORT_FILENAME
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if drop == "section":
        del report["intersections"]
    elif drop == "field":
        del report["intersections"]["artifact_sha256"]
    else:
        del report["intersections"]["artifact_sha256"][IDS_FILENAME]
    report_path.write_text(json.dumps(report), encoding="utf-8")

    with pytest.raises(StaleArtifactError, match="re-run the intersections step"):
        run_neighbours(raw, processed)


def test_the_neighbours_step_asks_for_a_rerun_when_there_is_no_report(tmp_path: Path) -> None:
    raw, processed = _build_t4(tmp_path)
    (processed / REPORT_FILENAME).unlink()

    with pytest.raises(StaleArtifactError, match="re-run the intersections step"):
        run_neighbours(raw, processed)
