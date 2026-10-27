"""Local address search over ``addresses.parquet``: no external geocoder (spec, anti-goal)."""

import re
from dataclasses import dataclass

import polars as pl

from greenwave.etl.addresses import address_search_key, centre_distance_m, natural_housenumber
from greenwave.etl.config import ADDRESS_MATCH_CLEAN_M
from greenwave.schemas import AddressProvenance, GeocodeResult, Position

# Matched on the raw last token: the street normaliser turns "15/2" into "15 2".
_HOUSE_NUMBER = re.compile(r"^\d+[a-z]?(/\d+[a-z]?)?$")

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
    provenance: AddressProvenance
    osm_delta_m: float | None
    osm_lat: float | None
    osm_lng: float | None
    osm_same_key_elsewhere: bool

    def result(self) -> GeocodeResult:
        disagreement = (
            self.osm_delta_m
            if self.osm_delta_m is not None and self.osm_delta_m > ADDRESS_MATCH_CLEAN_M
            else None
        )
        osm_position = (
            Position(lat=self.osm_lat, lng=self.osm_lng)
            if disagreement is not None and self.osm_lat is not None and self.osm_lng is not None
            else None
        )
        return GeocodeResult(
            label=self.label,
            position=Position(lat=self.lat, lng=self.lng),
            provenance=self.provenance,
            osm_delta_m=self.osm_delta_m,
            disagreement_m=disagreement,
            osm_position=osm_position,
            osm_same_key_elsewhere=self.osm_same_key_elsewhere,
        )


class AddressIndex:
    """Addresses grouped by street ``search_key``; queries scan the distinct keys only."""

    def __init__(self, by_key: dict[str, list[_Address]]) -> None:
        self._by_key = by_key
        self._keys = sorted(by_key)

    @classmethod
    def from_frame(cls, frame: pl.DataFrame) -> "AddressIndex":
        """A name-variant match is indexed under its EMUiA and its OSM street key."""
        by_key: dict[str, list[_Address]] = {}
        for row in frame.iter_rows(named=True):
            address = _Address(
                row["street"],
                row["housenumber"].lower(),
                row["label"],
                row["outside_krakow"],
                centre_distance_m(row["lat"], row["lng"]),
                row["lat"],
                row["lng"],
                AddressProvenance(row["provenance"]),
                row["osm_delta_m"],
                row["osm_lat"],
                row["osm_lng"],
                row["osm_same_key_elsewhere"],
            )
            by_key.setdefault(row["search_key"], []).append(address)
            if row["alt_search_key"] and row["alt_search_key"] != row["search_key"]:
                by_key.setdefault(row["alt_search_key"], []).append(address)
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
        # A record under two street keys can match twice; its best-ranked hit is kept.
        unique: dict[str, _Address] = {}
        for _, a in ranked:
            unique.setdefault(a.label, a)
        return [a.result() for a in list(unique.values())[:limit]]

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
                    natural_housenumber(a.folded_number),
                    a.centre_distance_m,
                    a.lat,
                    a.lng,
                )
                found.append((sort_key, a))
        return found
