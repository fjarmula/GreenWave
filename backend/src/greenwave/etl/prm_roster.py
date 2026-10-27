"""The official PRM team roster: Tables 1a and 2a of the Małopolska plan, update no. 2.

Table 1a (effective 1 Sep 2026) gives each ambulance team (ZRM) its region, operating area,
type and readiness schedule; Table 2a gives the same teams' full base address. Both are joined on
the team name and validated; any violation raises ``PrmRosterError`` naming the team and column.
"""

import re
from collections.abc import Callable
from datetime import date
from pathlib import Path

import polars as pl

from greenwave.etl.xlsx_reader import read_sheet

PRM_TABLES_RELATIVE_PATH = Path("prm") / "amendments" / "AKTUALIZACJA_NR_2_TABELE.xlsx"
ROSTER_SHEET = "Tabela nr 1a"
ADDRESS_SHEET = "Tabela nr 2a"
PLAN_UPDATE = "2"
EFFECTIVE_FROM = "2026-09-01"

# "K01 162"; the plan also lists one motorcycle team, "K01 051 M" (type M).
_TEAM_CODE = re.compile(r"^K\d{2} \d{3}( M)?$")
TEAM_TYPES = frozenset({"P1", "P2", "P3", "S", "M"})
_HOURS = re.compile(r"^(\d{2}):(\d{2}) - (\d{2}):(\d{2})$")
_TERYT = re.compile(r"^\d{7}$")
_WEEKDAYS = {"pon": "1", "wt": "2", "śr": "3", "czw": "4", "pt": "5", "sob": "6", "nd": "7"}
# Genitive month names, as in "1 stycznia".
_MONTHS = {
    "stycznia": 1, "lutego": 2, "marca": 3, "kwietnia": 4, "maja": 5, "czerwca": 6, "lipca": 7,
    "sierpnia": 8, "września": 9, "października": 10, "listopada": 11, "grudnia": 12,
}  # fmt: skip
_SEASON_DAY = re.compile(r"^(\d{1,2}) (\w+)$")

# Table 1a columns read: B region, E operating area, F team id, G team name, H type, I base TERYT,
# J base place, M weekdays, N hours, O/P season. Table 2a: F team name, K base address.
_ROSTER_COLUMNS = ("B", "E", "F", "G", "H", "I", "J", "M", "N", "O", "P")

_SCHEMA: dict[str, type[pl.DataType]] = {
    "team_code": pl.String,
    "team_id": pl.String,
    "team_type": pl.String,
    "region": pl.String,
    "base_teryt": pl.String,
    "base_place": pl.String,
    "base_address": pl.String,
    "area_teryt": pl.String,
    "weekdays": pl.String,
    "ready_from_min": pl.Int16,
    "ready_to_min": pl.Int16,
    "season_from": pl.String,
    "season_to": pl.String,
}


class PrmRosterError(ValueError):
    """The roster tables violate the expected layout or values."""


def parse_hours(text: str) -> tuple[int, int]:
    """``"07:00 - 19:00"`` -> ``(420, 1140)``; ``"00:00 - 24:00"`` -> ``(0, 1440)``."""
    match = _HOURS.match(text)
    if match is None:
        raise ValueError(f"hours {text!r} are not 'HH:MM - HH:MM'")
    h1, m1, h2, m2 = (int(g) for g in match.groups())
    start, end = h1 * 60 + m1, h2 * 60 + m2
    if m1 >= 60 or m2 >= 60 or not 0 <= start < end <= 1440:
        raise ValueError(f"hours {text!r} are not a same-day window within 00:00-24:00")
    return start, end


def parse_weekdays(text: str) -> str:
    """``"pon., wt., śr., czw., pt., sob., nd."`` -> ``"1234567"`` (Monday = 1)."""
    tokens = [t.strip(".") for t in re.split(r"[,\s]+", text) if t.strip(".")]
    unknown = [t for t in tokens if t not in _WEEKDAYS]
    if unknown or not tokens:
        raise ValueError(f"weekdays {text!r} contain unknown day names {unknown}")
    return "".join(sorted({_WEEKDAYS[t] for t in tokens}))


def parse_season_day(text: str) -> str:
    """``"1 stycznia"`` -> ``"01-01"``."""
    match = _SEASON_DAY.match(text)
    month = _MONTHS.get(match.group(2)) if match else None
    if match is None or month is None:
        raise ValueError(f"season day {text!r} is not '<day> <Polish month, genitive>'")
    day = int(match.group(1))
    try:
        date(2024, month, day)  # a leap year, so 29 February is valid
    except ValueError as error:
        raise ValueError(f"season day {text!r} is not a calendar day") from error
    return f"{month:02d}-{day:02d}"


def _area(text: str) -> str:
    codes = [c.strip() for c in text.split(";") if c.strip()]
    if not codes or not all(_TERYT.match(c) for c in codes):
        raise ValueError(f"operating area {text!r} is not a ';'-separated list of TERYT codes")
    return ";".join(codes)


def _field[T](code: str, column: str, parse: Callable[[str], T], text: str) -> T:
    try:
        return parse(text)
    except ValueError as error:
        raise PrmRosterError(f"team {code}: column {column}: {error}") from error


def _teams(rows: list[dict[str, str]], column: str, sheet: str) -> dict[str, dict[str, str]]:
    teams: dict[str, dict[str, str]] = {}
    for row in rows:
        code = row.get(column, "")
        if not _TEAM_CODE.match(code):
            continue
        if code in teams:
            raise PrmRosterError(f"team {code}: listed twice in {sheet}")
        teams[code] = row
    return teams


def _type(text: str) -> str:
    if text not in TEAM_TYPES:
        raise ValueError(f"type {text!r} is not one of {sorted(TEAM_TYPES)}")
    return text


def _teryt(text: str) -> str:
    if not _TERYT.match(text):
        raise ValueError(f"base TERYT {text!r} is not a 7-digit code")
    return text


def load_roster(path: Path) -> pl.DataFrame:
    """Tables 1a and 2a joined on the team name, one row per team, sorted by ``team_code``."""
    roster = _teams(read_sheet(path, ROSTER_SHEET), "G", ROSTER_SHEET)
    addresses = _teams(read_sheet(path, ADDRESS_SHEET), "F", ADDRESS_SHEET)
    if not roster:
        raise PrmRosterError(f"{ROSTER_SHEET} lists no teams")
    for code in sorted(roster.keys() - addresses.keys()):
        raise PrmRosterError(f"team {code}: in {ROSTER_SHEET} but missing from {ADDRESS_SHEET}")
    for code in sorted(addresses.keys() - roster.keys()):
        raise PrmRosterError(f"team {code}: in {ADDRESS_SHEET} but missing from {ROSTER_SHEET}")

    records: list[dict[str, object]] = []
    for code in sorted(roster):
        row = roster[code]
        missing = [c for c in _ROSTER_COLUMNS if c not in row]
        if missing:
            raise PrmRosterError(f"team {code}: column {missing[0]}: empty in {ROSTER_SHEET}")
        base_address = addresses[code].get("K")
        if not base_address:
            raise PrmRosterError(f"team {code}: column K: empty in {ADDRESS_SHEET}")
        ready_from, ready_to = _field(code, "N", parse_hours, row["N"])
        records.append(
            {
                "team_code": code,
                "team_id": row["F"],
                "team_type": _field(code, "H", _type, row["H"]),
                "region": row["B"],
                "base_teryt": _field(code, "I", _teryt, row["I"]),
                "base_place": row["J"],
                "base_address": base_address,
                "area_teryt": _field(code, "E", _area, row["E"]),
                "weekdays": _field(code, "M", parse_weekdays, row["M"]),
                "ready_from_min": ready_from,
                "ready_to_min": ready_to,
                "season_from": _field(code, "O", parse_season_day, row["O"]),
                "season_to": _field(code, "P", parse_season_day, row["P"]),
            }
        )
    return pl.DataFrame(records, schema=_SCHEMA)
