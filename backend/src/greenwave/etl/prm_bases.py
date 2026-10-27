"""Curated coordinates of PRM team bases (``data/curated/prm_bases.json``, committed).

The plan publishes base addresses surname first ("Teligi Leonida 8") where EMUiA writes
"Leonida Teligi 8", so they do not geocode as free text. Each entry names the exact Table 2a
address and either the EMUiA point of that address (Kraków) or a cited coordinate (outside
Kraków: an OSM element or a manual reading).
"""

import json
from pathlib import Path
from typing import Self

import polars as pl
from pydantic import BaseModel, ConfigDict, Field, model_validator

from greenwave.etl.prm_roster import PrmRosterError

PRM_BASES_PATH = Path("data") / "curated" / "prm_bases.json"  # relative to backend/
PRM_BASES_FILENAME = PRM_BASES_PATH.name


class BaseCoordinate(BaseModel):
    """``emuia_id`` alone, or ``lat`` + ``lng`` + ``source`` (for example ``osm:way/123``)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    address: str = Field(min_length=1)
    emuia_id: int | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    source: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def _one_coordinate_kind(self) -> Self:
        explicit = (self.lat, self.lng, self.source)
        if self.emuia_id is not None and all(v is None for v in explicit):
            return self
        if self.emuia_id is None and all(v is not None for v in explicit):
            return self
        raise ValueError(
            f"base {self.address!r} needs exactly one of emuia_id or (lat, lng, source)"
        )


def load_base_coordinates(path: Path) -> list[BaseCoordinate]:
    """Every curated entry; raises ``PrmRosterError`` on a repeated address."""
    entries = [BaseCoordinate.model_validate(e) for e in json.loads(path.read_text("utf-8"))]
    seen: set[str] = set()
    for entry in entries:
        if entry.address in seen:
            raise PrmRosterError(f"{path.name} lists base {entry.address!r} twice")
        seen.add(entry.address)
    return entries


def resolve_bases(bases: list[BaseCoordinate], addresses: pl.DataFrame) -> pl.DataFrame:
    """``base_address, lat, lng, coordinate_source`` per base, sorted by address.

    ``addresses`` is ``addresses.parquet`` (``emuia_id``, ``lat``, ``lng``); an ``emuia_id`` it
    lacks raises ``PrmRosterError``.
    """
    points = {
        emuia_id: (lat, lng)
        for emuia_id, lat, lng in addresses.select("emuia_id", "lat", "lng").iter_rows()
        if emuia_id is not None
    }
    rows: list[dict[str, object]] = []
    for base in sorted(bases, key=lambda b: b.address):
        source: str | None  # never None: the validator requires lat, lng and source together
        if base.emuia_id is not None:
            if base.emuia_id not in points:
                raise PrmRosterError(
                    f"base {base.address!r}: EMUiA id {base.emuia_id} is not in addresses.parquet"
                )
            lat, lng = points[base.emuia_id]
            source = f"emuia:{base.emuia_id}"
        else:
            lat, lng, source = base.lat, base.lng, base.source
        rows.append(
            {"base_address": base.address, "lat": lat, "lng": lng, "coordinate_source": source}
        )
    return pl.DataFrame(
        rows,
        schema={
            "base_address": pl.String,
            "lat": pl.Float64,
            "lng": pl.Float64,
            "coordinate_source": pl.String,
        },
    )
