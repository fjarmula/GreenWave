"""Shared builder of a tiny synthetic raw directory (OSM extract, Ulice, MANIFEST.json)."""

import json
from pathlib import Path

from greenwave.etl.manifest import (
    MANIFEST_FILENAME,
    Manifest,
    ManifestEntry,
    sha256_of_file,
    write_manifest,
)
from greenwave.etl.profile import OSM_RELATIVE_PATH
from tests.support.osm_fixtures import line, point, write_osm

STEP = 0.001


def at(x: float, y: float) -> tuple[float, float]:
    return round(19.9 + x * STEP, 7), round(50.0 + y * STEP, 7)


def make_raw(tmp_path: Path, extra: tuple[str, ...] = ()) -> Path:
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
        for path in (osm_path, ulice, buspasy)
    ]
    write_manifest(Manifest(entries=entries), raw / MANIFEST_FILENAME)
    return raw
