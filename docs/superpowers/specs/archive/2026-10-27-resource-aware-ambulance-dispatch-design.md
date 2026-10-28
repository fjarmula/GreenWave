# Resource-aware ambulance dispatch (PRM roster): design

- Date: 2026-10-27
- Status: Draft for review
- Scope: Phase 2 of the public-data increment. It builds on Phase 1
  (`2026-10-27-municipal-addresses-design.md`, EMUiA) and is ambulances only. Fire capabilities and
  police patrols are deferred.

## Intent

Today every OSM ambulance station and every hospital emergency department (SOR) is treated as an
always-available ambulance origin. The official Małopolska PRM plan publishes, for every
ambulance team (ZRM), its base address, type, readiness hours and operating area. This phase
ranks **eligible teams** instead of buildings:

incident address + official team roster + scenario time + simulated availability → eligible team
→ route and green-corridor simulation.

The demo moment: the nearest team is off shift (07:00–19:00 team at 21:00) or marked busy, so
another team is chosen, and the UI says exactly why. Public data changes the result.

Simulation only. Nothing here reflects live ambulance positions or availability, and no official
dispatch protocol is claimed.

## Goals

1. Load the official roster from the plan's update no. 2 spreadsheet (Tables 1a and 2a), with
   provenance.
2. Ambulance dispatch origins become PRM bases. Hospital SORs and OSM ambulance stations without
   a PRM team stop being ambulance origins.
3. Add a scenario time, a per-team availability override (`free` / `busy`) and a default
   `unknown`, which is assumed free and badged.
4. Exclude off-shift and busy teams, with a reason for each.
5. Area rule: prefer a team whose operating area covers the incident, unless an out-of-area team
   arrives more than 60 s sooner.
6. Return an explicit "no eligible team" outcome.
7. Show the roster's provenance, and add a Data Quality check for it.

## Non-goals

- No live availability, vehicle positions or real dispatch protocol.
- No severity model, so S vs P type does not drive selection (it is shown only).
- No reserve teams (Table 3a: K01 D 002 and K01 D 004, 120-minute start-up).
- No areas outside Kraków city (municipality boundaries are not loaded): there, the area is
  `unknown` and pure nearest applies.
- No changes for fire or police.

## Anti-goals

- Turning `unknown` availability into a silent "available": it must be badged.
- Presenting the team count as the number of physical ambulances.
- Area preference that sends a team more than 60 s slower than the nearest eligible team.
- Inferring real positions or states of teams.

## Source facts (verified 2026-10-27 from the files the human downloaded)

Raw files are under `backend/data/raw/prm/`:

| File | Content |
|---|---|
| `amendments/AKTUALIZACJA_NR_2_TABELE.xlsx` | 23 sheets. **Tabela nr 1a**: operational regions and team bases, effective from 1 Sep 2026. **Tabela nr 2a**: teams in the system, with full base address, as of 1 Sep 2026. Tabela nr 1 is the Jan 2026 version; Tabela nr 4 has 2025 call counts. |
| `amendments/AKTUALIZACJA_NR_2_TEKST.docx` | Plan text, "Aktualizacja nr 2, Kraków, 24 czerwca 2026 r."; Table 1a applies from 1 Sep 2026 |
| `Obowiazujacy_…/REJONY_ZRM_…` PDF and GIF | Area map image; context only |
| `annoucements/*.pdf` | Voivode and NFZ press releases (provenance) |

Table 1a columns (header row): `B` region, `D` dispatch centre, `E` operating area (TERYT codes,
`; `-separated), `F` team id (10-digit), `G` team name (`K01 162`), `H` type (`P2`, `P3`, `S`),
`I` base TERYT, `J` base place (`Kraków - Prądnik Biały`), `K` days per year, `L` hours per day,
`M` weekdays (`pon., wt., śr., czw., pt., sob., nd.`), `N` hours (`00:00 - 24:00` or
`07:00 - 19:00`), `O`/`P` season (`1 stycznia` … `31 grudnia`).

Table 2a columns: `F` team name, `G` type, `H` base TERYT, `K` base address
(`ul. Wybickiego Józefa 3a, 31-261 Kraków`), `L` operator.

The two tables have the same 149 teams; Kraków operational region `RO12/01` has 95.
- **23 teams are based in Kraków city** (TERYT `1261…`) at 8 bases. Types: 1 S, 2 P3, 20 P2.
  Hours: 19 work 24 h; 4 work 07:00–19:00 (K01 134, K01 158, K01 176, K01 178).
- **About 14 teams** are based just outside the city, inside the routable map: Wieliczka,
  Skawina, Niepołomice, Zabierzów, Zielonki, Mogilany, Kryspinów, Kocmyrzów, Węgrzce.
- Operating areas in Kraków use the four city-part (delegatura) TERYT codes:
  `1261029` Krowodrza, `1261039` Nowa Huta, `1261049` Podgórze, `1261059` Śródmieście.
- Free-text geocoding of the published addresses fails: the plan writes surname first
  (`Teligi Leonida 8`) where EMUiA writes `Leonida Teligi 8`.

## Decisions (human)

- **D1 (2026-10-27):** shift schedule and live status are separate. Off shift at the scenario
  time → excluded (`OFF_SHIFT`). On shift and unset → `unknown`, eligible, badged "status
  unknown — assumed free in scenario". Explicit `busy` → excluded (`BUSY_OVERRIDE`).
- **D2 (2026-10-27):** hospital SORs are removed from ambulance dispatch candidates once PRM
  bases are active. A PRM base with no OSM `ambulance_base` within 200 m becomes a new base.
- **D3 (2026-10-27):** roster provenance is shown in the UI and its counts in
  `data_quality.json`.
- **D4 (2026-10-27), the area rule:** the area is shown as context, and teams whose area covers
  the incident are preferred. If the best out-of-area team arrives more than 60 s sooner than
  the best in-area team, the out-of-area team is sent. Otherwise the in-area team is sent. With
  no in-area eligible team, or an unknown incident area, the nearest eligible team is sent.

## Design

### Roster data and provenance

- The raw files are recorded in `MANIFEST.json` (source: Małopolski Urząd Wojewódzki, BIP;
  plan update no. 2 of 24 June 2026; tables from 1 Sep 2026). Rename the folder `annoucements` →
  `announcements` before recording it.
- **Spreadsheet reader:** `etl/xlsx_reader.py` uses the standard library only (`zipfile` +
  `xml.etree`). It rejects any part containing `<!DOCTYPE` (no entity expansion) and returns rows
  as `{column letter: text}` with whitespace collapsed. There is no new dependency.
- **Roster parser:** `etl/prm_roster.py` reads Tables 1a and 2a, joins them on the team name and
  validates:
  - every 1a team is in 2a and the reverse;
  - hours match `HH:MM - HH:MM`;
  - weekdays are the seven Polish abbreviations;
  - season dates use Polish month names;
  - the type is P1, P2, P3 or S.

  Any violation raises `PrmRosterError`, naming the team and column.
- **Curated base coordinates** (committed): `backend/data/curated/prm_bases.json`. There is one
  entry per published base address in scope; the address is the exact Table 2a string. An entry
  is either `{"address", "emuia_id"}` (Kraków: the coordinate comes from the EMUiA point) or
  `{"address", "lat", "lng", "source"}` (outside Kraków: OSM element or manual, cited).
- **Scope:** teams whose base address has an entry. All 23 Kraków-based teams must have one
  (enforced by test on real data). Suburban bases are added when they snap to the routable
  network. Region `RO12/01` teams without an entry are reported as `outside_simulation_area`.

### `places` step changes (it owns `stations.parquet`)

- Ambulance stations become PRM bases, with `source_kind = "prm_base"`.
  - An OSM `ambulance_base` within 200 m (`PRM_BASE_OSM_MATCH_RADIUS_M`, approved D2) is
    reported as matched (`osm_ref` kept), but the published address is the station name.
  - OSM ambulance stations and hospital SORs without a PRM base are not written. They are
    reported as `replaced_by_prm` (name and reason).
- Station ids stay `STN-A-####`, assigned in sorted base-address order.
- **New artifact `resources.parquet`**, one row per team in scope:
  - `team_code` (`K01 162`), `team_id`, `team_type`, `station_id`, `base_address`;
  - `area_teryt` (`;`-joined), `weekdays` (`1234567`, Monday = 1);
  - `ready_from_min`, `ready_to_min` (0–1440, to > from, so 24 h is 0–1440);
  - `season_from`, `season_to` (`MM-DD`), `region`.
- The report section `places.resources` records: plan update `2`, `effective_from`
  `2026-09-01`, source tables, teams in scope, bases, `outside_simulation_area` team names,
  `replaced_by_prm`, counts by type and by hours, and bases matched to OSM.
- Phase 1 addition: EMUiA's `numer_dzielnicy` is kept as `district_number` (Int8) on
  matched and municipal rows of `addresses.parquet`; it is null for OSM rows.

### Incident operating area

`places/incident_area.py`, `IncidentAreaLocator`:
- The nearest EMUiA-backed address (matched or municipal) within `AREA_LOOKUP_RADIUS_M`
  (250 m, placeholder) gives the district number.
- `KRAKOW_DISTRICT_DELEGATURA` maps it to a TERYT: I–III → `1261059`, IV–VII → `1261029`,
  VIII–XIII → `1261049`, XIV–XVIII → `1261039`. The district list comes from the Table 1 legend.
- Result: `IncidentArea {teryt, district_number, district_name} | None` (None means unknown).
  It works for typed addresses and map clicks alike.

### Eligibility and ranking

- `routing/team_eligibility.py`:
  - `on_shift(team, at: datetime) -> bool`, using local wall-clock time. Weekday, minute of day
    in `[from, to)` and season are inclusive.
  - `classify(teams, at, overrides) -> TeamEligibility(eligible: [(team, assumed_free)],
    excluded: [(team, "OFF_SHIFT" | "BUSY_OVERRIDE")])`. Override keys are team codes. `free` is
    allowed but cannot bring an off-shift team on shift: off shift wins.
- Ranking (AMBULANCE only; fire and police are unchanged):
  1. Eligible bases = stations with at least one eligible team.
  2. Existing reversed-Dijkstra shortlist and real pipeline over eligible bases. The shortlist
     always includes (`must_include`) the base with the lowest reversed-Dijkstra time among bases
     that have at least one **eligible** in-area team, chosen after eligibility filtering, so D4
     can be evaluated.
  3. Team per base: in-area team first, then `team_code` ascending. The other eligible codes at
     that base are listed.
  4. D4 order, on the totals of the request's `time_mode` (`ENABLED` = green-wave estimate,
     `DISABLED` = standard estimate; default `ENABLED`; the comparison page sends `ENABLED`):
     - `fastest` is the candidate with the minimum total;
     - `in_area` is the fastest candidate whose chosen team is in area;
     - if `in_area` exists and `in_area.total − fastest.total ≤ area_preference_margin_seconds`
       (60), `in_area` goes first with reason `IN_AREA_WITHIN_MARGIN` (or `NEAREST` when it is
       the fastest);
     - otherwise `fastest` goes first with `NEAREST_OUTSIDE_MARGIN` (or `NEAREST` when there is
       no in-area team or the area is unknown);
     - the rest follow by `total_seconds`, up to 3 candidates.
  5. No eligible base → outcome `NO_ELIGIBLE_RESOURCE`, with empty candidates and the full
     exclusion list. Eligible teams exist but no base can reach the incident → unchanged 422
     `NO_STATION_REACHABLE`: a routing failure, not an availability outcome.
- `SimulationSettings.area_preference_margin_seconds = 60` (env
  `GREENWAVE_SIM_AREA_PREFERENCE_MARGIN_SECONDS`), approved D4.

### Contract (ADR 0014; additive in shape, but `candidates` may now be empty)

- `DispatchRankRequest` gains:
  - `scenario_time: datetime | None` (naive local time; None → server local now, echoed back);
  - `time_mode: GreenWaveMode = ENABLED` (which estimate D4 compares);
  - `availability: dict[str, Literal["free", "busy"]] = {}`.
- `DispatchRankResponse` gains:
  - `scenario_time`;
  - `outcome: Literal["OK", "NO_ELIGIBLE_RESOURCE"]`;
  - `incident_area: IncidentArea | None`;
  - `excluded_teams: list[ExcludedTeam {team_code, station_id, reason}]`;
  - `roster: RosterInfo | None` (source, plan update, effective_from, teams_in_scope);
  - `area_rule: AreaRuleOutcome | None` (AMBULANCE only), holding `reason`,
    `chosen_team_code`, `nearest_team_code`, `in_area_team_code: str | None` and
    `delta_seconds: float | None` (the in-area total minus the nearest total). It feeds the reason
    line even when the in-area team is not among the returned candidates;
  - `candidates` is relaxed to 0–3 items.
- `RankedCandidate` gains:
  - `team: TeamAssignment | None`, holding `team_code`, `team_type`, `area_teryt`,
    `in_area: bool | None`, `availability: "free" | "assumed_free"` and
    `other_eligible_team_codes`;
  - `selection_reason` (first candidate only): `NEAREST` | `IN_AREA_WITHIN_MARGIN` |
    `NEAREST_OUTSIDE_MARGIN`.
- `IncidentArea` on the wire: `teryt`, `delegatura_name` (Śródmieście, Krowodrza, Podgórze or
  Nowa Huta), `district_number`, `district_name` (the district itself, e.g. "Podgórze Duchackie",
  from the 18 names in the Table 1 legend, hard-coded with that source).
- New `GET /api/v1/resources?at=<scenario_time>` returns `ResourcesResponse {roster, at,
  teams: [Team]}`. `Team` holds the code, type, station id, base address, area TERYT list,
  weekdays, ready window, season and `on_shift: bool` at `at` (default: server local now). The
  panel works before an incident is chosen.
- `StationSourceKind` gains `prm_base`. Afterwards regenerate `openapi.json`, the frontend
  types and `frontend/src/data/stations.snapshot.json`.

### Frontend

Ambulance mode with the backend transport:
- **The backend order is kept.** `station-choice.ts` `orderCandidates` must not re-sort
  team-ranked candidates: the first candidate is the recommended team and the default run origin.
  It gets a `Recommended` chip. The `Fastest` chip goes on the candidate with the lowest total in
  the page's mode, which may be a later row. The "+N s" deltas stay relative to the fastest.
  Fire, police and mock mode keep today's ordering.
- The rank request sends `time_mode` from the page (green-wave page `ENABLED`, standard page
  `DISABLED`, comparison `ENABLED`).
- **Scenario time:** a `datetime-local` input defaulting to now (rounded to 5 min). Changing it
  re-ranks.
- **Team availability panel:** teams grouped by base, each with a tri-state toggle (unknown /
  free / busy), a type chip and hours (`24 h` / `07:00–19:00`). Off-shift teams are shown
  disabled with "off shift". Changing a toggle re-ranks.
- **Ranking rows** show the team code and type, an `In area` / `Outside area` chip, and the
  "status unknown — assumed free" badge when it applies. The first row gets a reason line:
  - "Nearest eligible team";
  - "In-area team chosen — <N> s slower than the nearest (within 60 s)";
  - "Nearest team is outside the incident area — <N> s faster than the in-area team".
- **Excluded teams:** a collapsible list with reasons ("off shift (07:00–19:00)", "marked
  busy").
- **No eligible team:** the empty state reads "No eligible ambulance team at <time>. <n> off
  shift, <m> marked busy."
- **Roster badge:** "Official PRM plan · update 2 · from 1 Sep 2026 · <n> teams".
- **Mock mode:** a `resources: false` capability hides the panels; the current behaviour stays.

### Quality

A new check, `prm_roster`, titled "Ambulance teams (PRM plan)", status `info`.
- Metrics: `teams_in_scope`, `bases`, `teams_24h`, `teams_daytime`.
- Headline: the plan update and date, plus the outside-area count.
- Samples: up to 5 bases with their team codes.

## Testing

- **Spreadsheet reader:** a tiny xlsx built in the test (zip of minimal XML), shared strings,
  inline strings, blank cells, and DOCTYPE rejection.
- **Roster parser:** fixture rows for 24 h, 07–19, a P3 and an S team; a missing 2a partner, a
  bad hours string and an unknown weekday each raise.
- **Eligibility:** boundary minutes 06:59, 07:00, 18:59 and 19:00; 24 h; a busy override; a
  free override on an off-shift team stays excluded; unknown → assumed free.
- **Area:** each delegatura mapping, a lookup beyond 250 m → None, and an outside-Kraków
  point → None.
- **Ranking:**
  - in-area 40 s slower → in-area chosen;
  - in-area 75 s slower → nearest chosen with `NEAREST_OUTSIDE_MARGIN`;
  - no in-area team → `NEAREST`; all teams busy → `NO_ELIGIBLE_RESOURCE`;
  - two teams at one base → one candidate with `other_eligible_team_codes`;
  - the in-area base beyond the shortlist is still considered.
- **Places:** PRM base matched to an OSM ambulance station within 200 m; an unmatched base; SOR
  removed; deterministic `resources.parquet`; integrity checks.
- **API:** `/resources`; rank with `scenario_time` and `availability`; the no-eligible outcome.
- **Frontend:** validator, availability state, reason copy, and markup tests for the new panels.
- **Real data:**
  - All 23 Kraków teams in scope, and at 21:00 the 4 daytime teams are excluded.
  - Playwright demo: incident near Rynek Podgórski at 21:00 → K01 176 (07–19) is excluded and
    another team is chosen with a reason. Marking that team busy changes the choice again.

## Left to the builder

- Internal data structures, as long as the output is deterministic.
- The panel layout within `frontend/AGENTS.md` and the existing HUD styles.
- Exact Tailwind classes.

## Builder's calls (not decided by the human; review them)

1. The stdlib spreadsheet reader instead of a new dependency.
2. Roster fixed to Table 1a (from 1 Sep 2026); the scenario time selects time of day and
   weekday, not the plan version.
3. Suburban teams that snap to the network are included; the rest of region RO12/01 is reported
   as outside the simulation area.
4. Base coordinates are curated (EMUiA id or cited coordinate), because the published addresses
   do not geocode as free text.
5. Incident area from the nearest EMUiA address within 250 m; outside Kraków the area is
   unknown.
6. Team choice within a base: in-area first, then team code. Type does not rank.
7. `scenario_time` optional, defaulting to server local now, and echoed back.
8. "No eligible team" is a 200 response with `outcome`, not an error, so the exclusions can be
   shown.
9. OSM ambulance stations without a PRM team are no longer dispatch origins (a team-less
   building has no resource).
10. The frontend keeps the backend D4 order for ambulances (`Recommended` first; `Fastest` chip
    wherever the fastest is).
11. D4 compares the page's mode (`time_mode`); comparison uses green-wave.
12. `area_rule` in the response carries the delta and the team codes for the reason line.
13. Eligible but unreachable stays a 422 `NO_STATION_REACHABLE`.
14. The 18 district names are hard-coded from the Table 1 legend; the wire carries both the
    district and the delegatura name.
15. `must_include` is chosen after eligibility, by reversed-Dijkstra time.
16. `/resources?at=` returns `on_shift` per team, so the panel works before an incident is picked.
