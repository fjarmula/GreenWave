"""PRM bases as the ambulance stations of the ``places`` step, and the team roster in scope.

Ambulance origins are the official PRM team bases (ADR 0014): an OSM ambulance station within
``PRM_BASE_OSM_MATCH_RADIUS_M`` of a base is reported as matched (its ``osm_ref`` is kept), and
the base keeps its published address as name and its curated coordinate. OSM ambulance stations
and hospital SORs without a base are not written; they are reported as ``replaced_by_prm``.
"""

from collections.abc import Sequence

import numpy as np
import polars as pl
from pydantic import BaseModel

from greenwave.etl.config import PLACES_MAX_SNAP_DISTANCE_M, PRM_BASE_OSM_MATCH_RADIUS_M
from greenwave.etl.geo import project_points
from greenwave.etl.prm_roster import (
    ADDRESS_SHEET,
    EFFECTIVE_FROM,
    KRAKOW_REGION,
    PLAN_UPDATE,
    ROSTER_SHEET,
    PrmRosterError,
)
from greenwave.etl.stations import StationCandidate

AMBULANCE_ID_PREFIX = "STN-A-"
PRM_BASE_SOURCE_KIND = "prm_base"

RESOURCES_SCHEMA: dict[str, type[pl.DataType]] = {
    "team_code": pl.String,
    "team_id": pl.String,
    "team_type": pl.String,
    "station_id": pl.String,
    "base_address": pl.String,
    "area_teryt": pl.String,
    "weekdays": pl.String,
    "ready_from_min": pl.Int16,
    "ready_to_min": pl.Int16,
    "season_from": pl.String,
    "season_to": pl.String,
    "region": pl.String,
}


class ResourcesReport(BaseModel):
    """The roster in scope. ``outside_simulation_area``: region RO12/01 teams with no curated
    base; ``replaced_by_prm``: OSM ambulance origins no longer written, with the reason."""

    plan_update: str
    effective_from: str
    source_sheets: list[str]
    teams_in_scope: int
    bases: int
    bases_matched_to_osm: int
    match_radius_m: float
    teams_by_type: dict[str, int]
    teams_by_hours: dict[str, int]
    outside_simulation_area: list[str]
    replaced_by_prm: list[str]


def _clock(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def hours_label(ready_from_min: int, ready_to_min: int) -> str:
    """``"00:00-24:00"`` or ``"07:00-19:00"``: the readiness window as the plan writes it."""
    return f"{_clock(ready_from_min)}-{_clock(ready_to_min)}"


def _metric(lngs: Sequence[float], lats: Sequence[float]) -> np.ndarray:
    return project_points(np.array(lngs, dtype=np.float64), np.array(lats, dtype=np.float64))


def _match_osm(bases: pl.DataFrame, osm: Sequence[StationCandidate]) -> dict[str, int]:
    """Base address -> index into ``osm`` of its matched OSM ambulance station, one-to-one,
    greedily by (distance, base address, OSM ref)."""
    if bases.is_empty() or not osm:
        return {}
    base_xy = _metric(bases["lng"].to_list(), bases["lat"].to_list())
    osm_xy = _metric([c.lon for c in osm], [c.lat for c in osm])
    pairs = sorted(
        (float(np.hypot(*(base_xy[b] - osm_xy[o]))), address, osm[o].osm_ref, o)
        for b, address in enumerate(bases["base_address"].to_list())
        for o in range(len(osm))
    )
    matched: dict[str, int] = {}
    taken: set[int] = set()
    for distance, address, _, o in pairs:
        if distance > PRM_BASE_OSM_MATCH_RADIUS_M:
            break
        if address not in matched and o not in taken:
            matched[address] = o
            taken.add(o)
    return matched


def prm_stations(
    roster: pl.DataFrame,
    bases: pl.DataFrame,
    base_snap_m: Sequence[float],
    osm_ambulances: Sequence[StationCandidate],
) -> tuple[pl.DataFrame, pl.DataFrame, ResourcesReport]:
    """``(ambulance station rows, resources, report)``.

    ``bases`` is ``resolve_bases`` (sorted by address), ``base_snap_m`` each base's distance to
    the routable network, ``osm_ambulances`` the on-network OSM ambulance candidates (bases and
    hospital SORs). Raises ``PrmRosterError`` for a curated base no team uses or one off the
    network. Station ids ``STN-A-####`` follow the sorted base addresses.
    """
    team_addresses = set(roster["base_address"].to_list())
    for address, snap in zip(bases["base_address"].to_list(), base_snap_m, strict=True):
        if address not in team_addresses:
            raise PrmRosterError(f"curated base {address!r} is the base of no team in the roster")
        if snap > PLACES_MAX_SNAP_DISTANCE_M:
            raise PrmRosterError(
                f"curated base {address!r} is {snap:.0f} m from the routable network "
                f"(limit {PLACES_MAX_SNAP_DISTANCE_M:.0f} m)"
            )
    osm_bases = [c for c in osm_ambulances if c.source_kind == "ambulance_base"]
    matched = _match_osm(bases, osm_bases)
    station_rows: list[dict[str, object]] = []
    station_of: dict[str, str] = {}
    for number, (row, snap) in enumerate(
        zip(bases.iter_rows(named=True), base_snap_m, strict=True), start=1
    ):
        station_id = f"{AMBULANCE_ID_PREFIX}{number:04d}"
        station_of[row["base_address"]] = station_id
        osm = matched.get(row["base_address"])
        station_rows.append(
            {
                "station_id": station_id,
                "vehicle_type": "AMBULANCE",
                "source_kind": PRM_BASE_SOURCE_KIND,
                "name": row["base_address"],
                "lat": row["lat"],
                "lng": row["lng"],
                "osm_ref": osm_bases[osm].osm_ref if osm is not None else None,
                "snap_distance_m": float(snap),
            }
        )
    matched_refs = {osm_bases[o].osm_ref for o in matched.values()}
    replaced = sorted(
        f"{c.name} (hospital_ed: not a PRM base)"
        if c.source_kind == "hospital_ed"
        else f"{c.name} (ambulance_base: no PRM base within {PRM_BASE_OSM_MATCH_RADIUS_M:.0f} m)"
        for c in osm_ambulances
        if c.osm_ref not in matched_refs
    )

    in_scope = roster.filter(pl.col("base_address").is_in(list(station_of)))
    resources = (
        in_scope.with_columns(
            pl.col("base_address")
            .replace_strict(station_of, return_dtype=pl.String)
            .alias("station_id")
        )
        .select(list(RESOURCES_SCHEMA))
        .cast(pl.Schema(RESOURCES_SCHEMA))
        .sort("team_code")
    )
    outside = roster.filter(
        (pl.col("region") == KRAKOW_REGION) & ~pl.col("base_address").is_in(list(station_of))
    )

    def counts(labels: list[str]) -> dict[str, int]:
        return {label: labels.count(label) for label in sorted(set(labels))}

    report = ResourcesReport(
        plan_update=PLAN_UPDATE,
        effective_from=EFFECTIVE_FROM,
        source_sheets=[ROSTER_SHEET, ADDRESS_SHEET],
        teams_in_scope=resources.height,
        bases=len(station_rows),
        bases_matched_to_osm=len(matched),
        match_radius_m=PRM_BASE_OSM_MATCH_RADIUS_M,
        teams_by_type=counts(resources["team_type"].to_list()),
        teams_by_hours=counts(
            [
                hours_label(a, b)
                for a, b in resources.select("ready_from_min", "ready_to_min").iter_rows()
            ]
        ),
        outside_simulation_area=sorted(outside["team_code"].to_list()),
        replaced_by_prm=replaced,
    )
    stations = pl.DataFrame(
        station_rows,
        schema={
            "station_id": pl.Utf8, "vehicle_type": pl.Utf8, "source_kind": pl.Utf8,
            "name": pl.Utf8, "lat": pl.Float64, "lng": pl.Float64, "osm_ref": pl.Utf8,
            "snap_distance_m": pl.Float64,
        },
    )  # fmt: skip
    return stations, resources, report
