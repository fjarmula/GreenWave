from pathlib import Path

import polars as pl
import pytest

from greenwave.etl.profile_osm import scan_osm
from greenwave.etl.signals import SignalSettings, SignalsResult, build_signals
from tests.support.osm_fixtures import line, point, write_osm

# 0.001 degree of latitude is about 111.2 m at Krakow's latitude.
LON = 19.9
ROAD = line([(LON - 0.01, 50.0), (LON + 0.01, 50.0)], highway="primary")
SIGNAL = {"highway": "traffic_signals"}


def _build(tmp_path: Path, *features: str, settings: SignalSettings | None = None) -> SignalsResult:
    return build_signals(scan_osm(write_osm(tmp_path, ROAD, *features)), {}, settings)


def _row(result: SignalsResult, line_number: int) -> dict[str, object]:
    return result.frame.filter(pl.col("source_line") == line_number).to_dicts()[0]


def test_signal_tag_policy_decides_counting_review_and_rejects(tmp_path: Path) -> None:
    result = _build(
        tmp_path,
        point(LON, 50.000, **SIGNAL),  # line 3: untagged variant
        point(LON, 50.010, **SIGNAL, traffic_signals="signal"),  # line 4
        point(LON, 50.020, **SIGNAL, traffic_signals="blinker"),  # line 5
        point(LON, 50.030, **SIGNAL, traffic_signals="tram_priority"),  # line 6
        point(LON, 50.040, **SIGNAL, traffic_signals="controller"),  # line 7
        point(LON, 50.050, **SIGNAL, traffic_signals="mystery"),  # line 8
    )

    rows = {n: _row(result, n) for n in range(3, 9)}

    assert [rows[n]["counts_in_delay"] for n in range(3, 9)] == [
        True,
        True,
        False,
        False,
        True,
        False,
    ]
    assert [rows[n]["delay_seconds"] for n in range(3, 9)] == [35.0, 35.0, None, None, 35.0, None]
    assert rows[7]["needs_review"] is True
    assert rows[3]["needs_review"] is False
    assert "mystery" in str(rows[8]["reject_reason"])
    categories = {
        r.source_line: r.category
        for r in result.report.rejects
        if r.category != "signal_off_network"
    }
    assert categories == {
        5: "non_blocking_signal",
        6: "non_blocking_signal",
        7: "needs_manual_review",
        8: "unrecognised_signal_tag",
    }
    controller = next(r for r in result.report.rejects if r.source_line == 7)
    assert (controller.lon, controller.lat) == (LON, 50.040)


def test_crossings_are_typed_and_judged_against_counted_signals(tmp_path: Path) -> None:
    result = _build(
        tmp_path,
        point(LON, 50.0000, **SIGNAL),  # 3 counted signal
        point(LON, 50.0001, highway="crossing", crossing="traffic_signals"),  # 4 ~11 m away
        point(LON, 50.0100, highway="crossing", crossing="traffic_signals"),  # 5 standalone
        point(LON, 50.0200, railway="tram_crossing", crossing="traffic_signals"),  # 6 tram
        point(LON, 50.0300, **SIGNAL, traffic_signals="blinker"),  # 7 blinker
        point(LON, 50.0301, highway="crossing", crossing="traffic_signals"),  # 8 next to blinker
    )

    duplicate, standalone, tram, beside_blinker = (_row(result, n) for n in (4, 5, 6, 8))

    assert duplicate["counts_in_delay"] is False and duplicate["standalone"] is False
    assert standalone["counts_in_delay"] is True and standalone["delay_seconds"] == 35.0
    assert standalone["node_type"] == "pedestrian_crossing"
    assert tram["counts_in_delay"] is False and tram["node_type"] == "other_crossing"
    assert beside_blinker["counts_in_delay"] is True  # a blinker is not a red phase
    report = result.report
    assert report.crossings_counted_standalone == 2
    assert report.crossings_excluded_duplicate_of_signal == 1
    assert report.crossings_excluded_other_kind == 1
    assert report.standalone_if_every_signal_node_counted == 1


def test_standalone_distance_boundary_is_inclusive(tmp_path: Path) -> None:
    features = (
        point(LON, 50.0000, **SIGNAL),
        point(LON, 50.0003, highway="crossing", crossing="traffic_signals"),
    )
    probe = _build(
        tmp_path, *features, settings=SignalSettings(standalone_crossing_distance_meters=500)
    )
    exact = float(_row(probe, 4)["nearest_counted_signal_m"])  # type: ignore[arg-type]

    at = _build(
        tmp_path, *features, settings=SignalSettings(standalone_crossing_distance_meters=exact)
    )
    below = _build(
        tmp_path,
        *features,
        settings=SignalSettings(standalone_crossing_distance_meters=exact - 1e-6),
    )
    above = _build(
        tmp_path,
        *features,
        settings=SignalSettings(standalone_crossing_distance_meters=exact + 1e-6),
    )

    assert _row(at, 4)["standalone"] is False
    assert _row(below, 4)["standalone"] is True
    assert _row(above, 4)["standalone"] is False


def test_provisional_clusters_use_counted_signals_only(tmp_path: Path) -> None:
    # A and B are ~67 m apart; a blinker halfway (~33 m from each) would chain them at 40 m
    # if it were clustered. C is ~33 m from B and a real signal, so B and C do merge.
    result = _build(
        tmp_path,
        point(LON, 50.0000, **SIGNAL),  # 3 A
        point(LON, 50.0003, **SIGNAL, traffic_signals="blinker"),  # 4
        point(LON, 50.0006, **SIGNAL),  # 5 B
        point(LON, 50.0009, **SIGNAL),  # 6 C
    )

    cluster = {n: _row(result, n)["provisional_cluster_id"] for n in (3, 4, 5, 6)}

    assert cluster[4] is None
    assert cluster[3] != cluster[5]
    assert cluster[5] == cluster[6]
    assert _row(result, 5)["provisional_cluster_size"] == 2
    assert result.report.provisional_clusters.clusters == 2


def test_chain_beyond_radius_is_one_provisional_cluster(tmp_path: Path) -> None:
    result = _build(
        tmp_path,
        point(LON, 50.0000, **SIGNAL),
        point(LON, 50.0003, **SIGNAL),
        point(LON, 50.0006, **SIGNAL),
        point(LON, 50.0009, **SIGNAL),
    )

    assert result.report.provisional_clusters.clusters == 1
    assert result.report.provisional_clusters.clusters_with_diameter_over_radius == 1


def test_signal_not_on_a_routable_vertex_is_kept_flagged_and_listed(tmp_path: Path) -> None:
    driveway = line([(LON, 50.001), (LON, 50.002)], highway="service", service="driveway")
    result = _build(
        tmp_path,
        driveway,
        point(LON, 50.0010, **SIGNAL),  # 4: only a driveway vertex, which is not routable
        point(LON + 0.001, 50.0, **SIGNAL),  # 5: mid-link vertex? not a vertex either
    )

    row = _row(result, 4)

    assert row["vertex_position"] == "off_network"
    assert row["counts_in_delay"] is True  # kept; T4 decides whether it can be snapped
    off = [r for r in result.report.rejects if r.category == "signal_off_network"]
    assert {r.source_line for r in off} == {4, 5}
    assert all(r.nearest_routable_way_m is not None for r in off)


def test_vertex_position_classes(tmp_path: Path) -> None:
    junction = (LON, 50.0)
    through = line([(LON - 0.01, 50.0), junction, (LON + 0.01, 50.0)], highway="primary")
    side = line([junction, (LON, 50.001)], highway="residential")
    result = _build(
        tmp_path,
        through,  # line 3
        side,  # line 4
        point(*junction, **SIGNAL),  # line 5: vertex shared by both ways
        point(LON, 50.001, **SIGNAL),  # line 6: end of the side way only
        point(LON - 0.01, 50.0, **SIGNAL),  # line 7: interior of nothing, end of two ways
    )

    assert _row(result, 5)["vertex_position"] == "junction"
    assert _row(result, 6)["vertex_position"] == "way_endpoint"
    assert _row(result, 7)["vertex_position"] == "junction"


def test_frame_is_sorted_by_source_line_and_roundtrips_through_parquet(tmp_path: Path) -> None:
    result = _build(tmp_path, point(LON, 50.0, **SIGNAL), point(LON, 50.01, **SIGNAL))
    target = tmp_path / "signals.parquet"

    result.frame.write_parquet(target)

    restored = pl.read_parquet(target)
    assert restored.equals(result.frame)
    assert restored.schema == result.frame.schema
    assert restored["source_line"].to_list() == sorted(restored["source_line"].to_list())


@pytest.mark.parametrize(
    "kwargs",
    [
        {"cluster_radius_meters": 0.0},
        {"standalone_crossing_distance_meters": -1.0},
        {"signal_delay_seconds": -1.0},
        {"pedestrian_crossing_delay_seconds": -0.1},
    ],
)
def test_invalid_settings_are_rejected(kwargs: dict[str, float]) -> None:
    with pytest.raises(ValueError, match="must"):
        SignalSettings(**kwargs)
