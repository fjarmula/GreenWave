from pathlib import Path

from greenwave.etl.addresses import address_search_key, dedupe_addresses, extract_addresses
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
    assert frame.columns == ["street", "housenumber", "search_key", "lat", "lng"]


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
