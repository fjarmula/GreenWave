"""Address-point extraction from OSM ``addr:*`` tags for local geocoding."""

from collections.abc import Iterable
from dataclasses import dataclass

import numpy as np
import polars as pl

from greenwave.etl.config import ADDRESS_DEDUP_RADIUS_M
from greenwave.etl.feature_points import feature_point
from greenwave.etl.geo import project_points
from greenwave.etl.ingest_osm import OsmFeature
from greenwave.etl.street_names import normalise_street_name

_SCHEMA = {
    "street": pl.Utf8,
    "housenumber": pl.Utf8,
    "search_key": pl.Utf8,
    "lat": pl.Float64,
    "lng": pl.Float64,
}


@dataclass(frozen=True)
class AddressCandidate:
    street: str
    housenumber: str
    lon: float
    lat: float


def address_search_key(street: str) -> str:
    """Lowercased, diacritics folded, ``ul.``/``al.``/``os.`` prefixes normalised."""
    return normalise_street_name(street)


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


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
        candidates.append(AddressCandidate(street, housenumber, point[0], point[1]))
    frame = pl.DataFrame(
        {
            "street": [c.street for c in candidates],
            "housenumber": [c.housenumber for c in candidates],
            "search_key": [address_search_key(c.street) for c in candidates],
            "lat": [c.lat for c in candidates],
            "lng": [c.lon for c in candidates],
        },
        schema=_SCHEMA,
    )
    return frame, skipped, no_point


def dedupe_addresses(
    frame: pl.DataFrame, radius_m: float = ADDRESS_DEDUP_RADIUS_M
) -> tuple[pl.DataFrame, int]:
    """Merge rows with the same (search_key, case-folded house number) within ``radius_m``.

    Rows are visited in (search_key, house number, lat, lng) order; a row within ``radius_m`` of an
    already kept row of its key merges into it. The same street and number farther apart (another
    locality) stay distinct. Also collapses a building emitted twice (closed way and multipolygon).
    Returns ``(frame, merged_count)``.
    """
    ordered = frame.with_columns(pl.col("housenumber").str.to_lowercase().alias("_hn")).sort(
        "search_key", "_hn", "lat", "lng"
    )
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
