import json
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl
import pytest

from greenwave.etl.config import (
    ADDRESS_DEDUP_RADIUS_M,
    PLACES_MAX_SNAP_DISTANCE_M,
    STATION_DEDUP_RADIUS_M,
)
from greenwave.etl.geo import project_points
from greenwave.etl.intersections_pipeline import (
    NETWORK_EDGES_FILENAME,
    NETWORK_NODES_FILENAME,
    run_intersections,
)
from greenwave.etl.io import REPORT_FILENAME, update_report_section
from greenwave.etl.manifest import sha256_of_file
from greenwave.etl.neighbours_pipeline import StaleArtifactError
from greenwave.etl.places_pipeline import (
    ADDRESSES_FILENAME,
    RESOURCES_FILENAME,
    STATIONS_FILENAME,
    run_places,
)
from greenwave.etl.prm_roster import PrmRosterError
from greenwave.simulation_settings import SimulationSettings
from tests.support.osm_fixtures import closed_way, line, point, polygon
from tests.support.pipeline_fixtures import (
    CURATED_DIR,
    PRM_BASE_A,
    PRM_BASE_B,
    at,
    emuia_feature,
    make_raw,
)


def _prepare(
    tmp_path: Path, *extra: str, emuia: tuple[dict[str, Any], ...] = ()
) -> tuple[Path, Path]:
    raw = make_raw(tmp_path, extra, emuia)
    processed = tmp_path / "processed"
    section = run_intersections(raw, processed, tmp_path / "overrides")
    update_report_section(processed / REPORT_FILENAME, "intersections", section)
    return raw, processed


def _addr(x: float, y: float, number: str = "1") -> str:
    return point(*at(x, y), **{"addr:street": "Poprzeczna", "addr:housenumber": number})


def _metric(x: float, y: float) -> tuple[float, float]:
    lon, lat = at(x, y)
    mx, my = project_points(np.array([lon]), np.array([lat]))[0]
    return float(mx), float(my)


def _station(x: float, y: float, name: str) -> str:
    return point(*at(x, y), amenity="fire_station", name=name)


def test_places_writes_artifacts_and_section(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path, _station(1, 0.2, "PSP 1"), _addr(1, 0.3))

    section = run_places(raw, processed, CURATED_DIR)

    stations = pl.read_parquet(processed / STATIONS_FILENAME)
    assert stations["station_id"].to_list() == [
        "STN-A-0001", "STN-A-0002", "STN-F-0001", "STN-F-0002"
    ]  # fmt: skip
    assert stations["snap_distance_m"].max() < PLACES_MAX_SNAP_DISTANCE_M
    assert pl.read_parquet(processed / ADDRESSES_FILENAME).height == 2
    assert section.artifact_sha256 == {
        name: sha256_of_file(processed / name)
        for name in (STATIONS_FILENAME, ADDRESSES_FILENAME, RESOURCES_FILENAME)
    }
    recorded = json.loads((processed / REPORT_FILENAME).read_text(encoding="utf-8"))[
        "intersections"
    ]["artifact_sha256"]
    assert section.consumed_sha256 == {
        name: recorded[name] for name in (NETWORK_NODES_FILENAME, NETWORK_EDGES_FILENAME)
    }
    assert section.stations.by_vehicle_type == {"AMBULANCE": 2, "FIRE_TRUCK": 2}
    assert section.stations.by_source_kind == {"fire_state": 2, "prm_base": 2}
    assert section.addresses.rows == 2


def test_far_station_dropped_and_reported(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path, _station(1, 0.2, "Near"), _station(0, 8, "Far"))

    section = run_places(raw, processed, CURATED_DIR)

    stations = pl.read_parquet(processed / STATIONS_FILENAME)
    assert "Near" in stations["name"].to_list()
    assert "Far" not in stations["name"].to_list()
    assert stations["station_id"].to_list() == [
        "STN-A-0001", "STN-A-0002", "STN-F-0001", "STN-F-0002"
    ]  # fmt: skip
    [dropped] = section.stations.dropped
    assert (dropped.name, dropped.vehicle_type, dropped.reason) == (
        "Far",
        "FIRE_TRUCK",
        "off_network",
    )
    assert dropped.snap_distance_m > PLACES_MAX_SNAP_DISTANCE_M


def test_far_address_dropped_counted(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path, _addr(1, 0.3, "1"), _addr(0, 8, "2"))

    section = run_places(raw, processed, CURATED_DIR)

    assert section.addresses.dropped_off_network == 1
    assert section.addresses.rows == 2


def test_police_names_listed(tmp_path: Path) -> None:
    police = point(*at(1, 0.2), amenity="police", name="Komisariat I")
    raw, processed = _prepare(tmp_path, police)

    assert run_places(raw, processed, CURATED_DIR).stations.police_names == ["Komisariat I"]


def test_excluded_police_reported(tmp_path: Path) -> None:
    guard = point(*at(1, 0.2), amenity="police", name="Straż Miejska Oddział I")
    raw, processed = _prepare(tmp_path, guard, guard)  # one feature emitted twice

    section = run_places(raw, processed, CURATED_DIR)

    assert section.stations.police_names == []
    assert section.stations.excluded == ["Straż Miejska Oddział I"]


def test_address_dedup_radius_recorded(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path)

    assert run_places(raw, processed, CURATED_DIR).address_dedup_radius_m == ADDRESS_DEDUP_RADIUS_M


def test_snap_limit_matches_settings() -> None:
    assert SimulationSettings().max_snap_distance_meters == PLACES_MAX_SNAP_DISTANCE_M


def test_rerun_identical(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path, _station(1, 0.2, "PSP 1"), _addr(1, 0.3))

    first = run_places(raw, processed, CURATED_DIR)
    second = run_places(raw, processed, CURATED_DIR)

    assert first.artifact_sha256 == second.artifact_sha256


def test_refuses_when_network_differs_from_intersections_section(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path)
    nodes = processed / NETWORK_NODES_FILENAME
    nodes.write_bytes(nodes.read_bytes() + b"x")

    try:
        run_places(raw, processed, CURATED_DIR)
    except StaleArtifactError as error:
        assert "intersections" in str(error)
    else:
        raise AssertionError("expected StaleArtifactError")


def test_station_snap_distance_is_its_own(tmp_path: Path) -> None:
    # Input order differs from id order; each distance must follow its own station.
    raw, processed = _prepare(tmp_path, _station(1, 0.9, "Far-ish"), _station(1, 0.0, "On node"))

    run_places(raw, processed, CURATED_DIR)

    by_name = dict(
        pl.read_parquet(processed / STATIONS_FILENAME).select("name", "snap_distance_m").iter_rows()
    )
    nodes = pl.read_parquet(processed / NETWORK_NODES_FILENAME).select("x_m", "y_m").to_numpy()
    for name, (x, y) in (("On node", (1, 0.0)), ("Far-ish", (1, 0.9))):
        lon, lat = at(x, y)
        sx, sy = project_points(np.array([lon]), np.array([lat]))[0]
        expected = float(np.hypot(nodes[:, 0] - sx, nodes[:, 1] - sy).min())
        assert by_name[name] == pytest.approx(expected, abs=0.01)
    assert by_name["Far-ish"] > by_name["On node"]


def test_off_network_address_twin_does_not_beat_on_network_twin(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path, _addr(1, 0.3, "9"), _addr(0, 8, "9"))

    section = run_places(raw, processed, CURATED_DIR)

    addresses = pl.read_parquet(processed / ADDRESSES_FILENAME).filter(pl.col("housenumber") == "9")
    assert addresses.height == 1
    assert abs(addresses["lat"][0] - at(1, 0.3)[1]) < 1e-6
    assert section.addresses.dropped_off_network == 1
    assert section.addresses.duplicates_merged == 0


def test_address_twins_counted(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path, _addr(1, 0.3, "9"), _addr(1, 0.31, "9"))

    section = run_places(raw, processed, CURATED_DIR)

    assert section.addresses.duplicates_merged == 1
    assert section.addresses.rows == 2  # fixture address + the merged "9"


def test_station_encoding_twins_reported(tmp_path: Path) -> None:
    ring = [at(1, 0.2), at(1.2, 0.2), at(1.2, 0.4), at(1, 0.4)]
    tags = {"amenity": "fire_station"}
    raw, processed = _prepare(tmp_path, closed_way(ring, **tags), polygon([*ring, ring[0]], **tags))

    section = run_places(raw, processed, CURATED_DIR)

    assert section.stations.encoding_twins == 1
    assert section.stations.duplicates_merged == 0
    assert section.stations.by_vehicle_type["FIRE_TRUCK"] == 2  # fixture station + one twin pair


def test_parameters_recorded(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path)

    section = run_places(raw, processed, CURATED_DIR)

    assert section.snap_limit_m == PLACES_MAX_SNAP_DISTANCE_M
    assert section.station_dedup_radius_m == STATION_DEDUP_RADIUS_M


# A two-way road far from the main network: its own island component.
_ISLAND_ROAD = line([at(0, 8), at(1, 8)], highway="residential", name="Wyspa")


def test_place_near_only_an_island_is_off_network(tmp_path: Path) -> None:
    raw, processed = _prepare(
        tmp_path, _ISLAND_ROAD, _station(0.5, 8.1, "PSP Wyspa"), _addr(0.5, 8.1, "9")
    )

    section = run_places(raw, processed, CURATED_DIR)

    assert [d.name for d in section.stations.dropped] == ["PSP Wyspa"]
    assert section.stations.dropped[0].reason == "off_network"
    assert section.addresses.dropped_off_network == 1


def test_large_polygon_station_moves_to_its_access_point(tmp_path: Path) -> None:
    # Centre ~230 m north of Aleja Testowa (y=0), south edge ~22 m from it.
    campus = [at(4.1, 0.2), at(4.9, 0.2), at(4.9, 4), at(4.1, 4), at(4.1, 0.2)]
    raw, processed = _prepare(tmp_path, polygon(campus, amenity="fire_station", name="PSP Kampus"))

    section = run_places(raw, processed, CURATED_DIR)

    stations = pl.read_parquet(processed / STATIONS_FILENAME)
    kampus = stations.filter(pl.col("name") == "PSP Kampus")
    assert kampus.height == 1
    assert kampus["snap_distance_m"][0] <= PLACES_MAX_SNAP_DISTANCE_M
    assert kampus["lat"][0] == pytest.approx(at(4.1, 0.2)[1], abs=1e-6)  # on the south edge
    assert section.stations.relocated_to_outline == ["PSP Kampus"]
    assert section.stations.dropped == []


def test_places_reconciles_emuia(tmp_path: Path) -> None:
    # make_raw always has OSM "Poprzeczna 7" at at(2, 0.4).
    emuia = (emuia_feature(1, "Poprzeczna", "7", *_metric(2, 0.41)),)
    raw, processed = _prepare(tmp_path, emuia=emuia)

    section = run_places(raw, processed, CURATED_DIR)

    addresses = pl.read_parquet(processed / ADDRESSES_FILENAME)
    row = addresses.filter(pl.col("housenumber") == "7").row(0, named=True)
    assert row["provenance"] == "matched"
    assert row["emuia_id"] == 1
    assert row["osm_delta_m"] < 100
    reconciliation = section.addresses.reconciliation
    assert reconciliation.municipal_total == 1
    assert reconciliation.matched_clean == 1
    assert reconciliation.emuia_export_timestamp == "2026-10-27 00:45:04"
    assert reconciliation.thresholds_m == {"clean": 100.0, "max": 500.0, "name_variant": 50.0}
    assert reconciliation.examples.matched_clean == [
        "Poprzeczna 7: " + f"{round(row['osm_delta_m'])} m"
    ]
    assert section.addresses.rows == addresses.height


def test_off_network_emuia_dropped(tmp_path: Path) -> None:
    emuia = (emuia_feature(1, "Daleka", "1", *_metric(0, 8)),)
    raw, processed = _prepare(tmp_path, emuia=emuia)

    section = run_places(raw, processed, CURATED_DIR)

    assert section.addresses.reconciliation.municipal_dropped_off_network == 1
    assert section.addresses.reconciliation.municipal_rows == 0
    addresses = pl.read_parquet(processed / ADDRESSES_FILENAME)
    assert "Daleka 1" not in addresses["label"].to_list()


def test_dropped_osm_twin_marks_same_key_elsewhere(tmp_path: Path) -> None:
    emuia = (emuia_feature(1, "Poprzeczna", "9", *_metric(1, 0.3)),)
    raw, processed = _prepare(tmp_path, _addr(0, 8, "9"), emuia=emuia)

    section = run_places(raw, processed, CURATED_DIR)

    addresses = pl.read_parquet(processed / ADDRESSES_FILENAME)
    row = addresses.filter(pl.col("housenumber") == "9").row(0, named=True)
    assert row["provenance"] == "municipal"
    assert row["osm_same_key_elsewhere"] is True
    assert section.addresses.reconciliation.municipal_only_gap_closed == 0
    assert section.addresses.reconciliation.municipal_same_key_elsewhere == 1


def test_places_output_is_deterministic(tmp_path: Path) -> None:
    emuia = (
        emuia_feature(1, "Poprzeczna", "7", *_metric(2, 0.41)),
        emuia_feature(2, "Poprzeczna", "8", *_metric(2, 0.6)),
    )
    raw, processed = _prepare(tmp_path, emuia=emuia)

    run_places(raw, processed, CURATED_DIR)
    first = (processed / ADDRESSES_FILENAME).read_bytes()
    run_places(raw, processed, CURATED_DIR)

    assert (processed / ADDRESSES_FILENAME).read_bytes() == first


def _ambulances(processed: Path) -> list[dict[str, Any]]:
    stations = pl.read_parquet(processed / STATIONS_FILENAME)
    return stations.filter(pl.col("vehicle_type") == "AMBULANCE").to_dicts()


def _curated(tmp_path: Path, *entries: tuple[str, float, float]) -> Path:
    """A curated directory with explicit coordinates at fixture grid points."""
    curated = tmp_path / "curated"
    curated.mkdir()
    bases = [
        {"address": address, "lat": at(x, y)[1], "lng": at(x, y)[0], "source": "test"}
        for address, x, y in entries
    ]
    (curated / "prm_bases.json").write_text(json.dumps(bases), encoding="utf-8")
    return curated


def test_prm_base_matched_to_osm_ambulance_station(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path)

    section = run_places(raw, processed, CURATED_DIR)

    by_name = {row["name"]: row for row in _ambulances(processed)}
    matched = by_name[PRM_BASE_A]
    assert matched["source_kind"] == "prm_base"
    assert matched["osm_ref"] is not None and "line:" in matched["osm_ref"]
    # The published base coordinate, not the OSM station's.
    assert (matched["lng"], matched["lat"]) == at(3, -0.8)
    assert "Stacja Testowa" not in by_name
    assert section.resources.bases_matched_to_osm == 1


def test_unmatched_prm_base_is_new_station(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path)

    run_places(raw, processed, CURATED_DIR)

    [row] = [r for r in _ambulances(processed) if r["name"] == PRM_BASE_B]
    assert (row["source_kind"], row["osm_ref"]) == ("prm_base", None)
    assert row["station_id"] == "STN-A-0001"  # sorted by base address: "ul. Poprzeczna" first


def test_osm_ambulance_station_beyond_radius_replaced(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path)
    curated = _curated(tmp_path, (PRM_BASE_A, 0, -0.5), (PRM_BASE_B, 0.5, -0.5))  # 232 m

    section = run_places(raw, processed, curated)

    assert all(r["osm_ref"] is None for r in _ambulances(processed))
    assert section.resources.bases_matched_to_osm == 0
    assert any("Stacja Testowa" in entry for entry in section.resources.replaced_by_prm)


def test_hospital_sor_not_an_ambulance_origin(tmp_path: Path) -> None:
    hospital = point(*at(1, 0.3), amenity="hospital", emergency="yes", name="Szpital Testowy")
    raw, processed = _prepare(tmp_path, hospital)

    section = run_places(raw, processed, CURATED_DIR)

    assert {r["source_kind"] for r in _ambulances(processed)} == {"prm_base"}
    assert "Szpital Testowy" not in {r["name"] for r in _ambulances(processed)}
    assert any("Szpital Testowy" in entry for entry in section.resources.replaced_by_prm)


def test_team_without_curated_base_reported_outside_area(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path)

    section = run_places(raw, processed, CURATED_DIR)

    assert section.resources.outside_simulation_area == ["K01 019"]
    codes = pl.read_parquet(processed / RESOURCES_FILENAME)["team_code"].to_list()
    assert codes == ["K01 008", "K01 162", "K01 176"]


def test_resources_written_and_deterministic(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path)

    first = run_places(raw, processed, CURATED_DIR)
    first_bytes = (processed / RESOURCES_FILENAME).read_bytes()
    second = run_places(raw, processed, CURATED_DIR)

    assert (processed / RESOURCES_FILENAME).read_bytes() == first_bytes
    assert first == second
    resources = pl.read_parquet(processed / RESOURCES_FILENAME)
    station_of = {r["name"]: r["station_id"] for r in _ambulances(processed)}
    row = resources.filter(pl.col("team_code") == "K01 176").row(0, named=True)
    assert row == {
        "team_code": "K01 176",
        "team_id": row["team_id"],
        "team_type": "P3",
        "station_id": station_of[PRM_BASE_A],
        "base_address": PRM_BASE_A,
        "area_teryt": "1261049",
        "weekdays": "1234567",
        "ready_from_min": 420,
        "ready_to_min": 1140,
        "season_from": "01-01",
        "season_to": "12-31",
        "region": "RO12/01",
    }
    report = first.resources
    assert (report.plan_update, report.effective_from) == ("2", "2026-09-01")
    assert report.source_sheets == ["Tabela nr 1a", "Tabela nr 2a"]
    assert (report.teams_in_scope, report.bases) == (3, 2)
    assert report.teams_by_type == {"P2": 2, "P3": 1}
    assert report.teams_by_hours == {"00:00-24:00": 2, "07:00-19:00": 1}


def test_curated_base_without_team_raises(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path)
    curated = _curated(
        tmp_path, (PRM_BASE_A, 3, -0.8), (PRM_BASE_B, 0.5, -0.5), ("ul. Nieznana 1", 1, -0.5)
    )

    with pytest.raises(PrmRosterError, match="Nieznana"):
        run_places(raw, processed, curated)


def test_curated_base_off_network_raises(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path)
    curated = _curated(tmp_path, (PRM_BASE_A, 3, -0.8), (PRM_BASE_B, 0.5, -8))

    with pytest.raises(PrmRosterError, match="Poprzeczna 5"):
        run_places(raw, processed, curated)
