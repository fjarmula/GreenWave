from typing import Any

import numpy as np
import polars as pl
import pytest

from greenwave.etl.address_reconcile import (
    MATCH_EXACT_KEY,
    MATCH_NAME_VARIANT,
    PROVENANCE_MATCHED,
    PROVENANCE_MUNICIPAL,
    PROVENANCE_OSM,
    reconcile_addresses,
    reconciliation_examples,
    token_compatible,
)
from greenwave.etl.addresses import address_search_key, assign_labels, canonical_housenumber
from greenwave.etl.geo import unproject_points

X0, Y0 = 7_420_000.0, 5_545_000.0


def _lon_lat(dx: float, dy: float) -> tuple[float, float]:
    lon, lat = unproject_points(np.array([[X0 + dx, Y0 + dy]]))[0]
    return float(lon), float(lat)


def _emuia(*rows: tuple[int, str, str, float, float]) -> pl.DataFrame:
    """(emuia_id, street, number, dx, dy) at metric offsets from (X0, Y0)."""
    records: list[dict[str, Any]] = []
    for fid, street, number, dx, dy in rows:
        lon, lat = _lon_lat(dx, dy)
        records.append(
            {
                "emuia_id": fid,
                "street": street,
                "housenumber": number,
                "search_key": address_search_key(street),
                "number_key": canonical_housenumber(number),
                "district": "Stare Miasto",
                "district_number": 6,
                "x_m": X0 + dx,
                "y_m": Y0 + dy,
                "lat": lat,
                "lng": lon,
            }
        )
    return pl.DataFrame(
        records,
        schema={
            "emuia_id": pl.Int64,
            "street": pl.Utf8,
            "housenumber": pl.Utf8,
            "search_key": pl.Utf8,
            "number_key": pl.Utf8,
            "district": pl.Utf8,
            "district_number": pl.Int8,
            "x_m": pl.Float64,
            "y_m": pl.Float64,
            "lat": pl.Float64,
            "lng": pl.Float64,
        },
    )


def _osm(*rows: tuple[str, str, float, float, bool]) -> pl.DataFrame:
    """(street, number, dx, dy, outside_krakow) in the addresses.parquet schema, before labels."""
    records = []
    for street, number, dx, dy, outside in rows:
        lon, lat = _lon_lat(dx, dy)
        records.append(
            {
                "street": street,
                "housenumber": number,
                "search_key": address_search_key(street),
                "locality": "Wieliczka" if outside else "",
                "outside_krakow": outside,
                "lat": lat,
                "lng": lon,
            }
        )
    return pl.DataFrame(
        records,
        schema={
            "street": pl.Utf8,
            "housenumber": pl.Utf8,
            "search_key": pl.Utf8,
            "locality": pl.Utf8,
            "outside_krakow": pl.Boolean,
            "lat": pl.Float64,
            "lng": pl.Float64,
        },
    )


def _run(
    emuia: pl.DataFrame, osm: pl.DataFrame, extracted: frozenset[tuple[str, str]] = frozenset()
) -> Any:
    return reconcile_addresses(emuia, osm, extracted)


def _by_provenance(frame: pl.DataFrame, provenance: str) -> list[dict[str, Any]]:
    return frame.filter(pl.col("provenance") == provenance).to_dicts()


def test_clean_match_uses_emuia_coordinate() -> None:
    emuia = _emuia((1, "Długa", "5", 0, 0))
    frame, counts = _run(emuia, _osm(("ul. Długa", "5", 40, 0, False)))

    assert frame.height == 1
    row = frame.row(0, named=True)
    assert row["provenance"] == PROVENANCE_MATCHED
    assert row["match_basis"] == MATCH_EXACT_KEY
    assert row["osm_delta_m"] == pytest.approx(40.0, abs=0.01)
    assert (row["lat"], row["lng"]) == (emuia["lat"][0], emuia["lng"][0])
    osm_lon, osm_lat = _lon_lat(40, 0)
    assert row["osm_lat"] == pytest.approx(osm_lat)
    assert row["osm_lng"] == pytest.approx(osm_lon)
    assert row["street"] == "Długa"
    assert row["locality"] == "Stare Miasto"
    assert row["emuia_id"] == 1
    assert row["alt_search_key"] is None
    assert row["osm_same_key_elsewhere"] is False
    assert counts.matched_clean == 1
    assert counts.matched_disagreement == 0


def test_disagreement_tier() -> None:
    frame, counts = _run(_emuia((1, "Długa", "5", 0, 0)), _osm(("Długa", "5", 250, 0, False)))

    row = frame.row(0, named=True)
    assert row["provenance"] == PROVENANCE_MATCHED
    assert row["osm_delta_m"] == pytest.approx(250.0, abs=0.01)
    assert counts.matched_disagreement == 1
    assert counts.matched_clean == 0


def test_beyond_limit_kept_separate() -> None:
    frame, counts = _run(_emuia((1, "Długa", "5", 0, 0)), _osm(("Długa", "5", 600, 0, False)))

    municipal = _by_provenance(frame, PROVENANCE_MUNICIPAL)
    assert len(municipal) == 1
    assert municipal[0]["osm_same_key_elsewhere"] is True
    assert municipal[0]["osm_delta_m"] is None
    assert len(_by_provenance(frame, PROVENANCE_OSM)) == 1
    assert counts.same_key_beyond_limit == 1
    assert counts.municipal_only_gap_closed == 0
    assert counts.municipal_same_key_elsewhere == 1


def test_outside_krakow_never_matched() -> None:
    frame, counts = _run(_emuia((1, "Długa", "5", 0, 0)), _osm(("Długa", "5", 10, 0, True)))

    assert len(_by_provenance(frame, PROVENANCE_MUNICIPAL)) == 1
    osm = _by_provenance(frame, PROVENANCE_OSM)
    assert len(osm) == 1
    assert osm[0]["outside_krakow"] is True
    assert osm[0]["emuia_id"] is None
    assert counts.osm_only_outside_krakow == 1
    assert counts.osm_only_fallback == 1
    assert counts.municipal_only_gap_closed == 1


def test_name_variant_within_50m() -> None:
    frame, counts = _run(
        _emuia((1, "Moniuszki", "5", 0, 0)), _osm(("Stanisława Moniuszki", "5", 30, 0, False))
    )

    row = frame.row(0, named=True)
    assert frame.height == 1
    assert row["provenance"] == PROVENANCE_MATCHED
    assert row["match_basis"] == MATCH_NAME_VARIANT
    assert row["street"] == "Moniuszki"
    assert row["alt_search_key"] == address_search_key("Stanisława Moniuszki")
    assert counts.matched_name_variant == 1
    assert counts.matched_clean == 1


def test_name_variant_beyond_50m_stays_municipal() -> None:
    frame, counts = _run(
        _emuia((1, "Moniuszki", "5", 0, 0)), _osm(("Stanisława Moniuszki", "5", 60, 0, False))
    )

    municipal = _by_provenance(frame, PROVENANCE_MUNICIPAL)
    assert len(municipal) == 1
    assert municipal[0]["osm_same_key_elsewhere"] is False
    assert counts.matched_name_variant == 0
    assert counts.municipal_only_gap_closed == 1


def test_name_variant_corner_collision_rejected() -> None:
    frame, _ = _run(_emuia((1, "Długa", "1", 0, 0)), _osm(("Krótka", "1", 35, 0, False)))
    assert _by_provenance(frame, PROVENANCE_MATCHED) == []

    frame, _ = _run(_emuia((1, "Długa", "1", 0, 0)), _osm(("Krótka", "1", 15, 0, False)))
    matched = _by_provenance(frame, PROVENANCE_MATCHED)
    assert len(matched) == 1
    assert matched[0]["match_basis"] == MATCH_NAME_VARIANT


def test_name_variant_never_takes_a_pass_one_match() -> None:
    frame, _ = _run(
        _emuia((1, "Moniuszki", "5", 0, 0), (2, "Stanisława Moniuszki", "5", 5, 0)),
        _osm(("Stanisława Moniuszki", "5", 10, 0, False)),
    )

    matched = _by_provenance(frame, PROVENANCE_MATCHED)
    assert [(r["emuia_id"], r["match_basis"]) for r in matched] == [(2, MATCH_EXACT_KEY)]


def test_token_compatible() -> None:
    assert token_compatible("moniuszki", "stanislawa moniuszki")
    assert token_compatible("niepokalanej panny marii", "niepokalanej marii panny")
    assert token_compatible("adolfa szyszko bohusza", "adolfa szyszki bohusza")
    assert token_compatible("bpa wladyslawa bandurskiego", "wladyslawa bandurskiego")
    assert not token_compatible("dluga", "krotka")


def test_number_case_and_space_fold() -> None:
    frame, _ = _run(_emuia((1, "Długa", "15A", 0, 0)), _osm(("Długa", "15 a", 20, 0, False)))
    assert frame["provenance"].to_list() == [PROVENANCE_MATCHED]


def test_greedy_contention_is_deterministic() -> None:
    emuia = _emuia((1, "Długa", "5", 80, 0), (2, "Długa", "5", 20, 0))
    osm = _osm(("Długa", "5", 0, 0, False))

    frame, _ = _run(emuia, osm)
    again, _ = _run(emuia, osm)

    matched = _by_provenance(frame, PROVENANCE_MATCHED)
    assert [r["emuia_id"] for r in matched] == [2]
    assert [r["emuia_id"] for r in _by_provenance(frame, PROVENANCE_MUNICIPAL)] == [1]
    assert frame.equals(again)


def test_gap_versus_same_key_elsewhere() -> None:
    emuia = _emuia((1, "Długa", "5", 0, 0))

    _, gap = _run(emuia, _osm())
    assert gap.municipal_only_gap_closed == 1
    assert gap.municipal_same_key_elsewhere == 0

    _, elsewhere = _run(emuia, _osm(), frozenset({(address_search_key("Długa"), "5")}))
    assert elsewhere.municipal_only_gap_closed == 0
    assert elsewhere.municipal_same_key_elsewhere == 1


def test_output_order_emuia_then_osm() -> None:
    frame, counts = _run(
        _emuia((5, "Długa", "2", 0, 0), (3, "Długa", "1", 0, 0)),
        _osm(("Krótka", "9", 900, 0, False), ("Długa", "1", 10, 0, False)),
    )

    assert frame["emuia_id"].to_list() == [3, 5, None]
    assert frame["provenance"].to_list() == [
        PROVENANCE_MATCHED,
        PROVENANCE_MUNICIPAL,
        PROVENANCE_OSM,
    ]
    assert counts.municipal_rows == 2


def test_examples_selection() -> None:
    # Seven disagreements on six streets; street "Ulica 0" has two.
    rows = [(i + 1, f"Ulica {i % 6}", str(i + 1), 0.0, float(i * 2000)) for i in range(7)]
    osm = [(f"Ulica {i % 6}", str(i + 1), 110.0 + 50 * i, float(i * 2000), False) for i in range(7)]
    frame, _ = _run(_emuia(*rows), _osm(*osm))
    examples = reconciliation_examples(assign_labels(frame))

    shown = examples.matched_disagreement
    assert len(shown) == 5
    deltas = [int(s.rsplit(": ", 1)[1].removesuffix(" m")) for s in shown]
    assert deltas == sorted(deltas, reverse=True)
    assert deltas[0] == 410
    streets = [s.split(" ")[1] for s in shown]
    assert len(set(streets)) == 5
    assert all(s.endswith(" m") for s in shown)


def test_examples_gap_and_clean_prefer_well_mapped_streets() -> None:
    emuia = _emuia(
        (1, "Długa", "1", 0, 0),
        (2, "Długa", "2", 0, 3000),
        (3, "Długa", "3", 0, 6000),
        (4, "Krótka", "1", 0, 9000),
        (5, "Krótka", "2", 0, 12000),
    )
    osm = _osm(("Długa", "1", 10, 0, False), ("Długa", "2", 10, 3000, False))
    frame, _ = _run(emuia, osm)
    examples = reconciliation_examples(assign_labels(frame))

    assert examples.municipal_only_gap_closed == ["Długa 3", "Krótka 1"]
    assert examples.matched_clean == ["Długa 1: 10 m"]


def test_district_number_by_provenance() -> None:
    frame, _ = reconcile_addresses(
        _emuia((1, "Długa", "1", 0, 0), (2, "Długa", "3", 300, 0)),
        _osm(("Długa", "1", 5, 0, False), ("Krótka", "9", 600, 0, False)),
        frozenset(),
    )

    assert frame.schema["district_number"] == pl.Int8
    by_provenance = dict(frame.select("provenance", "district_number").rows())
    assert by_provenance == {PROVENANCE_MATCHED: 6, PROVENANCE_MUNICIPAL: 6, PROVENANCE_OSM: None}
