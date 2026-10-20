import json
from pathlib import Path

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
    STATIONS_FILENAME,
    run_places,
)
from greenwave.simulation_settings import SimulationSettings
from tests.support.osm_fixtures import closed_way, line, point, polygon
from tests.support.pipeline_fixtures import at, make_raw


def _prepare(tmp_path: Path, *extra: str) -> tuple[Path, Path]:
    raw = make_raw(tmp_path, extra)
    processed = tmp_path / "processed"
    section = run_intersections(raw, processed, tmp_path / "overrides")
    update_report_section(processed / REPORT_FILENAME, "intersections", section)
    return raw, processed


def _addr(x: float, y: float, number: str = "1") -> str:
    return point(*at(x, y), **{"addr:street": "Poprzeczna", "addr:housenumber": number})


def _station(x: float, y: float, name: str) -> str:
    return point(*at(x, y), amenity="fire_station", name=name)


def test_places_writes_artifacts_and_section(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path, _station(1, 0.2, "PSP 1"), _addr(1, 0.3))

    section = run_places(raw, processed)

    stations = pl.read_parquet(processed / STATIONS_FILENAME)
    assert stations["station_id"].to_list() == ["STN-A-0001", "STN-F-0001", "STN-F-0002"]
    assert stations["snap_distance_m"].max() < PLACES_MAX_SNAP_DISTANCE_M
    assert pl.read_parquet(processed / ADDRESSES_FILENAME).height == 2
    assert section.artifact_sha256 == {
        name: sha256_of_file(processed / name) for name in (STATIONS_FILENAME, ADDRESSES_FILENAME)
    }
    recorded = json.loads((processed / REPORT_FILENAME).read_text(encoding="utf-8"))[
        "intersections"
    ]["artifact_sha256"]
    assert section.consumed_sha256 == {
        name: recorded[name] for name in (NETWORK_NODES_FILENAME, NETWORK_EDGES_FILENAME)
    }
    assert section.stations.by_vehicle_type == {"AMBULANCE": 1, "FIRE_TRUCK": 2}
    assert section.stations.by_source_kind == {"ambulance_base": 1, "fire_state": 2}
    assert section.addresses.rows == 2


def test_far_station_dropped_and_reported(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path, _station(1, 0.2, "Near"), _station(0, 8, "Far"))

    section = run_places(raw, processed)

    stations = pl.read_parquet(processed / STATIONS_FILENAME)
    assert "Near" in stations["name"].to_list()
    assert "Far" not in stations["name"].to_list()
    assert stations["station_id"].to_list() == ["STN-A-0001", "STN-F-0001", "STN-F-0002"]
    [dropped] = section.stations.dropped
    assert (dropped.name, dropped.vehicle_type, dropped.reason) == (
        "Far",
        "FIRE_TRUCK",
        "off_network",
    )
    assert dropped.snap_distance_m > PLACES_MAX_SNAP_DISTANCE_M


def test_far_address_dropped_counted(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path, _addr(1, 0.3, "1"), _addr(0, 8, "2"))

    section = run_places(raw, processed)

    assert section.addresses.dropped_off_network == 1
    assert section.addresses.rows == 2


def test_police_names_listed(tmp_path: Path) -> None:
    police = point(*at(1, 0.2), amenity="police", name="Komisariat I")
    raw, processed = _prepare(tmp_path, police)

    assert run_places(raw, processed).stations.police_names == ["Komisariat I"]


def test_excluded_police_reported(tmp_path: Path) -> None:
    guard = point(*at(1, 0.2), amenity="police", name="Straż Miejska Oddział I")
    raw, processed = _prepare(tmp_path, guard, guard)  # one feature emitted twice

    section = run_places(raw, processed)

    assert section.stations.police_names == []
    assert section.stations.excluded == ["Straż Miejska Oddział I"]


def test_address_dedup_radius_recorded(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path)

    assert run_places(raw, processed).address_dedup_radius_m == ADDRESS_DEDUP_RADIUS_M


def test_snap_limit_matches_settings() -> None:
    assert SimulationSettings().max_snap_distance_meters == PLACES_MAX_SNAP_DISTANCE_M


def test_rerun_identical(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path, _station(1, 0.2, "PSP 1"), _addr(1, 0.3))

    first = run_places(raw, processed)
    second = run_places(raw, processed)

    assert first.artifact_sha256 == second.artifact_sha256


def test_refuses_when_network_differs_from_intersections_section(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path)
    nodes = processed / NETWORK_NODES_FILENAME
    nodes.write_bytes(nodes.read_bytes() + b"x")

    try:
        run_places(raw, processed)
    except StaleArtifactError as error:
        assert "intersections" in str(error)
    else:
        raise AssertionError("expected StaleArtifactError")


def test_station_snap_distance_is_its_own(tmp_path: Path) -> None:
    # Input order differs from id order; each distance must follow its own station.
    raw, processed = _prepare(tmp_path, _station(1, 0.9, "Far-ish"), _station(1, 0.0, "On node"))

    run_places(raw, processed)

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

    section = run_places(raw, processed)

    addresses = pl.read_parquet(processed / ADDRESSES_FILENAME).filter(pl.col("housenumber") == "9")
    assert addresses.height == 1
    assert abs(addresses["lat"][0] - at(1, 0.3)[1]) < 1e-6
    assert section.addresses.dropped_off_network == 1
    assert section.addresses.duplicates_merged == 0


def test_address_twins_counted(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path, _addr(1, 0.3, "9"), _addr(1, 0.31, "9"))

    section = run_places(raw, processed)

    assert section.addresses.duplicates_merged == 1
    assert section.addresses.rows == 2  # fixture address + the merged "9"


def test_station_encoding_twins_reported(tmp_path: Path) -> None:
    ring = [at(1, 0.2), at(1.2, 0.2), at(1.2, 0.4), at(1, 0.4)]
    tags = {"amenity": "fire_station"}
    raw, processed = _prepare(tmp_path, closed_way(ring, **tags), polygon([*ring, ring[0]], **tags))

    section = run_places(raw, processed)

    assert section.stations.encoding_twins == 1
    assert section.stations.duplicates_merged == 0
    assert section.stations.by_vehicle_type["FIRE_TRUCK"] == 2  # fixture station + one twin pair


def test_parameters_recorded(tmp_path: Path) -> None:
    raw, processed = _prepare(tmp_path)

    section = run_places(raw, processed)

    assert section.snap_limit_m == PLACES_MAX_SNAP_DISTANCE_M
    assert section.station_dedup_radius_m == STATION_DEDUP_RADIUS_M


# A two-way road far from the main network: its own island component.
_ISLAND_ROAD = line([at(0, 8), at(1, 8)], highway="residential", name="Wyspa")


def test_place_near_only_an_island_is_off_network(tmp_path: Path) -> None:
    raw, processed = _prepare(
        tmp_path, _ISLAND_ROAD, _station(0.5, 8.1, "PSP Wyspa"), _addr(0.5, 8.1, "9")
    )

    section = run_places(raw, processed)

    assert [d.name for d in section.stations.dropped] == ["PSP Wyspa"]
    assert section.stations.dropped[0].reason == "off_network"
    assert section.addresses.dropped_off_network == 1


def test_large_polygon_station_moves_to_its_access_point(tmp_path: Path) -> None:
    # Centre ~230 m north of Aleja Testowa (y=0), south edge ~22 m from it.
    campus = [at(4.1, 0.2), at(4.9, 0.2), at(4.9, 4), at(4.1, 4), at(4.1, 0.2)]
    raw, processed = _prepare(tmp_path, polygon(campus, amenity="fire_station", name="PSP Kampus"))

    section = run_places(raw, processed)

    stations = pl.read_parquet(processed / STATIONS_FILENAME)
    kampus = stations.filter(pl.col("name") == "PSP Kampus")
    assert kampus.height == 1
    assert kampus["snap_distance_m"][0] <= PLACES_MAX_SNAP_DISTANCE_M
    assert kampus["lat"][0] == pytest.approx(at(4.1, 0.2)[1], abs=1e-6)  # on the south edge
    assert section.stations.relocated_to_outline == ["PSP Kampus"]
    assert section.stations.dropped == []
