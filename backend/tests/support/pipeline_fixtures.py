"""Shared builder of a tiny synthetic raw directory (OSM extract, Ulice, EMUiA, MANIFEST.json)."""

import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from greenwave.etl.manifest import (
    MANIFEST_FILENAME,
    Manifest,
    ManifestEntry,
    sha256_of_file,
    write_manifest,
)
from greenwave.etl.municipal_addresses import EMUIA_AKTUALNOSC_PATH, EMUIA_RELATIVE_PATH
from greenwave.etl.profile import OSM_RELATIVE_PATH
from tests.support.osm_fixtures import line, point, write_osm

STEP = 0.001


def at(x: float, y: float) -> tuple[float, float]:
    return round(19.9 + x * STEP, 7), round(50.0 + y * STEP, 7)


def emuia_feature(
    fid: int,
    street: str,
    number: str,
    x_m: float,
    y_m: float,
    *,
    miejscowosc: str = "Kraków",
    district: str = "Dzielnica I Stare Miasto",
) -> dict[str, Any]:
    """One EMUiA address point with the published property names (EPSG:2178 coordinates)."""
    return {
        "type": "Feature",
        "id": fid,
        "geometry": {"type": "Point", "coordinates": [x_m, y_m]},
        "properties": {
            "id": fid,
            "nazwa_ulicy": street,
            "numer_adresowy": number,
            "kod_pocztowy": "30-001",
            "miejscowosc": miejscowosc,
            "numer_dzielnicy": "1",
            "nazwa_dzielnicy": district,
            "kod_teryt": "00001",
            "data_importu": 1793034002000,
        },
    }


def write_emuia(
    raw: Path, features: Iterable[dict[str, Any]], crs: str = "EPSG:2178"
) -> tuple[Path, Path]:
    """Write ``krakow/emuia/Adresy.geojson`` and its ``__Aktualnosc__.txt``; return both paths."""
    path = raw / EMUIA_RELATIVE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    collection = {
        "type": "FeatureCollection",
        "crs": {"type": "name", "properties": {"name": crs}},
        "features": list(features),
    }
    path.write_text(json.dumps(collection, ensure_ascii=False), encoding="utf-8")
    aktualnosc = raw / EMUIA_AKTUALNOSC_PATH
    aktualnosc.write_text("Data wygenerowania plików: 2026-10-27_00:45:04", encoding="utf-8")
    return path, aktualnosc


def make_raw(
    tmp_path: Path, extra: tuple[str, ...] = (), emuia: Iterable[dict[str, Any]] = ()
) -> Path:
    raw = tmp_path / "raw"
    osm_path = raw / OSM_RELATIVE_PATH
    osm_path.parent.mkdir(parents=True)
    (raw / "krakow").mkdir()
    source = write_osm(
        tmp_path,
        line(
            [at(0, 0), at(1, 0), at(2, 0), at(3, 0), at(4, 0)],
            highway="primary",
            name="Aleja Testowa",
        ),
        line([at(2, -2), at(2, 0), at(2, 2)], highway="residential", name="Poprzeczna"),
        line(
            [at(0.5, 2), (at(0.5, 0)[0], round(at(0.5, 0)[1] + 0.6 / 111_200, 7))],
            highway="service",
        ),
        point(*at(1.5, 0), highway="traffic_signals"),
        point(*at(2.5, 0), highway="traffic_signals", **{"traffic_signals:direction": "forward"}),
        point(*at(3.5, 0), highway="crossing", crossing="traffic_signals"),
        point(*at(1, 0.3), amenity="fire_station", name="PSP Testowa"),
        point(*at(3, 0.3), emergency="ambulance_station", name="Stacja Testowa"),
        point(*at(2, 0.4), **{"addr:street": "Poprzeczna", "addr:housenumber": "7"}),
        *extra,
    )
    source.rename(osm_path)
    ulice = raw / "krakow" / "Ulice.geojson"
    ulice.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"nazwa_ulicy": "Aleja Testowa"},
                        "geometry": {"type": "LineString", "coordinates": [[0, 0], [100, 0]]},
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    buspasy = raw / "krakow" / "Buspasy_test.csv"
    buspasy.write_text(
        "OBJECTID,Kategoria,Znak,Opis,Zasady,Organizacja,Długość [m]\n"
        "1,pas autobusowy,,ul. Poprzeczna od ul. A do ul. B,,stała,200.0\n",
        encoding="utf-8-sig",
    )
    emuia_path, emuia_aktualnosc = write_emuia(raw, emuia)
    entries = [
        ManifestEntry(
            path=path.relative_to(raw).as_posix(),
            sha256=sha256_of_file(path),
            size_bytes=path.stat().st_size,
            source="test",
            url=None,
            retrieved_on="2026-10-14",
            licence=None,
            attribution=None,
        )
        for path in (osm_path, ulice, buspasy, emuia_path, emuia_aktualnosc)
    ]
    write_manifest(Manifest(entries=entries), raw / MANIFEST_FILENAME)
    return raw
