"""Kraków's official address points (*Punkty adresowe (EMUiA)*, MSIP dataset 1492).

The register covers the City of Kraków only and is published in EPSG:2178, the project's metric
CRS. It is the authoritative coordinate for incident addresses; ``address_reconcile`` pairs it
with the OSM addresses.
"""

import json
import re
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl

from greenwave.etl.addresses import address_search_key, canonical_housenumber
from greenwave.etl.config import METRIC_CRS
from greenwave.etl.geo import unproject_points

EMUIA_RELATIVE_PATH = Path("krakow") / "emuia" / "Adresy.geojson"
EMUIA_AKTUALNOSC_PATH = Path("krakow") / "emuia" / "__Aktualnosc__.txt"
EMUIA_DOWNLOAD_URL = "https://msip.um.krakow.pl/Dane/Adresy_JSON.zip"

_KRAKOW = "Kraków"
_DISTRICT_PREFIX = re.compile(r"^Dzielnica\s+[IVXLC]+\s+")
_DISTRICT_NUMBER = re.compile(r"^(?:[1-9]|1[0-8])$")
_TIMESTAMP = re.compile(r"(\d{4}-\d{2}-\d{2})_(\d{2}:\d{2}:\d{2})")

_SCHEMA = {
    "emuia_id": pl.Int64,
    "street": pl.Utf8,
    "housenumber": pl.Utf8,
    "search_key": pl.Utf8,
    "number_key": pl.Utf8,
    "district": pl.Utf8,
    "district_number": pl.Int8,  # Kraków's 18 districts (dzielnice), I-XVIII as 1-18
    "x_m": pl.Float64,
    "y_m": pl.Float64,
    "lat": pl.Float64,
    "lng": pl.Float64,
}


class MunicipalAddressError(ValueError):
    """The EMUiA file is missing or does not have the published shape."""


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _row(feature: dict[str, Any], index: int) -> dict[str, Any]:
    geometry = feature.get("geometry") or {}
    if geometry.get("type") != "Point":
        raise MunicipalAddressError(f"feature {index} is not a Point: {geometry.get('type')}")
    properties = feature.get("properties") or {}
    fid = properties.get("id")
    if not isinstance(fid, int):
        raise MunicipalAddressError(f"feature {index} has no integer id")
    street = _text(properties.get("nazwa_ulicy"))
    if not street or not address_search_key(street):
        raise MunicipalAddressError(f"feature {fid} has an empty nazwa_ulicy")
    number = properties.get("numer_adresowy")
    if not _text(number):
        raise MunicipalAddressError(f"feature {fid} has an empty numer_adresowy")
    locality = _text(properties.get("miejscowosc"))
    if locality != _KRAKOW:
        raise MunicipalAddressError(f"feature {fid} is outside Kraków: miejscowosc {locality!r}")
    district_number = _text(properties.get("numer_dzielnicy"))
    if not _DISTRICT_NUMBER.match(district_number):
        raise MunicipalAddressError(
            f"feature {fid} has numer_dzielnicy {district_number!r}; expected 1-18"
        )
    x, y = geometry["coordinates"][:2]
    return {
        "emuia_id": fid,
        "street": street,
        "housenumber": str(number).strip(),
        "search_key": address_search_key(street),
        "number_key": canonical_housenumber(str(number)),
        "district": _DISTRICT_PREFIX.sub("", _text(properties.get("nazwa_dzielnicy"))),
        "district_number": int(district_number),
        "x_m": float(x),
        "y_m": float(y),
    }


def load_municipal_addresses(path: Path) -> pl.DataFrame:
    """The register as one row per address point, sorted by ``emuia_id``; raises on bad input."""
    if not path.is_file():
        raise MunicipalAddressError(
            f"{path} is missing; download {EMUIA_DOWNLOAD_URL} and unzip it into {path.parent}"
        )
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    crs = ((data.get("crs") or {}).get("properties") or {}).get("name")
    if crs != METRIC_CRS:
        raise MunicipalAddressError(f"{path} has CRS {crs!r}; expected {METRIC_CRS}")
    rows = [_row(feature, i) for i, feature in enumerate(data.get("features", []))]
    ids = [row["emuia_id"] for row in rows]
    if len(set(ids)) != len(ids):
        repeated = sorted({i for i in ids if ids.count(i) > 1})
        raise MunicipalAddressError(f"{path} has duplicate id values, e.g. {repeated[:5]}")
    rows.sort(key=lambda row: row["emuia_id"])
    xy = np.array([[row["x_m"], row["y_m"]] for row in rows], dtype=np.float64).reshape(-1, 2)
    lon_lat = unproject_points(xy)
    for row, (lon, lat) in zip(rows, lon_lat, strict=True):
        row["lng"], row["lat"] = float(lon), float(lat)
    return pl.DataFrame(rows, schema=_SCHEMA)


def emuia_export_timestamp(raw_dir: Path) -> str | None:
    """``Data wygenerowania plików: 2026-10-27_00:45:04`` -> ``2026-10-27 00:45:04``."""
    path = raw_dir / EMUIA_AKTUALNOSC_PATH
    if not path.is_file():
        return None
    match = _TIMESTAMP.search(path.read_text(encoding="utf-8-sig"))
    return f"{match.group(1)} {match.group(2)}" if match else None
