import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import networkx as nx
import polars as pl
import pytest

from conftest import REPORT_FILENAME, Layout
from greenwave.dataset import (
    CountMismatchError,
    DatasetError,
    MalformedArtifactError,
    ManifestMismatchError,
    MissingArtifactError,
    ReferentialIntegrityError,
    load_dataset,
)
from greenwave.etl.intersections_pipeline import (
    APPROACHES_FILENAME,
    IDS_FILENAME,
    INTERSECTIONS_FILENAME,
    NETWORK_EDGES_FILENAME,
    NETWORK_NODES_FILENAME,
)
from greenwave.etl.manifest import load_manifest
from greenwave.etl.neighbours_pipeline import NEIGHBOURS_FILENAME


def edit_json(path: Path, change: Callable[[Any], object]) -> None:
    document = json.loads(path.read_text(encoding="utf-8"))
    change(document)
    path.write_text(json.dumps(document), encoding="utf-8")


def edit_parquet(path: Path, change: Callable[[pl.DataFrame], pl.DataFrame]) -> None:
    pl.read_parquet(path).pipe(change).write_parquet(path)


def test_happy_path_exposes_the_artifacts_untouched(layout: Layout) -> None:
    dataset = load_dataset(layout.processed, layout.manifest)

    assert dataset.counts.intersections == dataset.intersections.height == 2
    assert dataset.counts.signal_approaches == dataset.signal_approaches.height
    assert dataset.counts.approach_neighbours == dataset.approach_neighbours.height > 0
    assert {r.id for r in dataset.intersection_ids} == {"INT-0001", "INT-0002"}
    assert dataset.cascade_threshold_m == 250.0
    assert dataset.allow_u_turns is False
    assert dataset.signal_approaches["delay_seconds"].null_count() == 0
    assert "geometry" in next(iter(dataset.graph.edges(data=True)))[2]
    manifest = load_manifest(layout.manifest)
    assert dataset.provenance.sources == tuple(manifest.entries)
    assert len(dataset.provenance.manifest_sha256) == 64
    with pytest.raises(nx.NetworkXError):
        dataset.graph.add_node("new")


def test_load_logs_counts_and_duration(layout: Layout, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level("INFO", logger="greenwave.dataset.loader"):
        load_dataset(layout.processed, layout.manifest)

    assert "2 intersections" in caplog.text
    assert " s:" in caplog.text


@pytest.mark.parametrize(
    "filename",
    [
        NETWORK_NODES_FILENAME,
        NETWORK_EDGES_FILENAME,
        INTERSECTIONS_FILENAME,
        APPROACHES_FILENAME,
        NEIGHBOURS_FILENAME,
        IDS_FILENAME,
        REPORT_FILENAME,
    ],
)
def test_each_required_file_missing(layout: Layout, filename: str) -> None:
    (layout.processed / filename).unlink()

    with pytest.raises(MissingArtifactError, match=filename) as error:
        load_dataset(layout.processed, layout.manifest)
    assert "scripts/run_etl.py" in str(error.value)


def test_manifest_file_missing(layout: Layout) -> None:
    layout.manifest.unlink()

    with pytest.raises(MissingArtifactError, match=r"MANIFEST\.json"):
        load_dataset(layout.processed, layout.manifest)


def test_changed_manifest_fails_all_three_places(layout: Layout) -> None:
    layout.manifest.write_text(layout.manifest.read_text(encoding="utf-8") + "\n", encoding="utf-8")

    with pytest.raises(ManifestMismatchError) as error:
        load_dataset(layout.processed, layout.manifest)
    message = str(error.value)
    assert IDS_FILENAME in message
    assert "section 'intersections'" in message
    assert "section 'neighbours'" in message


@pytest.mark.parametrize("stale", ["ids", "intersections", "neighbours"])
def test_manifest_hash_mismatch_in_one_place(layout: Layout, stale: str) -> None:
    other = "0" * 64
    if stale == "ids":
        edit_json(
            layout.processed / IDS_FILENAME,
            lambda d: d["valid_for"].__setitem__("manifest_sha256", other),
        )
    else:
        edit_json(
            layout.processed / REPORT_FILENAME,
            lambda d: d[stale].__setitem__("manifest_sha256", other),
        )

    with pytest.raises(ManifestMismatchError) as error:
        load_dataset(layout.processed, layout.manifest)
    message = str(error.value)
    mentioned = {
        "ids": IDS_FILENAME in message,
        "intersections": "section 'intersections'" in message,
        "neighbours": "section 'neighbours'" in message,
    }
    assert mentioned == {key: key == stale for key in mentioned}


def test_dangling_intersection_id_in_approaches(layout: Layout) -> None:
    edit_parquet(
        layout.processed / APPROACHES_FILENAME,
        lambda f: f.with_columns(pl.lit("INT-9999").alias("intersection_id")),
    )

    with pytest.raises(ReferentialIntegrityError, match="INT-9999"):
        load_dataset(layout.processed, layout.manifest)


def test_dangling_intersection_id_in_neighbours(layout: Layout) -> None:
    edit_parquet(
        layout.processed / NEIGHBOURS_FILENAME,
        lambda f: f.with_columns(pl.lit("INT-9999").alias("to_intersection_id")),
    )

    with pytest.raises(ReferentialIntegrityError, match="INT-9999"):
        load_dataset(layout.processed, layout.manifest)


def test_dangling_controlled_edge_id(layout: Layout) -> None:
    edit_parquet(
        layout.processed / APPROACHES_FILENAME,
        lambda f: f.with_columns(pl.lit(["NO-SUCH-EDGE"]).alias("controlled_edge_ids")),
    )

    with pytest.raises(ReferentialIntegrityError, match="NO-SUCH-EDGE"):
        load_dataset(layout.processed, layout.manifest)


def test_dangling_path_edge_id(layout: Layout) -> None:
    edit_parquet(
        layout.processed / NEIGHBOURS_FILENAME,
        lambda f: f.with_columns(pl.lit(["NO-SUCH-PATH-EDGE"]).alias("path_edge_ids")),
    )

    with pytest.raises(ReferentialIntegrityError, match="NO-SUCH-PATH-EDGE"):
        load_dataset(layout.processed, layout.manifest)


def test_dangling_node_key(layout: Layout) -> None:
    edit_parquet(
        layout.processed / INTERSECTIONS_FILENAME,
        lambda f: f.with_columns(pl.lit("0,0").alias("node_key")),
    )

    with pytest.raises(ReferentialIntegrityError, match="node_key"):
        load_dataset(layout.processed, layout.manifest)


def test_ids_file_disagrees_on_kind(layout: Layout) -> None:
    edit_json(
        layout.processed / IDS_FILENAME,
        lambda d: d["intersections"][0].__setitem__("kind", "other_kind"),
    )

    with pytest.raises(ReferentialIntegrityError, match="INT-0001"):
        load_dataset(layout.processed, layout.manifest)


@pytest.mark.parametrize(
    ("section", "path", "artifact"),
    [
        ("intersections", ("grouping", "intersections_total"), INTERSECTIONS_FILENAME),
        ("intersections", ("snapping", "attached_signals"), APPROACHES_FILENAME),
        ("neighbours", ("report", "pairs"), NEIGHBOURS_FILENAME),
        ("neighbours", ("report", "approach_edges"), "approach edges"),
    ],
)
def test_count_mismatch_against_the_report(
    layout: Layout, section: str, path: tuple[str, str], artifact: str
) -> None:
    def bump(document: dict[str, Any]) -> None:
        document[section][path[0]][path[1]] += 1

    edit_json(layout.processed / REPORT_FILENAME, bump)

    with pytest.raises(CountMismatchError, match=artifact):
        load_dataset(layout.processed, layout.manifest)


def test_unsnapped_rows_are_carried_through(layout: Layout) -> None:
    """Null intersection_id and empty controlled edges must load as they are."""
    path = layout.processed / APPROACHES_FILENAME
    frame = pl.read_parquet(path)
    extra = frame.head(1).with_columns(
        pl.lit(None, dtype=pl.String).alias("intersection_id"),
        pl.lit([], dtype=pl.List(pl.String)).alias("controlled_edge_ids"),
        pl.lit("unsnapped-signal").alias("signal_key"),
    )
    pl.concat([frame, extra]).write_parquet(path)
    edit_json(
        layout.processed / REPORT_FILENAME,
        lambda d: d["intersections"]["snapping"]["unsnapped"].append(
            {"signal": "unsnapped-signal"}
        ),
    )

    dataset = load_dataset(layout.processed, layout.manifest)

    assert dataset.signal_approaches.filter(pl.col("intersection_id").is_null()).height == 1
    assert dataset.counts.signal_approaches == frame.height + 1


def test_missing_column_names_file_and_column(layout: Layout) -> None:
    edit_parquet(layout.processed / APPROACHES_FILENAME, lambda f: f.drop("controlled_edge_ids"))

    with pytest.raises(
        MalformedArtifactError, match=rf"{APPROACHES_FILENAME}.*controlled_edge_ids"
    ):
        load_dataset(layout.processed, layout.manifest)


def test_wrong_column_type(layout: Layout) -> None:
    edit_parquet(
        layout.processed / INTERSECTIONS_FILENAME,
        lambda f: f.with_columns(pl.col("kind").cast(pl.Categorical)),
    )

    with pytest.raises(MalformedArtifactError, match="kind"):
        load_dataset(layout.processed, layout.manifest)


@pytest.mark.parametrize(
    "filename",
    [
        NETWORK_NODES_FILENAME,
        NETWORK_EDGES_FILENAME,
        INTERSECTIONS_FILENAME,
        APPROACHES_FILENAME,
        NEIGHBOURS_FILENAME,
        IDS_FILENAME,
        REPORT_FILENAME,
    ],
)
def test_garbage_file_raises_a_dataset_error(layout: Layout, filename: str) -> None:
    (layout.processed / filename).write_bytes(b"not a valid file")

    with pytest.raises(MalformedArtifactError, match=filename):
        load_dataset(layout.processed, layout.manifest)


def test_missing_report_section(layout: Layout) -> None:
    edit_json(layout.processed / REPORT_FILENAME, lambda d: d.pop("neighbours"))

    with pytest.raises(MalformedArtifactError, match="section 'neighbours'"):
        load_dataset(layout.processed, layout.manifest)


def test_every_failure_is_a_dataset_error(layout: Layout) -> None:
    (layout.processed / IDS_FILENAME).unlink()

    with pytest.raises(DatasetError):
        load_dataset(layout.processed, layout.manifest)
