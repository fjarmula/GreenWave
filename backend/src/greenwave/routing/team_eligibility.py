"""Which PRM teams can be dispatched at a scenario time (spec D1).

The published schedule and the simulated status are separate: a team off shift at the scenario
time is excluded (``OFF_SHIFT``) whatever its override; an on-shift team marked ``busy`` is
excluded (``BUSY_OVERRIDE``); an on-shift team with no override is eligible and *assumed* free,
which the UI must badge. Nothing here reflects live availability.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime

import polars as pl

# The contract's literals, re-exported for routing callers.
from greenwave.schemas.dispatch import AvailabilityOverride as Availability
from greenwave.schemas.dispatch import ExclusionReason as ExclusionReason


@dataclass(frozen=True)
class Team:
    """One ``resources.parquet`` row. Minutes of day: on shift in ``[ready_from_min,
    ready_to_min)``; ``weekdays`` "1234567" (Monday = 1); season ``MM-DD`` inclusive."""

    team_code: str
    team_type: str
    station_id: str
    base_address: str
    area_teryt: tuple[str, ...]
    weekdays: str
    ready_from_min: int
    ready_to_min: int
    season_from: str
    season_to: str


@dataclass(frozen=True)
class TeamEligibility:
    """``eligible``: (team, assumed_free); ``excluded``: (team, reason). Input order kept."""

    eligible: tuple[tuple[Team, bool], ...]
    excluded: tuple[tuple[Team, ExclusionReason], ...]


def teams_from_frame(frame: pl.DataFrame) -> tuple[Team, ...]:
    """``resources.parquet`` as teams, sorted by ``team_code``."""
    return tuple(
        Team(
            team_code=row["team_code"],
            team_type=row["team_type"],
            station_id=row["station_id"],
            base_address=row["base_address"],
            area_teryt=tuple(row["area_teryt"].split(";")),
            weekdays=row["weekdays"],
            ready_from_min=int(row["ready_from_min"]),
            ready_to_min=int(row["ready_to_min"]),
            season_from=row["season_from"],
            season_to=row["season_to"],
        )
        for row in frame.sort("team_code").iter_rows(named=True)
    )


def _in_season(team: Team, day: str) -> bool:
    if team.season_from <= team.season_to:
        return team.season_from <= day <= team.season_to
    return day >= team.season_from or day <= team.season_to  # a season across the new year


def on_shift(team: Team, at: datetime) -> bool:
    """Local wall-clock time: weekday, season day (inclusive) and minute of day in the window."""
    minute = at.hour * 60 + at.minute
    return (
        str(at.isoweekday()) in team.weekdays
        and _in_season(team, at.strftime("%m-%d"))
        and team.ready_from_min <= minute < team.ready_to_min
    )


def classify(
    teams: Iterable[Team], at: datetime, overrides: Mapping[str, Availability]
) -> TeamEligibility:
    """Off shift is checked first, so a ``free`` override cannot bring a team on shift."""
    eligible: list[tuple[Team, bool]] = []
    excluded: list[tuple[Team, ExclusionReason]] = []
    for team in teams:
        override = overrides.get(team.team_code)
        if not on_shift(team, at):
            excluded.append((team, "OFF_SHIFT"))
        elif override == "busy":
            excluded.append((team, "BUSY_OVERRIDE"))
        else:
            eligible.append((team, override is None))
    return TeamEligibility(tuple(eligible), tuple(excluded))
