from dataclasses import replace
from datetime import datetime

import polars as pl
import pytest

from greenwave.routing.team_eligibility import Team, classify, on_shift, teams_from_frame

DAYTIME = Team(
    team_code="K01 176",
    team_type="P3",
    station_id="STN-A-0003",
    base_address="ul. Rynek Podgórski 2, 30-533 Kraków",
    area_teryt=("1261049",),
    weekdays="1234567",
    ready_from_min=420,
    ready_to_min=1140,
    season_from="01-01",
    season_to="12-31",
)
ALL_DAY = replace(DAYTIME, team_code="K01 008", ready_from_min=0, ready_to_min=1440)
# Tuesday 27 October 2026.
TUESDAY = datetime(2026, 10, 27)


def at(hour: int, minute: int = 0) -> datetime:
    return TUESDAY.replace(hour=hour, minute=minute)


@pytest.mark.parametrize(
    ("hour", "minute", "expected"),
    [(6, 59, False), (7, 0, True), (18, 59, True), (19, 0, False)],
)
def test_daytime_window_boundaries(hour: int, minute: int, expected: bool) -> None:
    assert on_shift(DAYTIME, at(hour, minute)) is expected


@pytest.mark.parametrize(("hour", "minute"), [(0, 0), (12, 0), (23, 59)])
def test_24h_team_always_on(hour: int, minute: int) -> None:
    assert on_shift(ALL_DAY, at(hour, minute))


def test_weekday_filter() -> None:
    weekdays_only = replace(ALL_DAY, weekdays="12345")

    assert on_shift(weekdays_only, datetime(2026, 10, 30, 12))  # Friday
    assert not on_shift(weekdays_only, datetime(2026, 10, 31, 12))  # Saturday
    assert not on_shift(weekdays_only, datetime(2026, 11, 1, 12))  # Sunday


def test_season_filter() -> None:
    summer = replace(ALL_DAY, season_from="07-01", season_to="09-30")

    assert on_shift(summer, datetime(2026, 7, 1, 0, 0))
    assert on_shift(summer, datetime(2026, 9, 30, 23, 59))
    assert not on_shift(summer, datetime(2026, 6, 30, 23, 59))
    assert not on_shift(summer, datetime(2026, 10, 1, 0, 0))


def test_season_across_new_year() -> None:
    winter = replace(ALL_DAY, season_from="12-01", season_to="02-28")

    assert on_shift(winter, datetime(2026, 12, 31, 12))
    assert on_shift(winter, datetime(2027, 1, 15, 12))
    assert not on_shift(winter, datetime(2026, 11, 30, 12))


def test_busy_override_excluded() -> None:
    result = classify((ALL_DAY,), at(12), {"K01 008": "busy"})

    assert result.eligible == ()
    assert result.excluded == ((ALL_DAY, "BUSY_OVERRIDE"),)


def test_free_override_cannot_unshift() -> None:
    result = classify((DAYTIME,), at(21), {"K01 176": "free"})

    assert result.eligible == ()
    assert result.excluded == ((DAYTIME, "OFF_SHIFT"),)


def test_off_shift_wins_over_busy() -> None:
    result = classify((DAYTIME,), at(21), {"K01 176": "busy"})

    assert result.excluded == ((DAYTIME, "OFF_SHIFT"),)


def test_unknown_is_assumed_free() -> None:
    result = classify((ALL_DAY, DAYTIME), at(12), {})

    assert result.eligible == ((ALL_DAY, True), (DAYTIME, True))
    assert result.excluded == ()


def test_explicit_free_not_assumed() -> None:
    result = classify((ALL_DAY,), at(12), {"K01 008": "free"})

    assert result.eligible == ((ALL_DAY, False),)


def test_classify_keeps_input_order() -> None:
    result = classify((DAYTIME, ALL_DAY), at(21), {})

    assert [t.team_code for t, _ in result.eligible] == ["K01 008"]
    assert [t.team_code for t, _ in result.excluded] == ["K01 176"]


def test_teams_from_frame() -> None:
    frame = pl.DataFrame(
        {
            "team_code": ["K01 176"],
            "team_id": ["1261011200"],
            "team_type": ["P3"],
            "station_id": ["STN-A-0003"],
            "base_address": [DAYTIME.base_address],
            "area_teryt": ["1261049;1261059"],
            "weekdays": ["1234567"],
            "ready_from_min": [420],
            "ready_to_min": [1140],
            "season_from": ["01-01"],
            "season_to": ["12-31"],
            "region": ["RO12/01"],
        },
        schema_overrides={"ready_from_min": pl.Int16, "ready_to_min": pl.Int16},
    )

    assert teams_from_frame(frame) == (replace(DAYTIME, area_teryt=("1261049", "1261059")),)
