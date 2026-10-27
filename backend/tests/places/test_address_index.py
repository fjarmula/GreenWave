import polars as pl
import pytest

from greenwave.etl.addresses import address_search_key
from greenwave.places.address_index import AddressIndex
from greenwave.schemas import AddressProvenance, Position

_ROWS = [
    ("Floriańska", "1"),
    ("Floriańska", "1a"),
    ("Floriańska", "2"),
    ("Floriańska", "10"),
    ("Floriańska", "15"),
    ("Floriańska", "15/2"),
    ("Długa", "3"),
    ("Długa", "7"),
    ("Przy Długiej", "1"),
    ("Szlak", "5"),
]


def _frame(rows: list[tuple[str, str]], outside: list[bool] | None = None) -> pl.DataFrame:
    return pl.DataFrame(
        {
            "street": [s for s, _ in rows],
            "housenumber": [h for _, h in rows],
            "search_key": [address_search_key(s) for s, _ in rows],
            "locality": [""] * len(rows),
            "outside_krakow": outside or [False] * len(rows),
            "label": [f"{s} {h}" for s, h in rows],
            "lat": [50.06 + i * 0.001 for i in range(len(rows))],
            "lng": [19.93 + i * 0.001 for i in range(len(rows))],
        }
    ).pipe(_osm_provenance)


_PROVENANCE_COLUMNS: dict[str, pl.DataType] = {
    "alt_search_key": pl.String(),
    "emuia_id": pl.Int64(),
    "osm_lat": pl.Float64(),
    "osm_lng": pl.Float64(),
    "osm_delta_m": pl.Float64(),
    "match_basis": pl.String(),
}


def _osm_provenance(frame: pl.DataFrame) -> pl.DataFrame:
    """The provenance columns of an OSM-only address (all optional fields null)."""
    return frame.with_columns(
        pl.lit("osm").alias("provenance"),
        pl.lit(False).alias("osm_same_key_elsewhere"),
        *(pl.lit(None, dtype=t).alias(c) for c, t in _PROVENANCE_COLUMNS.items()),
    )


def _record(street: str, number: str, **fields: object) -> pl.DataFrame:
    """One address row; ``fields`` override the OSM-only provenance columns."""
    base = _frame([(street, number)])
    return base.with_columns(*(pl.lit(v, dtype=base.schema[k]).alias(k) for k, v in fields.items()))


@pytest.fixture
def index() -> AddressIndex:
    return AddressIndex.from_frame(_frame(_ROWS))


def _labels(index: AddressIndex, query: str, limit: int = 10) -> list[str]:
    return [r.label for r in index.search(query, limit)]


def test_diacritics_and_prefix_equivalent(index: AddressIndex) -> None:
    expected = _labels(index, "Floriańska")
    assert expected
    assert _labels(index, "florianska") == expected
    assert _labels(index, "ul. Floriańska") == expected
    assert _labels(index, "florianska 1") == _labels(index, "ul. Floriańska 1")


def test_house_number_exact_first(index: AddressIndex) -> None:
    assert _labels(index, "floriańska 1") == [
        "Floriańska 1",
        "Floriańska 1a",
        "Floriańska 10",
        "Floriańska 15",
        "Floriańska 15/2",
    ]


def test_slash_house_number(index: AddressIndex) -> None:
    assert _labels(index, "Floriańska 15/2") == ["Floriańska 15/2"]


def test_natural_order(index: AddressIndex) -> None:
    assert _labels(index, "Floriańska") == [
        "Floriańska 1",
        "Floriańska 1a",
        "Floriańska 2",
        "Floriańska 10",
        "Floriańska 15",
        "Floriańska 15/2",
    ]


def test_contains_fallback(index: AddressIndex) -> None:
    assert _labels(index, "dlu") == ["Długa 3", "Długa 7", "Przy Długiej 1"]


def test_contains_only_when_short_of_limit(index: AddressIndex) -> None:
    assert _labels(index, "dlu", limit=2) == ["Długa 3", "Długa 7"]


def test_limit_respected(index: AddressIndex) -> None:
    assert len(index.search("floriańska", 3)) == 3


def test_positions_are_the_row_coordinates(index: AddressIndex) -> None:
    (result,) = index.search("szlak 5", 8)
    assert (result.position.lat, result.position.lng) == pytest.approx((50.069, 19.939))


def test_no_match(index: AddressIndex) -> None:
    assert index.search("zzz", 8) == []


def test_inside_krakow_ranks_before_outside() -> None:
    frame = _frame([("Długa", "1"), ("Długa", "3")], outside=[True, False]).with_columns(
        pl.Series("label", ["Długa 1 (Wieliczka)", "Długa 3"])
    )
    assert [r.label for r in AddressIndex.from_frame(frame).search("dluga", 8)] == [
        "Długa 3",
        "Długa 1 (Wieliczka)",
    ]


def test_closer_to_centre_breaks_ties() -> None:
    frame = pl.DataFrame(
        {
            "street": ["Polna", "Polna"],
            "housenumber": ["3", "3"],
            "search_key": ["polna", "polna"],
            "locality": ["", ""],
            "outside_krakow": [False, False],
            "label": ["Polna 3 (2)", "Polna 3"],
            "lat": [50.10, 50.07],
            "lng": [19.9373, 19.9373],
        }
    ).pipe(_osm_provenance)
    assert [r.label for r in AddressIndex.from_frame(frame).search("polna 3", 8)] == [
        "Polna 3",
        "Polna 3 (2)",
    ]


def _one(frame: pl.DataFrame, query: str) -> object:
    [result] = AddressIndex.from_frame(frame).search(query, 8)
    return result


def test_matched_clean_result_fields() -> None:
    frame = _record(
        "Długa",
        "5",
        provenance="matched",
        emuia_id=1,
        osm_lat=50.0,
        osm_lng=19.9,
        osm_delta_m=40.0,
        match_basis="exact_key",
    )
    result = _one(frame, "dluga 5")
    assert result.provenance is AddressProvenance.MATCHED
    assert result.osm_delta_m == 40.0
    assert result.disagreement_m is None
    assert result.osm_position is None
    assert result.osm_same_key_elsewhere is False


def test_disagreement_result_fields() -> None:
    frame = _record(
        "Długa",
        "5",
        provenance="matched",
        emuia_id=1,
        osm_lat=50.001,
        osm_lng=19.902,
        osm_delta_m=250.0,
        match_basis="exact_key",
    )
    result = _one(frame, "dluga 5")
    assert result.osm_delta_m == 250.0
    assert result.disagreement_m == 250.0
    assert result.osm_position == Position(lat=50.001, lng=19.902)


def test_municipal_and_osm_results() -> None:
    municipal = _one(
        _record("Długa", "5", provenance="municipal", emuia_id=2, osm_same_key_elsewhere=True),
        "dluga 5",
    )
    assert municipal.provenance is AddressProvenance.MUNICIPAL
    assert (municipal.osm_delta_m, municipal.disagreement_m, municipal.osm_position) == (
        None,
        None,
        None,
    )
    assert municipal.osm_same_key_elsewhere is True
    assert _one(_frame([("Długa", "5")]), "dluga 5").provenance is AddressProvenance.OSM


def test_alt_key_record_returned_once() -> None:
    frame = _record(
        "Moniuszki",
        "5",
        provenance="matched",
        emuia_id=1,
        osm_lat=50.0,
        osm_lng=19.9,
        osm_delta_m=30.0,
        match_basis="name_variant",
        alt_search_key=address_search_key("Stanisława Moniuszki"),
    )
    index = AddressIndex.from_frame(frame)
    for query in ("Stanisława Moniuszki 5", "Moniuszki 5", "moniuszki"):
        assert [r.label for r in index.search(query, 8)] == ["Moniuszki 5"], query


def test_alt_key_hits_do_not_crowd_out_contains_matches() -> None:
    variant = _record(
        "Niepokalanej Panny Marii",
        "5",
        provenance="matched",
        emuia_id=1,
        osm_lat=50.0,
        osm_lng=19.9,
        osm_delta_m=10.0,
        match_basis="name_variant",
        alt_search_key=address_search_key("Niepokalanej Marii Panny"),
    )
    contains = _frame([("Przy Niepokalanej", "1")])
    index = AddressIndex.from_frame(pl.concat([variant, contains], how="vertical_relaxed"))

    assert [r.label for r in index.search("niepokalanej", 2)] == [
        "Niepokalanej Panny Marii 5",
        "Przy Niepokalanej 1",
    ]
