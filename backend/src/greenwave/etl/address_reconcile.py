"""Pair Kraków's EMUiA address points with OSM addresses and record each record's provenance.

Pass 1 matches the same (street key, canonical house number) within ``ADDRESS_MATCH_MAX_M``,
never to an OSM address explicitly outside Kraków. Pass 2 pairs what is left by house number
alone within ``ADDRESS_NAME_VARIANT_RADIUS_M`` when the street names share tokens (or within
``ADDRESS_NAME_VARIANT_TIGHT_M`` at any names): one address under two street-name forms. Both
passes assign greedily by (distance, emuia_id, OSM row), so the result is deterministic.

A matched or municipal record takes EMUiA's name and coordinate. An address point is a geocoding
result, not a vehicle access point.
"""

from collections import Counter, defaultdict
from collections.abc import Iterable
from typing import Any

import numpy as np
import polars as pl
import shapely
from pydantic import BaseModel

from greenwave.etl.addresses import canonical_housenumber, natural_housenumber
from greenwave.etl.config import (
    ADDRESS_MATCH_CLEAN_M,
    ADDRESS_MATCH_MAX_M,
    ADDRESS_NAME_VARIANT_RADIUS_M,
    ADDRESS_NAME_VARIANT_TIGHT_M,
)
from greenwave.etl.geo import project_points

PROVENANCE_MATCHED = "matched"
PROVENANCE_MUNICIPAL = "municipal"
PROVENANCE_OSM = "osm"
PROVENANCES = (PROVENANCE_MATCHED, PROVENANCE_MUNICIPAL, PROVENANCE_OSM)
MATCH_EXACT_KEY = "exact_key"
MATCH_NAME_VARIANT = "name_variant"
MAX_EXAMPLES = 5

RECONCILED_SCHEMA = {
    "street": pl.Utf8,
    "housenumber": pl.Utf8,
    "search_key": pl.Utf8,
    "locality": pl.Utf8,
    "outside_krakow": pl.Boolean,
    "lat": pl.Float64,
    "lng": pl.Float64,
    "provenance": pl.Utf8,
    "alt_search_key": pl.Utf8,
    "emuia_id": pl.Int64,
    "osm_lat": pl.Float64,
    "osm_lng": pl.Float64,
    "osm_delta_m": pl.Float64,
    "match_basis": pl.Utf8,
    "osm_same_key_elsewhere": pl.Boolean,
}


class ReconciliationCounts(BaseModel):
    """``matched_clean`` includes ``matched_name_variant``; gaps exclude same-key-elsewhere."""

    municipal_rows: int
    matched_clean: int
    matched_disagreement: int
    matched_name_variant: int
    municipal_only_gap_closed: int
    municipal_same_key_elsewhere: int
    osm_only_fallback: int
    osm_only_outside_krakow: int
    same_key_beyond_limit: int


class ReconciliationExamples(BaseModel):
    matched_clean: list[str]
    matched_disagreement: list[str]
    municipal_only_gap_closed: list[str]


def token_compatible(a: str, b: str) -> bool:
    """Every token of the shorter key is in the longer one, or both end in the same token."""
    ta, tb = a.split(), b.split()
    if not ta or not tb:
        return False
    shorter, longer = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    return set(shorter) <= set(longer) or ta[-1] == tb[-1]


def _greedy(
    pairs: Iterable[tuple[float, int, int]], taken_m: set[int], taken_o: set[int]
) -> dict[int, tuple[int, float]]:
    """Assign (distance, emuia row, osm row) pairs one-to-one, nearest first."""
    assigned: dict[int, tuple[int, float]] = {}
    for d, m, o in sorted(pairs):
        if m in taken_m or o in taken_o:
            continue
        taken_m.add(m)
        taken_o.add(o)
        assigned[m] = (o, d)
    return assigned


def reconcile_addresses(
    municipal: pl.DataFrame,
    osm: pl.DataFrame,
    osm_extracted_keys: frozenset[tuple[str, str]],
) -> tuple[pl.DataFrame, ReconciliationCounts]:
    """One row per address: matched and municipal by ``emuia_id``, then OSM-only in input order.

    ``osm_extracted_keys``: (search_key, canonical number) of every extracted OSM address inside
    Kraków, before any filter; a municipal record with such a key is not a gap OSM lacks.
    """
    municipal = municipal.sort("emuia_id")
    m_xy = municipal.select("x_m", "y_m").to_numpy().astype(np.float64).reshape(-1, 2)
    o_xy = project_points(osm["lng"].to_numpy(), osm["lat"].to_numpy())
    m_keys = list(zip(municipal["search_key"], municipal["number_key"], strict=True))
    o_numbers = [canonical_housenumber(h) for h in osm["housenumber"]]
    o_keys = list(zip(osm["search_key"], o_numbers, strict=True))
    o_inside = [not outside for outside in osm["outside_krakow"]]

    def distance(m: int, o: int) -> float:
        return float(np.hypot(*(m_xy[m] - o_xy[o])))

    by_key: dict[tuple[str, str], list[int]] = defaultdict(list)
    for o, key in enumerate(o_keys):
        if o_inside[o]:
            by_key[key].append(o)

    taken_m: set[int] = set()
    taken_o: set[int] = set()
    same_key = [
        [(distance(m, o), m, o) for o in by_key.get(key, [])] for m, key in enumerate(m_keys)
    ]
    exact = _greedy(
        (p for pairs in same_key for p in pairs if p[0] <= ADDRESS_MATCH_MAX_M), taken_m, taken_o
    )

    variant_pairs: list[tuple[float, int, int]] = []
    free_o = [o for o in range(osm.height) if o_inside[o] and o not in taken_o]
    if free_o and len(taken_m) < municipal.height:
        tree = shapely.STRtree(shapely.points(o_xy[free_o]))
        for m in range(municipal.height):
            if m in taken_m:
                continue
            near = tree.query(
                shapely.points(m_xy[m]), predicate="dwithin", distance=ADDRESS_NAME_VARIANT_RADIUS_M
            )
            for i in near:
                o = free_o[int(i)]
                d = distance(m, o)
                same_number = o_numbers[o] == m_keys[m][1]
                close = d <= ADDRESS_NAME_VARIANT_TIGHT_M
                if same_number and (close or token_compatible(m_keys[m][0], o_keys[o][0])):
                    variant_pairs.append((d, m, o))
    variant = _greedy(variant_pairs, taken_m, taken_o)

    known_keys = osm_extracted_keys | {
        k for k, inside in zip(o_keys, o_inside, strict=True) if inside
    }
    m_rows = municipal.to_dicts()
    o_rows = osm.to_dicts()
    records: list[dict[str, Any]] = []
    beyond = 0
    for m, row in enumerate(m_rows):
        record: dict[str, Any] = {
            "street": row["street"],
            "housenumber": row["housenumber"],
            "search_key": row["search_key"],
            "locality": row["district"],
            "outside_krakow": False,
            "lat": row["lat"],
            "lng": row["lng"],
            "emuia_id": row["emuia_id"],
            "alt_search_key": None,
            "osm_lat": None,
            "osm_lng": None,
            "osm_delta_m": None,
            "match_basis": None,
            "osm_same_key_elsewhere": False,
        }
        pair = exact.get(m) or variant.get(m)
        if pair is not None:
            o, d = pair
            other_key = o_rows[o]["search_key"]
            record |= {
                "provenance": PROVENANCE_MATCHED,
                "alt_search_key": other_key if other_key != row["search_key"] else None,
                "osm_lat": o_rows[o]["lat"],
                "osm_lng": o_rows[o]["lng"],
                "osm_delta_m": d,
                "match_basis": MATCH_EXACT_KEY if m in exact else MATCH_NAME_VARIANT,
            }
        else:
            beyond += any(d > ADDRESS_MATCH_MAX_M for d, _, _ in same_key[m])
            record |= {
                "provenance": PROVENANCE_MUNICIPAL,
                "osm_same_key_elsewhere": m_keys[m] in known_keys,
            }
        records.append(record)
    for o, row in enumerate(o_rows):
        if o in taken_o:
            continue
        records.append(
            {
                **{k: row[k] for k in ("street", "housenumber", "search_key", "locality")},
                "outside_krakow": row["outside_krakow"],
                "lat": row["lat"],
                "lng": row["lng"],
                "provenance": PROVENANCE_OSM,
                "alt_search_key": None,
                "emuia_id": None,
                "osm_lat": None,
                "osm_lng": None,
                "osm_delta_m": None,
                "match_basis": None,
                "osm_same_key_elsewhere": False,
            }
        )
    frame = pl.DataFrame(records, schema=RECONCILED_SCHEMA)

    matched = [r for r in records if r["provenance"] == PROVENANCE_MATCHED]
    municipal_only = [r for r in records if r["provenance"] == PROVENANCE_MUNICIPAL]
    osm_only = [r for r in records if r["provenance"] == PROVENANCE_OSM]
    elsewhere = sum(bool(r["osm_same_key_elsewhere"]) for r in municipal_only)
    disagreements = sum(float(r["osm_delta_m"]) > ADDRESS_MATCH_CLEAN_M for r in matched)
    counts = ReconciliationCounts(
        municipal_rows=municipal.height,
        matched_clean=len(matched) - disagreements,
        matched_disagreement=disagreements,
        matched_name_variant=len(variant),
        municipal_only_gap_closed=len(municipal_only) - elsewhere,
        municipal_same_key_elsewhere=elsewhere,
        osm_only_fallback=len(osm_only),
        osm_only_outside_krakow=sum(bool(r["outside_krakow"]) for r in osm_only),
        same_key_beyond_limit=beyond,
    )
    return frame, counts


def reconciliation_examples(labelled: pl.DataFrame) -> ReconciliationExamples:
    """Up to five real examples per class from the labelled reconciled frame.

    Clean matches and gaps come from well-mapped streets (most matched records first): a gap there
    is the surprising kind. Disagreements are the largest offsets, one per street.
    """
    rows = labelled.to_dicts()
    matched_per_street = Counter(
        r["search_key"] for r in rows if r["provenance"] == PROVENANCE_MATCHED
    )
    streets = sorted({r["search_key"] for r in rows}, key=lambda k: (-matched_per_street[k], k))

    def first_per_street(selected: list[dict[str, Any]]) -> list[dict[str, Any]]:
        by_street: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for r in selected:
            by_street[r["search_key"]].append(r)
        picked = []
        for street in streets:
            if by_street.get(street):
                picked.append(
                    min(
                        by_street[street],
                        key=lambda r: (natural_housenumber(r["housenumber"].upper()), r["label"]),
                    )
                )
            if len(picked) == MAX_EXAMPLES:
                break
        return picked

    def offset(r: dict[str, Any]) -> str:
        return f"{r['label']}: {round(r['osm_delta_m'])} m"

    clean = [
        r
        for r in rows
        if r["provenance"] == PROVENANCE_MATCHED and r["osm_delta_m"] <= ADDRESS_MATCH_CLEAN_M
    ]
    gaps = [
        r
        for r in rows
        if r["provenance"] == PROVENANCE_MUNICIPAL and not r["osm_same_key_elsewhere"]
    ]
    disagreements = sorted(
        (
            r
            for r in rows
            if r["provenance"] == PROVENANCE_MATCHED and r["osm_delta_m"] > ADDRESS_MATCH_CLEAN_M
        ),
        key=lambda r: (-r["osm_delta_m"], r["label"]),
    )
    seen: set[str] = set()
    widest: list[dict[str, Any]] = []
    for r in disagreements:
        if r["search_key"] not in seen:
            seen.add(r["search_key"])
            widest.append(r)
        if len(widest) == MAX_EXAMPLES:
            break
    return ReconciliationExamples(
        matched_clean=[offset(r) for r in first_per_street(clean)],
        matched_disagreement=[offset(r) for r in widest],
        municipal_only_gap_closed=[r["label"] for r in first_per_street(gaps)],
    )
