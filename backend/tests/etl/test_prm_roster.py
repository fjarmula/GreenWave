from pathlib import Path

import polars as pl
import pytest

from greenwave.etl.prm_roster import (
    PrmRosterError,
    load_roster,
    parse_hours,
    parse_season_day,
    parse_weekdays,
)
from tests.support.xlsx_fixtures import PrmTeam, prm_sheets, write_xlsx

WYBICKIEGO = "ul. Wybickiego Józefa 3a, 31-261 Kraków"
PODGORSKI = "ul. Rynek Podgórski 2, 30-533 Kraków"
TEAMS = [
    PrmTeam("K01 162", WYBICKIEGO),
    PrmTeam(
        "K01 176",
        PODGORSKI,
        type="P3",
        hours="07:00 - 19:00",
        area="1261049",
        place="Kraków - Podgórze",
    ),
    PrmTeam("K01 001", "ul. św. Łazarza 14, 31-530 Kraków", type="S", area="1261059; 1261029"),
]


def _roster(tmp_path: Path, teams: list[PrmTeam], **kwargs: tuple[str, ...]) -> pl.DataFrame:
    path = write_xlsx(tmp_path / "tables.xlsx", prm_sheets(teams, **kwargs))
    return load_roster(path)


def _row(frame: pl.DataFrame, code: str) -> dict[str, object]:
    return frame.filter(pl.col("team_code") == code).row(0, named=True)


def test_joins_1a_and_2a(tmp_path: Path) -> None:
    frame = _roster(tmp_path, TEAMS)

    assert frame["team_code"].to_list() == ["K01 001", "K01 162", "K01 176"]
    row = _row(frame, "K01 162")
    assert row["team_type"] == "P2"
    assert row["base_address"] == WYBICKIEGO
    assert row["base_teryt"] == "1261011"
    assert row["base_place"] == "Kraków - Prądnik Biały"
    assert row["region"] == "RO12/01"
    assert row["team_id"] == "1261011200"
    assert (row["ready_from_min"], row["ready_to_min"]) == (0, 1440)
    assert row["weekdays"] == "1234567"
    assert (row["season_from"], row["season_to"]) == ("01-01", "12-31")
    assert frame.schema["ready_from_min"] == pl.Int16


def test_area_codes_are_joined_with_semicolons(tmp_path: Path) -> None:
    assert _row(_roster(tmp_path, TEAMS), "K01 001")["area_teryt"] == "1261059;1261029"


def test_daytime_team_parsed(tmp_path: Path) -> None:
    row = _row(_roster(tmp_path, TEAMS), "K01 176")

    assert (row["ready_from_min"], row["ready_to_min"]) == (420, 1140)
    assert row["team_type"] == "P3"


def test_motorcycle_team_suffix_is_a_team(tmp_path: Path) -> None:
    teams = [PrmTeam("K01 051 M", "ul. Kamieniec 10, 34-500 Zakopane", type="M")]

    assert _roster(tmp_path, teams)["team_code"].to_list() == ["K01 051 M"]


def test_parse_hours() -> None:
    assert parse_hours("07:00 - 19:00") == (420, 1140)
    assert parse_hours("00:00 - 24:00") == (0, 1440)


def test_parse_weekdays() -> None:
    assert parse_weekdays("pon., wt., śr., czw., pt., sob., nd.") == "1234567"
    # The plan file has one row written without some dots and commas.
    assert parse_weekdays("pon, wt, śr., czw., pt., sob. nd.") == "1234567"
    assert parse_weekdays("pon., śr., pt.") == "135"


def test_parse_season_day() -> None:
    months = [
        "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
        "lipca", "sierpnia", "września", "października", "listopada", "grudnia",
    ]  # fmt: skip
    for number, month in enumerate(months, start=1):
        assert parse_season_day(f"1 {month}") == f"{number:02d}-01"
    assert parse_season_day("31 grudnia") == "12-31"


def test_missing_2a_partner_raises(tmp_path: Path) -> None:
    with pytest.raises(PrmRosterError, match="K01 176"):
        _roster(tmp_path, TEAMS, roster_only=("K01 176",))


def test_2a_team_missing_from_1a_raises(tmp_path: Path) -> None:
    sheets = prm_sheets(TEAMS)
    sheets["Tabela nr 1a"] = [r for r in sheets["Tabela nr 1a"] if r.get("G") != "K01 001"]
    path = write_xlsx(tmp_path / "tables.xlsx", sheets)

    with pytest.raises(PrmRosterError, match="K01 001"):
        load_roster(path)


def test_bad_hours_raise(tmp_path: Path) -> None:
    teams = [PrmTeam("K01 162", WYBICKIEGO, hours="7-19")]

    with pytest.raises(PrmRosterError, match=r"K01 162.*\bN\b"):
        _roster(tmp_path, teams)


def test_reversed_hours_raise(tmp_path: Path) -> None:
    teams = [PrmTeam("K01 162", WYBICKIEGO, hours="19:00 - 07:00")]

    with pytest.raises(PrmRosterError, match="K01 162"):
        _roster(tmp_path, teams)


def test_unknown_weekday_raises(tmp_path: Path) -> None:
    teams = [PrmTeam("K01 162", WYBICKIEGO, weekdays="pon., wt., xyz.")]

    with pytest.raises(PrmRosterError, match=r"K01 162.*\bM\b"):
        _roster(tmp_path, teams)


def test_unknown_season_month_raises(tmp_path: Path) -> None:
    teams = [PrmTeam("K01 162", WYBICKIEGO, season=("1 styczeń", "31 grudnia"))]

    with pytest.raises(PrmRosterError, match=r"K01 162.*\bO\b"):
        _roster(tmp_path, teams)


def test_unknown_type_raises(tmp_path: Path) -> None:
    teams = [PrmTeam("K01 162", WYBICKIEGO, type="X9")]

    with pytest.raises(PrmRosterError, match=r"K01 162.*\bH\b"):
        _roster(tmp_path, teams)
