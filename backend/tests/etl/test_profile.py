import json
from pathlib import Path

import pytest
import shapely

from greenwave.etl.config import EMERGENCY_ACCESS_VALUES
from greenwave.etl.manifest import (
    MANIFEST_FILENAME,
    InputIntegrityError,
    Manifest,
    ManifestEntry,
    sha256_of_file,
    verify_raw_inputs,
    write_manifest,
)
from greenwave.etl.profile_osm import is_access_way, scan_osm
from greenwave.etl.profile_roads import analyse_roads, tag_present
from greenwave.etl.profile_signals import analyse_signals
from tests.support.osm_fixtures import line, point, write_osm

# Roughly 111.2 m per 0.001 degree of latitude at Krakow's latitude.
METERS_PER_MILLI_DEGREE_LAT = 111.2


def _compact(feature: dict[str, object]) -> str:
    # The real extract is compact JSON, one feature per line; the reader relies on that.
    return json.dumps(feature, separators=(",", ":"))


def _point(lon: float, lat: float, **tags: str) -> str:
    return _compact(
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": tags,
        }
    )


def _line(coords: list[tuple[float, float]], **tags: str) -> str:
    return _compact(
        {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": [list(c) for c in coords]},
            "properties": tags,
        }
    )


def _polygon(ring: list[tuple[float, float]], **tags: str) -> str:
    return _compact(
        {
            "type": "Feature",
            "geometry": {"type": "MultiPolygon", "coordinates": [[[list(c) for c in ring]]]},
            "properties": tags,
        }
    )


def _write_osm(tmp_path: Path, *lines: str) -> Path:
    path = tmp_path / "osm.geojson"
    body = ",\n".join(lines)
    path.write_text(
        '{"type":"FeatureCollection","features":[\n' + body + "\n]}\n", encoding="utf-8"
    )
    return path


# --- tag coverage rules ---------------------------------------------------------------------


def test_tag_present_matches_suffixed_keys_only_for_non_exact_tags() -> None:
    assert tag_present({"lanes:forward": "2"}, "lanes")
    assert tag_present({"bus:lanes:backward": "yes|designated"}, "bus:lanes")
    assert tag_present({"maxspeed:forward": "50"}, "maxspeed")
    assert not tag_present({"name:pl": "Rynek"}, "name")
    assert not tag_present({"oneway:bicycle": "no"}, "oneway")
    assert tag_present({"name": "Rynek"}, "name")


# --- scan_osm ---------------------------------------------------------------------------------


def test_scan_counts_types_and_reports_invalid_geometry(tmp_path: Path) -> None:
    bowtie = [(19.0, 50.0), (19.1, 50.1), (19.1, 50.0), (19.0, 50.1), (19.0, 50.0)]
    path = _write_osm(
        tmp_path,
        _point(19.9, 50.0, amenity="cafe"),
        _line([(19.9, 50.0), (19.901, 50.0)], highway="residential"),
        _polygon(bowtie, building="yes"),
        _point(200.0, 50.0),
    )

    scan = scan_osm(path)

    assert dict(scan.features_by_geometry_type) == {"Point": 2, "LineString": 1, "MultiPolygon": 1}
    assert scan.invalid_count == 2
    assert "point with non-numeric or out-of-range coordinates" in scan.invalid_by_reason
    assert any("Self-intersection" in reason for reason in scan.invalid_by_reason)
    assert {sample.line_number for sample in scan.invalid_samples} == {4, 5}
    assert len(scan.drivable_ways) == 1


def test_scan_drivable_filter_uses_class_and_access(tmp_path: Path) -> None:
    coords = [(19.9, 50.0), (19.901, 50.0)]
    path = _write_osm(
        tmp_path,
        _line(coords, highway="primary"),
        _line(coords, highway="service", access="private"),
        _line(coords, highway="footway"),
        _line(coords, highway="service", access="destination"),
    )

    scan = scan_osm(path)

    assert [w.highway for w in scan.drivable_ways] == ["primary", "service"]
    assert scan.drivable_excluded_by_access == 1
    assert scan.linestrings_with_highway == 4


def test_scan_separates_signal_nodes_from_signalised_crossings(tmp_path: Path) -> None:
    path = _write_osm(
        tmp_path,
        _point(19.9, 50.0, highway="traffic_signals"),
        _point(19.9, 50.001, highway="crossing", crossing="traffic_signals"),
        _point(19.9, 50.002, railway="tram_crossing", crossing="traffic_signals"),
        _point(19.9, 50.003, highway="crossing", crossing="uncontrolled"),
        _point(19.9, 50.004, highway="traffic_signals", crossing="traffic_signals"),
    )

    scan = scan_osm(path)

    assert len(scan.signal_nodes) == 2
    assert len(scan.signalised_crossings) == 2
    assert scan.signal_nodes_also_tagged_crossing == 1


# --- roads: units, coverage by length, signal position ---------------------------------------


def test_road_length_is_in_meters_and_coverage_is_weighted_by_length(tmp_path: Path) -> None:
    short = [(19.9, 50.0), (19.9, 50.001)]  # ~111 m
    long = [(19.91, 50.0), (19.91, 50.003)]  # ~334 m
    path = _write_osm(
        tmp_path,
        _line(short, highway="residential", maxspeed="30"),
        _line(long, highway="residential"),
    )

    roads = analyse_roads(scan_osm(path))

    assert roads.lengths_m[0] == pytest.approx(METERS_PER_MILLI_DEGREE_LAT, rel=0.01)
    assert roads.lengths_m[1] == pytest.approx(3 * METERS_PER_MILLI_DEGREE_LAT, rel=0.01)
    coverage = roads.overall.tag_coverage["maxspeed"]
    assert coverage.share_of_ways == pytest.approx(0.5)
    assert coverage.share_of_length == pytest.approx(0.25, abs=0.01)


def test_signal_vertex_positions_and_probe_not_found(tmp_path: Path) -> None:
    junction = (19.9, 50.0)
    path = _write_osm(
        tmp_path,
        _line([(19.89, 50.0), junction], highway="residential"),
        _line([junction, (19.91, 50.0), (19.92, 50.0)], highway="residential"),
        _point(*junction, highway="traffic_signals"),  # shared by two ways
        _point(19.91, 50.0, highway="traffic_signals", traffic_signals="blinker"),  # interior
        _point(19.89, 50.0, highway="traffic_signals"),  # first vertex of one way
        _point(19.95, 50.1, highway="traffic_signals"),  # not on any road
    )
    scan = scan_osm(path)
    roads = analyse_roads(scan)
    outline = shapely.box(-1e9, -1e9, 1e9, 1e9)

    signals = analyse_signals(scan, roads, outline)

    assert signals.vertex_position == {
        "junction": 1,
        "interior": 1,
        "way_endpoint": 1,
        "off_network": 1,
    }
    assert signals.on_drivable_vertex == 3
    assert signals.off_network_nearest_way.count == 1
    assert signals.tag_variants == {"<absent>": 3, "blinker": 1}
    assert signals.clustering_excluding_non_blocking[0].nodes == 3
    assert [probe.found for probe in signals.probes] == [False, False]


# --- input integrity ---------------------------------------------------------------------------


def test_verify_inputs_rejects_files_that_differ_from_the_manifest(tmp_path: Path) -> None:
    data_file = tmp_path / "a.txt"
    data_file.write_text("original")
    entry = ManifestEntry(
        path="a.txt",
        sha256=sha256_of_file(data_file),
        size_bytes=data_file.stat().st_size,
        source="test",
        url=None,
        retrieved_on="2026-10-13",
        licence=None,
        attribution=None,
    )
    write_manifest(Manifest(entries=[entry]), tmp_path / MANIFEST_FILENAME)

    assert verify_raw_inputs(tmp_path) == {"a.txt": entry.sha256}

    data_file.write_text("tampered")
    with pytest.raises(InputIntegrityError, match=r"a\.txt"):
        verify_raw_inputs(tmp_path)


def test_scan_collects_traffic_calming_points(tmp_path: Path) -> None:
    path = write_osm(
        tmp_path,
        point(19.90, 50.05, traffic_calming="bump"),
        point(19.91, 50.05, traffic_calming="table"),
        point(19.92, 50.05, traffic_calming="no"),
    )
    scan = scan_osm(path)
    assert [p.properties["traffic_calming"] for p in scan.calming_points] == ["bump", "table"]


def test_scan_collects_tram_lines(tmp_path: Path) -> None:
    path = write_osm(
        tmp_path,
        line([(19.90, 50.05), (19.91, 50.05)], railway="tram"),
        line([(19.90, 50.06), (19.91, 50.06)], railway="rail"),
    )
    scan = scan_osm(path)
    assert scan.tram_lines == [[(19.90, 50.05), (19.91, 50.05)]]


# --- Access ways: tracks and emergency-tagged ways routable for emergency vehicles ----------

_A = [(19.90, 50.05), (19.901, 50.05)]


def test_scan_collects_access_ways_separately(tmp_path: Path) -> None:
    path = write_osm(
        tmp_path,
        line(_A, highway="track"),
        line(_A, highway="track", tracktype="grade5"),
        line(_A, highway="track", access="private"),
        line(_A, highway="pedestrian", emergency="designated"),
        line(_A, highway="footway", emergency="yes"),
        line(_A, highway="residential", emergency="yes"),
        line(_A, highway="primary"),
    )
    scan = scan_osm(path)
    assert [w.highway for w in scan.access_ways] == ["track", "pedestrian"]
    assert [w.highway for w in scan.drivable_ways] == ["residential", "primary"]


def test_emergency_override_keeps_the_profile_count(tmp_path: Path) -> None:
    scan = scan_osm(write_osm(tmp_path, line(_A, highway="service", access="no", emergency="yes")))
    assert scan.drivable_excluded_by_access == 1
    assert len(scan.access_ways) == 1
    assert scan.drivable_ways == []


def test_motor_vehicle_is_not_consulted(tmp_path: Path) -> None:
    scan = scan_osm(
        write_osm(tmp_path, line(_A, highway="track", motor_vehicle="no", tracktype="grade2"))
    )
    assert [w.highway for w in scan.access_ways] == ["track"]


@pytest.mark.parametrize(
    ("tracktype", "expected"),
    [
        (None, True),
        ("grade1", True),
        ("grade2", True),
        ("grade3", True),
        ("grade4", False),
        ("grade5", False),
    ],
)
def test_is_access_way_track_grades(tracktype: str | None, expected: bool) -> None:
    properties: dict[str, object] = {} if tracktype is None else {"tracktype": tracktype}
    assert is_access_way("track", properties) is expected


@pytest.mark.parametrize("access", ["private", "no"])
def test_is_access_way_rejects_closed_tracks(access: str) -> None:
    assert is_access_way("track", {"access": access}) is False


@pytest.mark.parametrize("emergency", sorted(EMERGENCY_ACCESS_VALUES))
@pytest.mark.parametrize("highway", ["service", "pedestrian", "track", "residential"])
def test_is_access_way_emergency_values(emergency: str, highway: str) -> None:
    properties: dict[str, object] = {"emergency": emergency, "access": "no"}
    if highway == "track":
        properties["tracktype"] = "grade5"
    assert is_access_way(highway, properties) is True


@pytest.mark.parametrize("emergency", ["no", "destination", None])
def test_is_access_way_ignores_other_emergency_values(emergency: str | None) -> None:
    properties: dict[str, object] = {"access": "no"}
    if emergency is not None:
        properties["emergency"] = emergency
    assert is_access_way("pedestrian", properties) is False


@pytest.mark.parametrize("highway", ["footway", "path", "steps", "cycleway"])
def test_is_access_way_never_opens_footways(highway: str) -> None:
    assert is_access_way(highway, {"emergency": "yes"}) is False
