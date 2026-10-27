from pathlib import Path

import polars as pl

from greenwave.etl.addresses import (
    address_search_key,
    assign_labels,
    canonical_housenumber,
    dedupe_addresses,
    extract_addresses,
)
from greenwave.etl.config import ADDRESS_DEDUP_RADIUS_M
from greenwave.etl.ingest_osm import OsmFeature, iter_osm_records
from tests.support.osm_fixtures import closed_way, line, point, polygon, write_osm


def _features(tmp_path: Path, *lines: str) -> list[OsmFeature]:
    path = write_osm(tmp_path, *lines)
    return [r for r in iter_osm_records(path) if isinstance(r, OsmFeature)]


def test_street_or_place(tmp_path: Path) -> None:
    features = _features(
        tmp_path,
        point(19.9, 50.0, **{"addr:street": "Floriańska", "addr:housenumber": "1"}),
        point(19.91, 50.01, **{"addr:place": "Osada", "addr:housenumber": "2"}),
        point(19.92, 50.02, **{"addr:housenumber": "3"}),
        point(19.93, 50.03, name="no address"),
    )
    frame, skipped, _ = extract_addresses(features)
    assert sorted(frame["street"].to_list()) == ["Floriańska", "Osada"]
    assert skipped == 1


def test_missing_housenumber_skipped(tmp_path: Path) -> None:
    features = _features(tmp_path, point(19.9, 50.0, **{"addr:street": "Floriańska"}))
    frame, skipped, _ = extract_addresses(features)
    assert frame.height == 0
    assert skipped == 1
    assert frame.columns == [
        "street",
        "housenumber",
        "search_key",
        "locality",
        "outside_krakow",
        "lat",
        "lng",
    ]


def test_search_key_folds() -> None:
    assert address_search_key("ul. Floriańska") == address_search_key("Florianska")


def test_dedup_keeps_first_in_stable_sort(tmp_path: Path) -> None:
    tags = {"addr:street": "Floriańska", "addr:housenumber": "15"}
    a = point(19.9, 50.0, **tags)
    b = point(19.9005, 50.0005, **tags)  # ~66 m apart: one address
    forward, merged = dedupe_addresses(extract_addresses(_features(tmp_path, a, b))[0], 150.0)
    backward, _ = dedupe_addresses(extract_addresses(_features(tmp_path, b, a))[0], 150.0)
    assert merged == 1
    assert forward.height == 1
    assert forward.equals(backward)
    assert forward["lng"][0] == 19.9


def test_dedup_keeps_same_address_far_apart(tmp_path: Path) -> None:
    tags = {"addr:street": "Polna", "addr:housenumber": "3"}
    near_a = point(19.9, 50.0, **tags)
    near_b = point(19.9001, 50.0, **tags)  # ~7 m: same building
    far = point(19.95, 50.05, **tags)  # ~6.7 km: another locality
    frame, merged = dedupe_addresses(
        extract_addresses(_features(tmp_path, far, near_b, near_a))[0], 150.0
    )
    assert merged == 1
    assert sorted(frame["lng"].to_list()) == [19.9, 19.95]


def test_building_polygon_address(tmp_path: Path) -> None:
    ring = [(19.9, 50.0), (19.901, 50.0), (19.901, 50.001), (19.9, 50.001), (19.9, 50.0)]
    features = _features(
        tmp_path, polygon(ring, **{"addr:street": "Długa", "addr:housenumber": "7"})
    )
    frame, skipped, _ = extract_addresses(features)
    assert skipped == 0
    assert frame.height == 1
    assert 19.9 < frame["lng"][0] < 19.901
    assert 50.0 < frame["lat"][0] < 50.001


def test_closed_linestring_building_gives_a_row(tmp_path: Path) -> None:
    ring = [(19.9, 50.0), (19.9002, 50.0), (19.9002, 50.0002), (19.9, 50.0002)]
    tags = {"addr:street": "Floriańska", "addr:housenumber": "5"}
    frame, skipped, no_point = extract_addresses(_features(tmp_path, closed_way(ring, **tags)))
    assert (frame.height, skipped, no_point) == (1, 0, 0)


def test_no_usable_point_counted_apart_from_missing_tags(tmp_path: Path) -> None:
    tags = {"addr:street": "Floriańska", "addr:housenumber": "5"}
    open_way = line([(19.9, 50.0), (19.901, 50.0)], **tags)
    frame, skipped, no_point = extract_addresses(_features(tmp_path, open_way))
    assert (frame.height, skipped, no_point) == (0, 0, 1)


def test_default_merge_radius_is_400_m(tmp_path: Path) -> None:
    tags = {"addr:street": "Kampus", "addr:housenumber": "1"}
    a = point(19.9, 50.0, **tags)
    b = point(19.9, 50.0027, **tags)  # ~300 m: one campus
    frame, merged = dedupe_addresses(extract_addresses(_features(tmp_path, a, b))[0])
    assert ADDRESS_DEDUP_RADIUS_M == 400.0
    assert (frame.height, merged) == (1, 1)


def test_locality_fallback_order(tmp_path: Path) -> None:
    base = {"addr:street": "Długa", "addr:housenumber": "1"}
    features = _features(
        tmp_path,
        point(19.90, 50.0, **base, **{"addr:suburb": "S", "addr:quarter": "Q", "addr:city": "C"}),
        point(19.91, 50.0, **base, **{"addr:quarter": "Q", "addr:place": "P", "addr:city": "C"}),
        point(19.92, 50.0, **base, **{"addr:place": "P", "addr:city": "C"}),
        point(19.93, 50.0, **base, **{"addr:city": "C"}),
        point(19.94, 50.0, **base),
    )
    frame = extract_addresses(features)[0].sort("lng")
    assert frame["locality"].to_list() == ["S", "Q", "P", "C", ""]


def test_krakow_city_is_never_a_locality(tmp_path: Path) -> None:
    base = {"addr:street": "Długa", "addr:housenumber": "1"}
    features = _features(
        tmp_path,
        point(19.90, 50.0, **base, **{"addr:city": "Kraków"}),
        point(19.91, 50.0, **base, **{"addr:suburb": "Kleparz", "addr:city": "Kraków"}),
    )
    frame = extract_addresses(features)[0].sort("lng")
    assert frame["locality"].to_list() == ["", "Kleparz"]


def test_outside_krakow_flag(tmp_path: Path) -> None:
    features = _features(
        tmp_path,
        point(
            19.90, 50.0, **{"addr:street": "A", "addr:housenumber": "1", "addr:city": "Wieliczka"}
        ),
        point(
            19.91,
            50.0,
            **{
                "addr:place": "Osiedle Złotej Jesieni",
                "addr:housenumber": "1",
                "addr:city": "Kraków",
            },
        ),
        point(19.92, 50.0, **{"addr:place": "Tomaszowice", "addr:housenumber": "2"}),
        point(19.93, 50.0, **{"addr:street": "B", "addr:housenumber": "3"}),
    )
    frame = extract_addresses(features)[0].sort("lng")
    assert frame["outside_krakow"].to_list() == [True, False, True, False]


def _labelled(*rows: tuple[str, str, str, bool, float]) -> list[str]:
    frame = pl.DataFrame(
        {
            "street": [r[0] for r in rows],
            "housenumber": [r[1] for r in rows],
            "search_key": [address_search_key(r[0]) for r in rows],
            "locality": [r[2] for r in rows],
            "outside_krakow": [r[3] for r in rows],
            "lat": [r[4] for r in rows],
            "lng": [19.9373] * len(rows),
        }
    )
    return assign_labels(frame)["label"].to_list()


def test_unique_inside_label_is_bare() -> None:
    assert _labelled(("Floriańska", "1", "Stare Miasto", False, 50.06)) == ["Floriańska 1"]


def test_outside_label_names_locality() -> None:
    assert _labelled(("Polna", "3", "Zielonki", True, 50.1)) == ["Polna 3 (Zielonki)"]


def test_village_place_as_street_not_repeated() -> None:
    assert _labelled(("Tomaszowice", "2", "Tomaszowice", True, 50.1)) == ["Tomaszowice 2"]


def test_duplicate_labels_get_locality() -> None:
    labels = _labelled(
        ("Długa", "1", "Stare Miasto", False, 50.06),
        ("Długa", "1", "Wieliczka", True, 49.98),
    )
    assert labels == ["Długa 1 (Stare Miasto)", "Długa 1 (Wieliczka)"]


def test_inside_krakow_collision_without_locality_is_numbered() -> None:
    labels = _labelled(
        ("Długa", "1", "", False, 50.0665),  # closer to the centre
        ("Długa", "1", "", False, 50.0730),
    )
    assert labels == ["Długa 1", "Długa 1 (2)"]


def test_duplicates_without_locality_still_unique() -> None:
    labels = _labelled(
        ("Polna", "3", "", False, 50.10),  # farther from the centre
        ("Polna", "3", "", False, 50.07),
        ("Polna", "3", "Zielonki", False, 50.12),
    )
    assert labels == ["Polna 3 (2)", "Polna 3", "Polna 3 (Zielonki)"]
    assert len(set(labels)) == 3


def test_canonical_housenumber() -> None:
    assert canonical_housenumber("15a") == "15A"
    assert canonical_housenumber(" 15 a ") == "15A"
    assert canonical_housenumber("15/2b") == "15/2B"


def test_dedup_merges_house_numbers_differing_only_by_spacing(tmp_path: Path) -> None:
    a = point(19.9, 50.0, **{"addr:street": "Miodowa", "addr:housenumber": "28a"})
    b = point(19.90001, 50.0, **{"addr:street": "Miodowa", "addr:housenumber": "28 A"})

    frame, merged = dedupe_addresses(extract_addresses(_features(tmp_path, a, b))[0], 150.0)

    assert merged == 1
    assert frame.height == 1
