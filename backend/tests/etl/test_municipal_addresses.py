import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from greenwave.etl.addresses import address_search_key
from greenwave.etl.geo import unproject_points
from greenwave.etl.municipal_addresses import (
    EMUIA_DOWNLOAD_URL,
    MunicipalAddressError,
    emuia_export_timestamp,
    load_municipal_addresses,
)
from tests.support.pipeline_fixtures import emuia_feature, write_emuia

X0, Y0 = 7_420_000.0, 5_545_000.0


def _load(tmp_path: Path, *features: dict[str, Any], crs: str = "EPSG:2178") -> Any:
    raw = tmp_path / "raw"
    write_emuia(raw, features, crs=crs)
    return load_municipal_addresses(raw / "krakow" / "emuia" / "Adresy.geojson")


def test_loads_points_with_keys_and_wgs84(tmp_path: Path) -> None:
    street = "ks. bpa Władysława Bandurskiego"
    frame = _load(tmp_path, emuia_feature(7, street, "15 a", X0, Y0))

    row = frame.row(0, named=True)
    assert row["emuia_id"] == 7
    assert row["street"] == street
    assert row["housenumber"] == "15 a"
    assert row["search_key"] == address_search_key(street)
    assert row["number_key"] == "15A"
    assert row["district"] == "Stare Miasto"
    assert (row["x_m"], row["y_m"]) == (X0, Y0)
    lon, lat = unproject_points(np.array([[X0, Y0]]))[0]
    assert row["lng"] == pytest.approx(lon, abs=1e-9)
    assert row["lat"] == pytest.approx(lat, abs=1e-9)


def test_rows_sorted_by_emuia_id(tmp_path: Path) -> None:
    frame = _load(
        tmp_path,
        emuia_feature(9, "Długa", "1", X0, Y0),
        emuia_feature(3, "Długa", "2", X0 + 10, Y0),
    )
    assert frame["emuia_id"].to_list() == [3, 9]


def test_district_prefix_removed(tmp_path: Path) -> None:
    frame = _load(
        tmp_path, emuia_feature(1, "Długa", "1", X0, Y0, district="Dzielnica XIII Podgórze")
    )
    assert frame["district"].to_list() == ["Podgórze"]


def test_rejects_other_crs(tmp_path: Path) -> None:
    with pytest.raises(MunicipalAddressError, match="EPSG:2178"):
        _load(tmp_path, emuia_feature(1, "Długa", "1", X0, Y0), crs="EPSG:4326")


def test_rejects_non_point_geometry(tmp_path: Path) -> None:
    feature = emuia_feature(1, "Długa", "1", X0, Y0)
    feature["geometry"] = {"type": "LineString", "coordinates": [[X0, Y0], [X0 + 1, Y0]]}
    with pytest.raises(MunicipalAddressError, match="Point"):
        _load(tmp_path, feature)


def test_rejects_duplicate_id(tmp_path: Path) -> None:
    with pytest.raises(MunicipalAddressError, match="duplicate id"):
        _load(
            tmp_path,
            emuia_feature(1, "Długa", "1", X0, Y0),
            emuia_feature(1, "Długa", "2", X0, Y0),
        )


def test_rejects_empty_street(tmp_path: Path) -> None:
    with pytest.raises(MunicipalAddressError, match="nazwa_ulicy"):
        _load(tmp_path, emuia_feature(1, " ", "1", X0, Y0))


def test_rejects_blank_house_number(tmp_path: Path) -> None:
    with pytest.raises(MunicipalAddressError, match="numer_adresowy"):
        _load(tmp_path, emuia_feature(1, "Długa", "  ", X0, Y0))


def test_rejects_locality_outside_krakow(tmp_path: Path) -> None:
    with pytest.raises(MunicipalAddressError, match="Wieliczka"):
        _load(tmp_path, emuia_feature(1, "Długa", "1", X0, Y0, miejscowosc="Wieliczka"))


def test_missing_file_names_path_and_download_url(tmp_path: Path) -> None:
    path = tmp_path / "nowhere" / "Adresy.geojson"
    with pytest.raises(MunicipalAddressError) as error:
        load_municipal_addresses(path)
    assert str(path) in str(error.value)
    assert EMUIA_DOWNLOAD_URL in str(error.value)


def test_export_timestamp_read_from_aktualnosc(tmp_path: Path) -> None:
    raw = tmp_path / "raw"
    write_emuia(raw, ())
    assert emuia_export_timestamp(raw) == "2026-10-27 00:45:04"


def test_export_timestamp_none_without_file(tmp_path: Path) -> None:
    assert emuia_export_timestamp(tmp_path) is None


def test_fixture_is_valid_geojson(tmp_path: Path) -> None:
    raw = tmp_path / "raw"
    write_emuia(raw, (emuia_feature(1, "Długa", "1", X0, Y0),))
    data = json.loads((raw / "krakow" / "emuia" / "Adresy.geojson").read_text(encoding="utf-8"))
    assert data["crs"]["properties"]["name"] == "EPSG:2178"
