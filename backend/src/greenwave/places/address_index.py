"""Local address search over ``addresses.parquet``: no external geocoder (spec, anti-goal)."""

import math
import re
from dataclasses import dataclass

import polars as pl

from greenwave.etl.addresses import address_search_key, centre_distance_m
from greenwave.schemas import GeocodeResult, Position

# Matched on the raw last token: the street normaliser turns "15/2" into "15 2".
_HOUSE_NUMBER = re.compile(r"^\d+[a-z]?(/\d+[a-z]?)?$")
_LEADING_INT = re.compile(r"^(\d+)(.*)$")


def _natural(housenumber: str) -> tuple[float, str]:
    """``1 < 1a < 2 < 10``: (leading integer, remainder); non-numeric numbers sort last."""
    match = _LEADING_INT.match(housenumber)
    return (int(match.group(1)), match.group(2)) if match else (math.inf, housenumber)


_SortKey = tuple[int, int, bool, str, tuple[float, str], float, float, float]


@dataclass(frozen=True)
class _Address:
    street: str
    folded_number: str
    label: str  # unique, from the ETL
    outside_krakow: bool
    centre_distance_m: float
    lat: float
    lng: float


class AddressIndex:
    """Addresses grouped by street ``search_key``; queries scan the distinct keys only."""

    def __init__(self, by_key: dict[str, list[_Address]]) -> None:
        self._by_key = by_key
        self._keys = sorted(by_key)

    @classmethod
    def from_frame(cls, frame: pl.DataFrame) -> "AddressIndex":
        by_key: dict[str, list[_Address]] = {}
        for street, housenumber, key, label, outside, lat, lng in frame.select(
            "street", "housenumber", "search_key", "label", "outside_krakow", "lat", "lng"
        ).iter_rows():
            by_key.setdefault(key, []).append(
                _Address(
                    street,
                    housenumber.lower(),
                    label,
                    outside,
                    centre_distance_m(lat, lng),
                    lat,
                    lng,
                )
            )
        return cls(by_key)

    def search(self, query: str, limit: int) -> list[GeocodeResult]:
        """Street starts with the query (then contains it, if short of ``limit``).

        A trailing house-number token keeps exact matches first, then numbers starting with it.
        Order: (street tier, number tier, outside Kraków, street, natural number, distance to the
        centre, lat, lng), so Kraków addresses come before bounding-box towns.
        """
        tokens = query.split()
        number: str | None = None
        if len(tokens) > 1 and _HOUSE_NUMBER.match(tokens[-1].lower()):
            number = tokens[-1].lower()
            tokens = tokens[:-1]
        rest = address_search_key(" ".join(tokens))
        if not rest:
            return []

        ranked = self._matches([k for k in self._keys if k.startswith(rest)], 0, number)
        if len(ranked) < limit:
            contains = [k for k in self._keys if rest in k and not k.startswith(rest)]
            ranked += self._matches(contains, 1, number)
        ranked.sort(key=lambda item: item[0])
        return [
            GeocodeResult(label=a.label, position=Position(lat=a.lat, lng=a.lng))
            for _, a in ranked[:limit]
        ]

    def _matches(
        self, keys: list[str], street_tier: int, number: str | None
    ) -> list[tuple[_SortKey, _Address]]:
        found = []
        for key in keys:
            for a in self._by_key[key]:
                if number is None or a.folded_number == number:
                    number_tier = 0
                elif a.folded_number.startswith(number):
                    number_tier = 1
                else:
                    continue
                sort_key = (
                    street_tier,
                    number_tier,
                    a.outside_krakow,
                    a.street,
                    _natural(a.folded_number),
                    a.centre_distance_m,
                    a.lat,
                    a.lng,
                )
                found.append((sort_key, a))
        return found
