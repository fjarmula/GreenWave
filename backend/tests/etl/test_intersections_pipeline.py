import json
from pathlib import Path

import polars as pl
from pipeline_fixtures import make_raw

from greenwave.etl.graph_io import read_graph
from greenwave.etl.intersections_pipeline import (
    IDS_FILENAME,
    INTERSECTIONS_FILENAME,
    NETWORK_EDGES_FILENAME,
    NETWORK_NODES_FILENAME,
    run_intersections,
)
from greenwave.etl.manifest import MANIFEST_FILENAME, sha256_of_file


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
    import pytest

    from greenwave.etl.neighbours_pipeline import (
        NEIGHBOURS_FILENAME,
        StaleArtifactError,
        run_neighbours,
    )

    raw = make_raw(tmp_path)
    processed = tmp_path / "processed"
    run_intersections(raw, processed, tmp_path / "overrides")

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
