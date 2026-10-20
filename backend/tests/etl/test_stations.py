import json
import random
from pathlib import Path

import pytest

from greenwave.etl import stations as stations_module
from greenwave.etl.feature_points import feature_point
from greenwave.etl.ingest_osm import OsmFeature, iter_osm_records
from greenwave.etl.stations import (
    StationCandidate,
    assign_station_ids,
    classify_station,
    collapse_encoding_twins,
    dedupe_stations,
    extract_station_candidates,
)
from tests.support.osm_fixtures import closed_way, line, point, polygon, write_osm


def _features(tmp_path: Path, *lines: str) -> list[OsmFeature]:
    path = write_osm(tmp_path, *lines)
    return [r for r in iter_osm_records(path) if isinstance(r, OsmFeature)]


def test_classify_tags() -> None:
    assert classify_station({"emergency": "ambulance_station"}) == ("AMBULANCE", "ambulance_base")
    assert classify_station({"amenity": "hospital", "emergency": "yes"}) == (
        "AMBULANCE",
        "hospital_ed",
    )
    assert classify_station({"amenity": "hospital"}) is None
    assert classify_station({"amenity": "police"}) == ("POLICE_CAR", "police")


@pytest.mark.parametrize(
    ("name", "kind"),
    [
        ("Jednostka Ratowniczo-Gaśnicza PSP nr 1 w Krakowie", "fire_state"),
        ("Ochotnicza Straż Pożarna w Tyńcu", "fire_volunteer"),
        ("OSP Wolica", "fire_volunteer"),
        ("Zakładowa Straż Pożarna ArcelorMittal Poland S.A.", "fire_other"),
        ("Hospital Wolicaosp", "fire_other"),
    ],
)
def test_fire_source_kind(name: str, kind: str) -> None:
    assert classify_station({"amenity": "fire_station", "name": name}) == ("FIRE_TRUCK", kind)


def test_name_fallbacks(tmp_path: Path) -> None:
    feats = _features(
        tmp_path,
        point(19.9, 50.0, amenity="police", operator="Policja Op"),
        point(19.91, 50.0, amenity="police"),
        point(19.92, 50.0, amenity="fire_station"),
        point(19.93, 50.0, emergency="ambulance_station"),
    )
    names = {c.name for c in extract_station_candidates(feats)}
    assert names == {
        "Policja Op",
        "Police station (unnamed)",
        "Fire station (unnamed)",
        "Ambulance station (unnamed)",
    }


def test_polygon_only_station_is_kept(tmp_path: Path) -> None:
    ring = [(19.9, 50.0), (19.91, 50.0), (19.91, 50.01), (19.9, 50.01), (19.9, 50.0)]
    feats = _features(tmp_path, polygon(ring, amenity="fire_station", name="Remiza"))
    (cand,) = extract_station_candidates(feats)
    assert not cand.is_point
    assert 19.9 < cand.lon < 19.91
    assert 50.0 < cand.lat < 50.01
    assert feature_point(feats[0]) == (cand.lon, cand.lat)


def test_osm_ref_includes_id(tmp_path: Path) -> None:
    feats = _features(tmp_path, point(19.9, 50.0, amenity="police", **{"@id": "node/7"}))
    (cand,) = extract_station_candidates(feats)
    assert cand.osm_ref == f"line:{feats[0].line_number}|osm:node/7"


def _cand(name: str, lat: float, is_point: bool, ref: str = "r") -> StationCandidate:
    return StationCandidate("FIRE_TRUCK", "fire_state", name, 19.9, lat, ref, is_point)


def test_dedupe_prefers_point_within_radius() -> None:
    # 0.00054 deg lat ~ 60 m; 0.0036 ~ 400 m; 0.00009 ~ 10 m
    kept, merged = dedupe_stations(
        [_cand("PSP 1", 50.0, False, "a"), _cand("psp 1", 50.00054, True, "b")], 150.0
    )
    assert merged == 1
    assert len(kept) == 1
    assert kept[0].is_point
    kept, merged = dedupe_stations(
        [_cand("PSP 1", 50.0, False, "a"), _cand("PSP 1", 50.0036, True, "b")], 150.0
    )
    assert (len(kept), merged) == (2, 0)
    kept, merged = dedupe_stations(
        [_cand("PSP 1", 50.0, False, "a"), _cand("PSP 2", 50.00009, True, "b")], 150.0
    )
    assert (len(kept), merged) == (2, 0)
    kept, merged = dedupe_stations(
        [
            _cand("Fire station (unnamed)", 50.0, False, "a"),
            _cand("Fire station (unnamed)", 50.00009, True, "b"),
        ],
        150.0,
    )
    assert (len(kept), merged) == (2, 0)


def test_dedupe_tie_lowest_osm_ref() -> None:
    kept, _ = dedupe_stations([_cand("A", 50.0, True, "z"), _cand("A", 50.0001, True, "b")], 150.0)
    assert [c.osm_ref for c in kept] == ["b"]


def test_police_exclusion_fragments(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    feats = _features(
        tmp_path,
        point(19.9, 50.0, amenity="police", name="Biuro Przepustek"),
        point(19.91, 50.0, amenity="police", name="Komisariat"),
    )
    monkeypatch.setattr(stations_module, "POLICE_EXCLUDED_NAME_FRAGMENTS", ("biuro",))
    excluded: list[str] = []
    names = [c.name for c in extract_station_candidates(feats, excluded=excluded)]
    assert names == ["Komisariat"]
    assert excluded == ["Biuro Przepustek"]


@pytest.mark.parametrize(
    "name",
    [
        "Straż Miejska - Oddział II Krowodrza",
        "Posterunek Straży Miejskiej Kraków - Nowa Huta (Wzgórza Krzesławickie)",
        "Straż miejska",
        "Komenda Regionalna Straży Ochrony Kolei w Krakowie",
        "Wojewódzki Inspektorat Transportu Drogowego",
        "Komisariat Wodny Policji w Krakowie",
    ],
)
def test_non_112_police_excluded_by_default(tmp_path: Path, name: str) -> None:
    feats = _features(tmp_path, point(19.9, 50.0, amenity="police", name=name))
    assert extract_station_candidates(feats) == []


@pytest.mark.parametrize(
    "name",
    ["Komenda Miejska Policji", "Komisariat Policji I w Krakowie", "Komenda Wojewódzka Policji"],
)
def test_real_police_kept_by_default(tmp_path: Path, name: str) -> None:
    feats = _features(tmp_path, point(19.9, 50.0, amenity="police", name=name))
    assert [c.name for c in extract_station_candidates(feats)] == [name]


def test_same_name_police_merge_at_any_distance() -> None:
    far = [
        StationCandidate("POLICE_CAR", "police", "Komisariat Policji I", 19.9, 50.0, "a", False),
        StationCandidate("POLICE_CAR", "police", "Komisariat Policji I", 19.9, 50.05, "b", True),
    ]
    kept, merged = dedupe_stations(far, 150.0)
    assert (len(kept), merged) == (1, 1)
    assert kept[0].osm_ref == "b"
    fire = [
        StationCandidate("FIRE_TRUCK", "fire_state", "PSP 1", 19.9, 50.0, "a", True),
        StationCandidate("FIRE_TRUCK", "fire_state", "PSP 1", 19.9, 50.05, "b", True),
    ]
    assert dedupe_stations(fire, 150.0)[1] == 0


def test_ids_stable_and_per_type() -> None:
    cands = [
        StationCandidate("FIRE_TRUCK", "fire_state", "B", 19.9, 50.1, "2", True),
        StationCandidate("FIRE_TRUCK", "fire_state", "A", 19.9, 50.0, "1", True),
        StationCandidate("AMBULANCE", "ambulance_base", "C", 19.9, 50.0, "3", True),
        StationCandidate("POLICE_CAR", "police", "D", 19.9, 50.0, "4", True),
    ]
    frame = assign_station_ids(cands)
    assert frame.columns == [
        "station_id", "vehicle_type", "source_kind", "name", "lat", "lng", "osm_ref",
    ]  # fmt: skip
    ids = dict(zip(frame["name"], frame["station_id"], strict=True))
    assert ids == {"A": "STN-F-0001", "B": "STN-F-0002", "C": "STN-A-0001", "D": "STN-P-0001"}
    shuffled = cands[:]
    random.Random(1).shuffle(shuffled)
    assert assign_station_ids(shuffled).equals(frame)
    assert json.dumps(frame.rows()) == json.dumps(assign_station_ids(cands).rows())


def test_closed_linestring_station_is_kept(tmp_path: Path) -> None:
    ring = [(19.9, 50.0), (19.902, 50.0), (19.902, 50.002), (19.9, 50.002)]
    feats = _features(tmp_path, closed_way(ring, amenity="fire_station", name="PSP Way"))
    (cand,) = extract_station_candidates(feats)
    assert (cand.name, cand.is_point) == ("PSP Way", False)


def test_station_without_usable_point_is_reported(tmp_path: Path) -> None:
    open_way = line([(19.9, 50.0), (19.901, 50.0)], amenity="fire_station", name="Open")
    feats = _features(tmp_path, open_way)
    no_point: list[str] = []
    assert extract_station_candidates(feats, no_point) == []
    assert no_point == ["Open"]


def test_encoding_twins_collapse_even_unnamed(tmp_path: Path) -> None:
    ring = [(19.9, 50.0), (19.902, 50.0), (19.902, 50.002), (19.9, 50.002)]
    tags = {"amenity": "fire_station"}
    feats = _features(tmp_path, closed_way(ring, **tags), polygon([*ring, ring[0]], **tags))
    kept, twins = collapse_encoding_twins(extract_station_candidates(feats))
    assert (len(kept), twins) == (1, 1)
    kept, merged = dedupe_stations(kept)
    assert merged == 0


def test_same_tags_far_apart_are_not_twins(tmp_path: Path) -> None:
    tags = {"amenity": "fire_station"}
    feats = _features(tmp_path, point(19.9, 50.0, **tags), point(19.9, 50.01, **tags))
    kept, twins = collapse_encoding_twins(extract_station_candidates(feats))
    assert (len(kept), twins) == (2, 0)
