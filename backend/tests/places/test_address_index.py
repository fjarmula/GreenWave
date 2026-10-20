import polars as pl
import pytest

from greenwave.etl.addresses import address_search_key
from greenwave.places.address_index import AddressIndex

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


@pytest.fixture
def index() -> AddressIndex:
    frame = pl.DataFrame(
        {
            "street": [s for s, _ in _ROWS],
            "housenumber": [h for _, h in _ROWS],
            "search_key": [address_search_key(s) for s, _ in _ROWS],
            "lat": [50.06 + i * 0.001 for i in range(len(_ROWS))],
            "lng": [19.93 + i * 0.001 for i in range(len(_ROWS))],
        }
    )
    return AddressIndex.from_frame(frame)


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
