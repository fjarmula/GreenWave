"""Address-point extraction from OSM ``addr:*`` tags for local geocoding."""

import math
import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass

import numpy as np
import polars as pl

from greenwave.etl.config import ADDRESS_DEDUP_RADIUS_M, KRAKOW_CENTRE_LAT_LNG
from greenwave.etl.feature_points import feature_point
from greenwave.etl.geo import project_points
from greenwave.etl.ingest_osm import OsmFeature
from greenwave.etl.street_names import normalise_street_name

_SCHEMA = {
    "street": pl.Utf8,
    "housenumber": pl.Utf8,
    "search_key": pl.Utf8,
    "locality": pl.Utf8,
    "outside_krakow": pl.Boolean,
    "lat": pl.Float64,
    "lng": pl.Float64,
}


@dataclass(frozen=True)
class AddressCandidate:
    street: str
    housenumber: str
    locality: str  # addr:suburb, else addr:quarter, addr:place, addr:city; "" when none
    outside_krakow: bool
    lon: float
    lat: float


def address_search_key(street: str) -> str:
    """Lowercased, diacritics folded, ``ul.``/``al.``/``os.`` prefixes normalised."""
    return normalise_street_name(street)


_WHITESPACE = re.compile(r"\s+")
_LEADING_INT = re.compile(r"^(\d+)(.*)$")


def canonical_housenumber(number: str) -> str:
    """Whitespace removed and letters upper-cased, so ``15 a``, ``15a`` and ``15A`` are one key."""
    return _WHITESPACE.sub("", number).upper()


def natural_housenumber(housenumber: str) -> tuple[float, str]:
    """``1 < 1a < 2 < 10``: (leading integer, remainder); non-numeric numbers sort last."""
    match = _LEADING_INT.match(housenumber)
    return (int(match.group(1)), match.group(2)) if match else (math.inf, housenumber)


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


_LOCALITY_KEYS = ("addr:suburb", "addr:quarter", "addr:place", "addr:city")
_KRAKOW = address_search_key("Kraków")


def _locality(properties: dict[str, object]) -> str:
    """Suburb, quarter, place, then city; never "Kraków" itself, which disambiguates nothing in
    a Kraków app (and would imply the unsuffixed twin is elsewhere)."""
    for key in _LOCALITY_KEYS:
        value = _text(properties.get(key))
        if value and not (key == "addr:city" and address_search_key(value) == _KRAKOW):
            return value
    return ""


def _outside_krakow(properties: dict[str, object]) -> bool:
    """Explicitly elsewhere: another ``addr:city``, or a village ``addr:place`` with no city.

    Kraków estates carry ``addr:place`` with ``addr:city=Kraków``; untagged rows count as inside.
    """
    city = _text(properties.get("addr:city"))
    if city:
        return address_search_key(city) != _KRAKOW
    return bool(_text(properties.get("addr:place")))


def centre_distance_m(lat: float, lng: float) -> float:
    """Equirectangular distance to ``KRAKOW_CENTRE_LAT_LNG``; ample for ordering within a city."""
    centre_lat, centre_lng = KRAKOW_CENTRE_LAT_LNG
    dx = (lng - centre_lng) * 111_320.0 * math.cos(math.radians(centre_lat))
    dy = (lat - centre_lat) * 110_540.0
    return math.hypot(dx, dy)


def extract_addresses(features: Iterable[OsmFeature]) -> tuple[pl.DataFrame, int, int]:
    """Return ``(addresses, skipped_missing_tags, no_usable_point)``, not yet de-duplicated.

    ``skipped_missing_tags``: some ``addr:*`` tag but no street/place, no house number or an empty
    search key. ``no_usable_point``: complete tags but no point (e.g. an open line). Features with
    no ``addr:*`` tag are not addresses.
    """
    candidates: list[AddressCandidate] = []
    skipped = 0
    no_point = 0
    for feature in features:
        properties = feature.properties
        if not any(key.startswith("addr:") for key in properties):
            continue
        street = _text(properties.get("addr:street")) or _text(properties.get("addr:place"))
        housenumber = _text(properties.get("addr:housenumber"))
        if not (street and housenumber and address_search_key(street)):
            skipped += 1
            continue
        point = feature_point(feature)
        if point is None:
            no_point += 1
            continue
        candidates.append(
            AddressCandidate(
                street,
                housenumber,
                _locality(properties),
                _outside_krakow(properties),
                point[0],
                point[1],
            )
        )
    frame = pl.DataFrame(
        {
            "street": [c.street for c in candidates],
            "housenumber": [c.housenumber for c in candidates],
            "search_key": [address_search_key(c.street) for c in candidates],
            "locality": [c.locality for c in candidates],
            "outside_krakow": [c.outside_krakow for c in candidates],
            "lat": [c.lat for c in candidates],
            "lng": [c.lon for c in candidates],
        },
        schema=_SCHEMA,
    )
    return frame, skipped, no_point


def dedupe_addresses(
    frame: pl.DataFrame, radius_m: float = ADDRESS_DEDUP_RADIUS_M
) -> tuple[pl.DataFrame, int]:
    """Merge rows with the same (search_key, canonical house number) within ``radius_m``.

    Rows are visited in (search_key, house number, lat, lng) order; a row within ``radius_m`` of an
    already kept row of its key merges into it. The same street and number farther apart (another
    locality) stay distinct. Also collapses a building emitted twice (closed way and multipolygon).
    Returns ``(frame, merged_count)``.
    """
    ordered = frame.with_columns(
        # canonical_housenumber as an expression: whitespace removed, upper-cased.
        pl.col("housenumber").str.replace_all(r"\s+", "").str.to_uppercase().alias("_hn")
    ).sort("search_key", "_hn", "lat", "lng")
    keys = list(zip(ordered["search_key"].to_list(), ordered["_hn"].to_list(), strict=True))
    keep = np.ones(len(keys), dtype=bool)
    if keys:
        xy = project_points(ordered["lng"].to_numpy(), ordered["lat"].to_numpy())
        start = 0
        while start < len(keys):
            end = start + 1
            while end < len(keys) and keys[end] == keys[start]:
                end += 1
            kept = [start]
            for i in range(start + 1, end):
                if any(float(np.hypot(*(xy[i] - xy[j]))) <= radius_m for j in kept):
                    keep[i] = False
                else:
                    kept.append(i)
            start = end
    deduped = ordered.filter(pl.Series(keep)).drop("_hn")
    return deduped, frame.height - deduped.height


def assign_labels(frame: pl.DataFrame) -> pl.DataFrame:
    """Add a unique ``label``: "Street 15", plus " (locality)" when needed.

    The locality is appended when the address is outside Kraków, or when another row has the same
    street and house number; never when it merely repeats the street (a village ``addr:place``).
    Labels still equal after that are numbered " (2)", " (3)" outward from the centre, so
    autocomplete never shows two identical strings.
    """
    rows = frame.select("street", "housenumber", "locality", "outside_krakow", "lat", "lng").rows()
    bases = [f"{street} {number}" for street, number, *_ in rows]
    repeated = Counter(bases)
    labels = []
    for base, (street, _, locality, outside, _, _) in zip(bases, rows, strict=True):
        named = locality and address_search_key(locality) != address_search_key(street)
        needs = outside or repeated[base] > 1
        labels.append(f"{base} ({locality})" if named and needs else base)

    order = sorted(
        range(len(rows)),
        key=lambda i: (
            rows[i][3],
            centre_distance_m(rows[i][4], rows[i][5]),
            rows[i][4],
            rows[i][5],
        ),
    )
    used: set[str] = set()
    for i in order:
        label, n = labels[i], 1
        while label in used:
            n += 1
            label = f"{labels[i]} ({n})"
        labels[i] = label
        used.add(label)
    return frame.with_columns(pl.Series("label", labels, dtype=pl.Utf8))
