# Resource-Aware Ambulance Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ambulance dispatch ranks eligible official PRM teams (by scenario time, simulated availability and the 60 s area rule) instead of treating every ambulance building as always available.

**Architecture:** A stdlib xlsx reader and a roster parser turn the plan's Tables 1a and 2a into `resources.parquet`, inside the `places` step, which already owns `stations.parquet`. PRM bases replace OSM ambulance stations and hospital SORs as ambulance origins. At run time an eligibility classifier and an incident-area locator feed the existing ranking, which applies D4. The contract gains scenario time, availability, outcome, exclusions and team assignment (ADR 0014). The frontend adds a scenario-time input, an availability panel and reason copy.

**Tech Stack:** Python 3.12, polars, shapely, FastAPI/Pydantic, pytest; Next.js/React, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-resource-aware-ambulance-dispatch-design.md` (read it in full first: decisions D1–D4, the source-facts column letters, builder's calls 1–9).

## Global Constraints

- Simulation only. No live availability, no real positions, and no claim to reproduce official dispatch protocols.
- Approved values: `PRM_BASE_OSM_MATCH_RADIUS_M = 200.0` (D2) and `area_preference_margin_seconds = 60` (D4). Placeholder: `AREA_LOOKUP_RADIUS_M = 250.0`.
- Unknown availability is never silently "available": it is `assumed_free` and badged.
- Exclusion reasons are exactly `OFF_SHIFT` and `BUSY_OVERRIDE`. Selection reasons are exactly `NEAREST`, `IN_AREA_WITHIN_MARGIN` and `NEAREST_OUTSIDE_MARGIN`. The outcome is `OK` or `NO_ELIGIBLE_RESOURCE`.
- Roster source: `backend/data/raw/prm/amendments/AKTUALIZACJA_NR_2_TABELE.xlsx`, sheets `Tabela nr 1a` and `Tabela nr 2a`; plan update `2`, `effective_from` `2026-09-01`.
- Fire and police ranking are byte-for-byte unchanged (existing tests stay green).
- Contracts: never hand-edit `contracts/openapi.json` or `frontend/src/types/api.generated.ts`; regenerate with `cd backend && uv run python scripts/export_openapi.py && cd ../frontend && npm run generate:types`.
- ETL output is deterministic. Raw data stays uncommitted; `MANIFEST.json` and `backend/data/curated/*` are committed.
- Commits follow `<category>: <message>`, stage explicit paths and end with the `Co-Authored-By` trailer. No push and no branch operations.
- Backend checks: `cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`. Frontend checks: `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`.

## Review Focus

1. **Shift-window boundaries:** a 07:00–19:00 team is on shift at 07:00 and at 18:59, and off shift at 19:00 and 06:59. Test in Task 4 (`test_daytime_window_boundaries`).
2. **The fastest in-area base falls outside the Dijkstra shortlist:** it must still be evaluated for D4. Test in Task 6 (`test_in_area_base_beyond_shortlist_considered`).
3. **Several teams at one base, some busy:** the candidate shows the chosen team, and busy teams appear only in `excluded_teams`. Test in Task 6 (`test_shared_base_lists_other_eligible_codes`).
4. **A `free` override on an off-shift team** must stay excluded as `OFF_SHIFT`. Test in Task 4 (`test_free_override_cannot_unshift`).
5. **A map-click incident** with no address, or outside Kraków, gives area `None`, and ranking is pure nearest. Test in Task 5 (`test_point_beyond_radius_is_unknown`) and Task 6 (`test_unknown_area_is_pure_nearest`).

---

## Milestone A: Roster data (Tasks 1–3)

### Task 1: Stdlib xlsx reader and roster parser

**Files:**
- Create: `backend/src/greenwave/etl/xlsx_reader.py`, `backend/src/greenwave/etl/prm_roster.py`
- Create: `backend/tests/support/xlsx_fixtures.py` (`write_xlsx(path, sheets: dict[str, list[dict[str, str]]])`, a minimal workbook with shared strings)
- Test: `backend/tests/etl/test_xlsx_reader.py`, `backend/tests/etl/test_prm_roster.py`

**Interfaces:**
- Produces:
  - `read_sheet(path: Path, sheet: str) -> list[dict[str, str]]`: one dict per non-empty row, keyed by column letter, values whitespace-collapsed. It raises `XlsxError(ValueError)` for a missing sheet or for any XML part containing `<!DOCTYPE`.
  - `PRM_TABLES_RELATIVE_PATH = Path("prm") / "amendments" / "AKTUALIZACJA_NR_2_TABELE.xlsx"`, `ROSTER_SHEET = "Tabela nr 1a"`, `ADDRESS_SHEET = "Tabela nr 2a"`, `PLAN_UPDATE = "2"`, `EFFECTIVE_FROM = "2026-09-01"`.
  - `class PrmRosterError(ValueError)`.
  - `load_roster(path: Path) -> pl.DataFrame` with columns `team_code, team_id, team_type, region, base_teryt, base_place, base_address, area_teryt (";"-joined), weekdays ("1234567"), ready_from_min, ready_to_min (Int16), season_from, season_to ("MM-DD")`, sorted by `team_code`. Data rows are those whose `G` (1a) or `F` (2a) matches `^K\d{2} \d{3}$`.
  - `parse_hours("07:00 - 19:00") -> (420, 1140)`, `parse_hours("00:00 - 24:00") -> (0, 1440)`; `parse_weekdays("pon., wt., śr., czw., pt., sob., nd.") -> "1234567"`; `parse_season_day("1 stycznia") -> "01-01"`.

- [ ] **Step 1: Write the failing tests.**
  - Reader: `test_reads_shared_and_inline_strings`, `test_skips_empty_cells`, `test_collapses_whitespace`, `test_rejects_doctype`, `test_missing_sheet_raises`.
  - Roster: `test_joins_1a_and_2a` (the fixture team `K01 162`, P2, Wybickiego 3a, 0–1440), `test_daytime_team_parsed` (`K01 176` gives 420–1140), `test_parse_weekdays`, `test_parse_season_day` (all 12 Polish month names in the genitive), `test_missing_2a_partner_raises`, `test_bad_hours_raise`, `test_unknown_weekday_raises`, `test_unknown_type_raises`. Each error message must name the team code.
- [ ] **Step 2: Run them and confirm they fail.** `cd backend && uv run pytest tests/etl/test_xlsx_reader.py tests/etl/test_prm_roster.py -q`. Expected: ImportError.
- [ ] **Step 3: Implement.** The reader resolves sheet targets via `xl/_rels/workbook.xml.rels`.
- [ ] **Step 4: Run them and confirm they pass,** plus a real-file smoke check: `uv run python -c "from pathlib import Path; from greenwave.etl.prm_roster import load_roster; f=load_roster(Path('data/raw/prm/amendments/AKTUALIZACJA_NR_2_TABELE.xlsx')); print(f.height, f.filter(f['base_teryt'].str.starts_with('1261')).height)"`. Expected: `149 23`.
- [ ] **Step 5: Commit.** `feat: read the PRM team roster from the plan spreadsheet`

### Task 2: Curated base coordinates and the EMUiA district number

**Files:**
- Create: `backend/data/curated/prm_bases.json` (an empty list for now; filled in Task 3)
- Create: `backend/src/greenwave/etl/prm_bases.py`
- Modify: `backend/src/greenwave/etl/municipal_addresses.py` (keep `numer_dzielnicy` as `district_number: Int8`), `backend/src/greenwave/etl/address_reconcile.py` (`district_number` column: EMUiA value for matched and municipal rows, null for osm), `backend/src/greenwave/dataset/constants.py` (addresses schema gains `district_number: Int8`), `backend/tests/support/pipeline_fixtures.py` (`emuia_feature(..., district_number="1")`)
- Test: `backend/tests/etl/test_prm_bases.py`, plus additions to `test_municipal_addresses.py` and `test_address_reconcile.py`

**Interfaces:**
- Produces:
  - `PRM_BASES_PATH = Path("data") / "curated" / "prm_bases.json"` (relative to `backend/`).
  - `class BaseCoordinate(BaseModel)`: `address: str`, `emuia_id: int | None = None`, `lat: float | None = None`, `lng: float | None = None`, `source: str | None = None`. A validator requires exactly one of `emuia_id` or (`lat`, `lng`, `source`).
  - `load_base_coordinates(path: Path) -> list[BaseCoordinate]`, which rejects duplicate addresses.
  - `resolve_bases(bases: list[BaseCoordinate], addresses: pl.DataFrame) -> pl.DataFrame` with columns `base_address, lat, lng, coordinate_source` (`"emuia:<id>"` or the cited source). It raises `PrmRosterError` when an `emuia_id` is not in `addresses`.

- [ ] **Step 1: Write the failing tests.**
  - `test_emuia_entry_resolves_to_address_point`, `test_explicit_coordinate_needs_source`, `test_duplicate_address_rejected`, `test_unknown_emuia_id_raises`.
  - `test_district_number_kept` (EMUiA `"6"` gives `6`), and in reconcile: `district_number` is set on matched and municipal rows and null on osm rows.
- [ ] **Step 2: Run them and confirm they fail;** implement; run them and confirm they pass; run the backend checks.
- [ ] **Step 3: Commit.** `feat: add curated PRM base coordinates and EMUiA district numbers`

### Task 3: `places` writes PRM bases and `resources.parquet`; real data

**Files:**
- Modify: `backend/src/greenwave/etl/places_pipeline.py`, `backend/src/greenwave/etl/config.py` (`PRM_BASE_OSM_MATCH_RADIUS_M = 200.0`, approved D2), `backend/src/greenwave/artifacts.py` (`RESOURCES_FILENAME = "resources.parquet"`, added to `PLACES_ARTIFACT_FILENAMES`), `backend/src/greenwave/schemas/dispatch.py` (`StationSourceKind.PRM_BASE = "prm_base"`), `backend/src/greenwave/dataset/constants.py` (`SOURCE_KINDS` + `prm_base`; `resources.parquet` schema; step mapping), `backend/src/greenwave/dataset/loader.py` and `integrity.py` (load and check `resources.parquet`: every `station_id` exists and is AMBULANCE `prm_base`, codes are unique, `0 ≤ from < to ≤ 1440`), `backend/scripts/build_manifest.py` (entries for every file under `prm/`, source Małopolski Urząd Wojewódzki BIP, retrieved 2026-10-27), `backend/README.md`
- Modify: `backend/tests/support/pipeline_fixtures.py` (`make_raw` writes a two-team PRM xlsx via `write_xlsx`, plus `tests/support/prm_bases.json` used through a `curated_dir` parameter) and `tests/support/processed.py`
- Test: `backend/tests/etl/test_places_pipeline.py`, `backend/tests/dataset/test_loader.py`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `run_places(raw_dir: Path, processed_dir: Path, curated_dir: Path = BACKEND / "data" / "curated") -> PlacesSection`. The new report field is `PlacesSection.resources: ResourcesReport` with `plan_update, effective_from, source_sheets, teams_in_scope, bases, bases_matched_to_osm, teams_by_type: dict[str, int], teams_by_hours: dict[str, int], outside_simulation_area: list[str], replaced_by_prm: list[str]`.
  - `resources.parquet` columns per the spec.
  - Ambulance rows in `stations.parquet` are only `prm_base`, named by the published base address.

- [ ] **Step 1: Write the failing tests.**
  - `test_prm_base_matched_to_osm_ambulance_station` (OSM `emergency=ambulance_station` 120 m from the base gives one station with `osm_ref`, `source_kind == "prm_base"`).
  - `test_unmatched_prm_base_is_new_station`.
  - `test_hospital_sor_not_an_ambulance_origin` (it appears in `replaced_by_prm`).
  - `test_team_without_curated_base_reported_outside_area`.
  - `test_resources_written_and_deterministic`.
  - Loader: `test_resources_station_must_be_prm_base`, `test_duplicate_team_code_rejected`.
- [ ] **Step 2: Run them and confirm they fail;** implement; run them and confirm they pass; run the backend checks with real-data smoke deselected (the real data is rebuilt next).
- [ ] **Step 3: Real data.**
  - Rename `backend/data/raw/prm/annoucements` → `announcements`.
  - Fill `prm_bases.json`:
    - The 8 Kraków bases by `emuia_id`: look each one up in `addresses.parquet` by EMUiA label (for example "Leonida Teligi 8", "Józefa Wybickiego 3a", "Tadeusza Kościuszki 49", "Józefa Babińskiego 29", "Osiedle Złotej Jesieni 1", "Rynek Podgórski 2", "św. Łazarza 14", "Żaglowa 13A") and confirm the district number matches the Table 1a place.
    - Suburban `RO12/01` bases inside the map by OSM address point or building, citing `osm:<type>/<id>`.
  - Run `build_manifest.py` (with `--check`), then the full ETL chain (`profile` … `quality`), then the full backend tests.
  - Expected: `teams_in_scope ≥ 23`; all 23 Kraków codes are in scope.
- [ ] **Step 4: Commit,** in two commits:
  - `feat: make PRM bases the ambulance origins with a team roster`
  - `chore: record the PRM plan files and curated base coordinates`, covering `MANIFEST.json` and `prm_bases.json`.

**Milestone A checkpoint:** backend green on real data; report the counts.

## Milestone B: Eligibility and ranking (Tasks 4–6)

### Task 4: Team eligibility

**Files:**
- Create: `backend/src/greenwave/routing/team_eligibility.py`
- Test: `backend/tests/routing/test_team_eligibility.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class Team` with `team_code, team_type, station_id, base_address, area_teryt: tuple[str, ...], weekdays: str, ready_from_min: int, ready_to_min: int, season_from: str, season_to: str`.
  - `teams_from_frame(frame) -> tuple[Team, ...]`.
  - `on_shift(team: Team, at: datetime) -> bool`.
  - `ExclusionReason = Literal["OFF_SHIFT", "BUSY_OVERRIDE"]`.
  - `@dataclass(frozen=True) class TeamEligibility`: `eligible: tuple[tuple[Team, bool], ...]` (the bool is `assumed_free`) and `excluded: tuple[tuple[Team, ExclusionReason], ...]`.
  - `classify(teams, at: datetime, overrides: Mapping[str, Literal["free", "busy"]]) -> TeamEligibility`. Off shift is checked first.

- [ ] **Step 1: Write the failing tests.** `test_daytime_window_boundaries` (06:59 off, 07:00 on, 18:59 on, 19:00 off), `test_24h_team_always_on`, `test_weekday_filter`, `test_season_filter`, `test_busy_override_excluded`, `test_free_override_cannot_unshift`, `test_unknown_is_assumed_free`, `test_explicit_free_not_assumed`.
- [ ] **Step 2: Run them and confirm they fail;** implement; run them and confirm they pass.
- [ ] **Step 3: Commit.** `feat: classify PRM teams by shift and simulated availability`

### Task 5: Incident area locator

**Files:**
- Create: `backend/src/greenwave/places/incident_area.py`
- Modify: `backend/src/greenwave/etl/config.py` (`AREA_LOOKUP_RADIUS_M = 250.0`, labelled `PLACEHOLDER`)
- Test: `backend/tests/places/test_incident_area.py`

**Interfaces:**
- Produces:
  - `KRAKOW_DISTRICT_DELEGATURA: dict[int, str]`: 1–3 → `"1261059"`, 4–7 → `"1261029"`, 8–13 → `"1261049"`, 14–18 → `"1261039"`.
  - `DELEGATURA_NAMES = {"1261059": "Śródmieście", "1261029": "Krowodrza", "1261049": "Podgórze", "1261039": "Nowa Huta"}`.
  - `KRAKOW_DISTRICT_NAMES: dict[int, str]`, the 18 names from the Table 1a legend (for example `11: "Podgórze Duchackie"`), cited in a comment.
  - `@dataclass(frozen=True) class IncidentArea`: `teryt: str, delegatura_name: str, district_number: int, district_name: str`.
  - `IncidentAreaLocator.from_addresses(frame) -> IncidentAreaLocator`, an STRtree over rows whose `district_number` is not null.
  - `.locate(position: Position) -> IncidentArea | None`.

- [ ] **Step 1: Write the failing tests.** `test_each_district_maps_to_its_delegatura` (all 18), `test_nearest_address_district_used`, `test_point_beyond_radius_is_unknown`, `test_osm_only_rows_ignored`.
- [ ] **Step 2: Run them and confirm they fail;** implement; run them and confirm they pass.
- [ ] **Step 3: Commit.** `feat: locate an incident's PRM operating area from EMUiA districts`

### Task 6: Team-aware ranking with the area rule

**Files:**
- Create: `backend/src/greenwave/routing/team_ranking.py`
- Modify: `backend/src/greenwave/routing/station_ranking.py` (accept an optional `must_include: frozenset[str]` of station ids added to the shortlist. `rank_teams` passes the base with the lowest reversed-Dijkstra time among bases that have an **eligible** in-area team, chosen after eligibility filtering), `backend/src/greenwave/simulation_settings.py` (`area_preference_margin_seconds: float = Field(default=60, ge=0)`, approved D4)
- Test: `backend/tests/routing/test_team_ranking.py`, plus a `station_ranking` shortlist test

**Interfaces:**
- Consumes: Tasks 4–5, `rank_stations`, `StationNode`.
- Produces:
  - `SelectionReason = Literal["NEAREST", "IN_AREA_WITHIN_MARGIN", "NEAREST_OUTSIDE_MARGIN"]`.
  - `@dataclass(frozen=True) class RankedTeam`: `ranked: RankedStation, team: Team, assumed_free: bool, in_area: bool | None, other_eligible_team_codes: tuple[str, ...]`.
  - `@dataclass(frozen=True) class AreaRule`: `reason: SelectionReason, chosen_team_code: str, nearest_team_code: str, in_area_team_code: str | None, delta_seconds: float | None` (in-area total minus nearest total).
  - `@dataclass(frozen=True) class TeamRanking`: `incident_snap, candidates: tuple[RankedTeam, ...], area_rule: AreaRule | None, excluded, area: IncidentArea | None`.
  - `rank_teams(index, station_nodes, teams, incident, at, overrides, area, settings, time_mode: GreenWaveMode = GreenWaveMode.ENABLED, traffic_density_multiplier=1.0) -> TeamRanking`. An empty `candidates` means no eligible team. When eligible bases exist but none is reachable, it raises `NoStationReachable` (unchanged 422).
  - The D4 selection is a pure helper, `order_by_area_rule(candidates, margin_s, time_mode) -> tuple[tuple[RankedTeam, ...], AreaRule]`, comparing `ranked.total_seconds_for(time_mode)`.

- [ ] **Step 1: Write the failing tests.** Test `order_by_area_rule` with stub candidates:
  - `test_in_area_within_margin_chosen` (in-area +40 s gives in-area first and `IN_AREA_WITHIN_MARGIN`);
  - `test_out_of_area_more_than_margin_faster_chosen` (+75 s gives `NEAREST_OUTSIDE_MARGIN`);
  - `test_exactly_60_s_prefers_in_area`;
  - `test_fastest_in_area_is_nearest`;
  - `test_unknown_area_is_pure_nearest`;
  - `test_time_mode_disabled_uses_standard_totals` (in-area +40 s on standard times but +70 s on green-wave times with `DISABLED` gives `IN_AREA_WITHIN_MARGIN`);
  - `test_area_rule_reports_delta_and_codes`.

  Test `rank_teams` on the layout fixture network:
  - `test_shared_base_lists_other_eligible_codes`;
  - `test_all_busy_gives_no_candidates`;
  - `test_off_shift_team_excluded_with_reason`;
  - `test_in_area_base_beyond_shortlist_considered` (`dispatch_shortlist_size=1`);
  - `test_busy_in_area_base_not_forced_into_shortlist`;
  - `test_eligible_but_unreachable_raises`.
- [ ] **Step 2: Run them and confirm they fail;** implement; run them and confirm they pass; run the backend checks.
- [ ] **Step 3: Commit.** `feat: rank eligible ambulance teams with the 60 s area preference`

## Milestone C: Contract, API and quality (Tasks 7–8)

### Task 7: Contract (ADR 0014), `/resources` and the rank endpoint

**Files:**
- Modify: `backend/src/greenwave/schemas/dispatch.py` and `__init__.py` (models per the spec's Contract section), `backend/src/greenwave/api/dispatch.py` (the rank endpoint uses `rank_teams` for AMBULANCE, with `scenario_time or datetime.now(ZoneInfo("Europe/Warsaw")).replace(tzinfo=None, second=0, microsecond=0)`; new `GET /resources`), `backend/src/greenwave/main.py` or app state (load the teams and `IncidentAreaLocator` once at startup)
- Create: `docs/adr/0014-resource-aware-ambulance-dispatch.md`
- Regenerate: `contracts/openapi.json`, `frontend/src/types/api.generated.ts`, `frontend/src/data/stations.snapshot.json` (`uv run python scripts/export_station_snapshot.py`)
- Test: `backend/tests/api/test_dispatch_api.py`, `backend/tests/schemas/test_dispatch_schemas.py`

**Interfaces:**
- Produces the wire models: `RosterInfo {source, plan_update, effective_from, teams_in_scope}`, `TeamAssignment`, `ExcludedTeam`, `AreaRuleOutcome`, `IncidentAreaInfo {teryt, delegatura_name, district_number, district_name}`, `Team` (with `on_shift`), `ResourcesResponse {roster, at, teams}`, plus the new request fields (`scenario_time`, `time_mode`, `availability`) and response fields, all exactly as in the spec. `GET /resources` takes an optional `at` query (ISO local datetime).

- [ ] **Step 1: Write the failing tests.**
  - `test_resources_lists_teams_with_roster`;
  - `test_resources_on_shift_at_given_time` (`?at=2026-10-27T21:00` gives `K01 176` `on_shift == false`);
  - `test_rank_ambulance_returns_team_and_reason`;
  - `test_rank_echoes_scenario_time`;
  - `test_busy_override_moves_choice`;
  - `test_all_busy_returns_no_eligible_outcome` (200, `candidates == []`, `outcome == "NO_ELIGIBLE_RESOURCE"`, `excluded_teams` complete);
  - `test_fire_rank_unchanged` (no `team`, `area_rule` null, `outcome == "OK"`);
  - `test_rank_unreachable_still_422`;
  - schema: unknown `availability` value rejected.
- [ ] **Step 2: Run them and confirm they fail;** implement; write ADR 0014 (Status: Proposed); regenerate the contracts and the snapshot; run the backend checks and `cd frontend && npm run typecheck`, fixing fixtures only.
- [ ] **Step 3: Commit.** `feat: expose resource-aware ambulance ranking (ADR 0014)`

### Task 8: Quality check `prm_roster`

**Files:** Modify `backend/src/greenwave/etl/quality.py`; Test `backend/tests/etl/test_quality.py`.
- Check `prm_roster`, titled `Ambulance teams (PRM plan)`, status `info`.
- Metrics, exactly: `teams_in_scope`, `bases`, `teams_24h`, `teams_daytime`.
- Headline: `f"{teams:,} ambulance teams at {bases} bases from the Małopolska PRM plan (update {u}, effective {d}). {n} teams of the region are outside the simulated area."`
- Samples: up to 5 `"<base address>: <codes>"`, ordered by team count descending.

- [ ] **Step 1:** Write `test_prm_roster_summarises_report`. Run it and confirm it fails; implement; run it and confirm it passes; re-run the real `quality` step.
- [ ] **Step 2: Commit.** `feat: report the PRM roster in data quality`

## Milestone D: Frontend (Tasks 9–11)

### Task 9: Transport, state and copy

**Files:**
- Modify: `frontend/src/lib/transport/validate.ts` (`validateRank` handles the new fields, with 0–3 candidates; new `validateResources`), `frontend/src/lib/dispatch-adapter.ts` (`capabilities.resources: boolean`; `listResources(at: string)`), `frontend/src/lib/station-choice.ts` (`orderCandidates` keeps the backend order when the response has `area_rule`; `pageCandidate` defaults to the first candidate; a new `fastestCandidateId(candidates, mode)` puts the `Fastest` chip), `frontend/src/lib/transport/backend-dispatch-adapter.ts`, `frontend/src/lib/mock-dispatch.ts` (`resources: false`; `outcome: "OK"`), `frontend/src/lib/useIncidentDispatch.ts` (state `scenarioTime: string` defaulting to local now rounded to 5 min, and `availability: Record<string, "free" | "busy">`; setters re-rank and re-fetch `/resources?at=`; the request includes both plus `time_mode` from the page for AMBULANCE)
- Create: `frontend/src/lib/team-dispatch-copy.ts`
- Test: `validate.test.ts`, `backend-dispatch-adapter.test.ts`, `useIncidentDispatch.test.ts`, `team-dispatch-copy.test.ts`, `station-choice.test.ts` (`test keeps backend order for team ranking`, `test re-sorts fire candidates as before`, `test fastest chip on a later row`)

**Interfaces:**
- Produces:
  - `selectionReasonText(areaRule) -> string`, giving the spec's three lines with `<N>` = `Math.round(Math.abs(delta_seconds))`.
  - `exclusionText(team, reason) -> string`: "off shift (07:00–19:00)" or "marked busy".
  - `noEligibleText(time: string, offShift: number, busy: number) -> string`.
  - `rosterBadgeText(roster) -> string`: "Official PRM plan · update 2 · from 1 Sep 2026 · 37 teams".
  - `hoursText(team) -> "24 h" | "07:00–19:00"`.

- [ ] **Step 1: Write the failing tests** (the exact strings from the spec), run them and confirm they fail; implement; run them and confirm they pass; run the frontend checks.
- [ ] **Step 2: Commit.** `feat: carry scenario time and team availability in dispatch state`

### Task 10: Scenario time, availability panel and team ranking display

**Files:**
- Create: `frontend/src/components/hud/dispatch/ScenarioTimeInput.tsx`, `frontend/src/components/hud/dispatch/TeamAvailabilityPanel.tsx`, `frontend/src/components/hud/dispatch/ExcludedTeams.tsx`
- Modify: `frontend/src/components/hud/dispatch/StationRanking.tsx` (`Recommended` chip on the first row and `Fastest` on `fastestCandidateId`; team code and type chip, `In area` / `Outside area` chip, assumed-free badge, the reason line on the first row, the no-eligible empty state, the roster badge), `frontend/src/components/hud/DispatchForm.tsx` (render the new controls only when `vehicleType === "AMBULANCE" && capabilities.resources`)
- Test: `StationRanking.test.tsx`, plus new `TeamAvailabilityPanel.test.tsx` and `ScenarioTimeInput.test.tsx`; update snapshots only where these appear

- [ ] **Step 1: Write the failing markup tests:**
  - the tri-state toggle cycles unknown → free → busy → unknown and calls the setter;
  - an off-shift team is rendered disabled with "off shift";
  - the reason line text;
  - the excluded list;
  - the no-eligible state;
  - the badge "status unknown — assumed free in scenario".
- [ ] **Step 2: Run them and confirm they fail;** implement; run the frontend checks.
- [ ] **Step 3: Commit.** `feat: show PRM team eligibility and area choice in dispatch`

### Task 11: Acceptance on real data

- [x] **Step 1:** Run the backend and frontend checks, including the build.
- [x] **Step 2:** Run the ETL equivalence twice; outputs must be identical apart from the volatile keys.
- [x] **Step 3:** Playwright (`playwright-cli`, `http://localhost:3000`, output under `.tmp/playwright/`):
  1. Incident "Rynek Podgórski 2" at 10:00 gives a Podgórze-base team in area.
  2. Same incident at 21:00: K01 176 appears in excluded as "off shift (07:00–19:00)", and the chosen team has a reason line.
  3. Mark the chosen team busy: the choice changes and the excluded list shows "marked busy".
  4. Mark every in-scope team busy: the no-eligible state appears.
  5. Data Quality shows "Ambulance teams (PRM plan)".
- [x] **Step 4:** Report the counts, the rulings and the deferred minors; no push.

## Acceptance closeout — 2026-10-27

Tasks 1–10 were implemented in commits `77a3617` through `2cd5bcb`. Task 11 is now
complete on the real inputs; the earlier task checkboxes remain the original implementation
instructions, rather than a reconstructed record of their historical test-first runs.

- Raw manifest: `build_manifest.py --check` passes. The spreadsheet contains 149 teams,
  including all 23 Kraków teams. The rebuilt dataset contains 23 teams at 8 PRM bases
  (2 matched to OSM), 38 stations overall and 70,261 addresses. Types: 20 P2, 2 P3, 1 S.
  Hours: 19 teams work 24 h and 4 work 07:00–19:00. All 23 Kraków teams are in scope;
  72 other RO12/01 teams are reported outside the simulated area.
- Both full `etl_equivalence.py run` invocations completed. Comparison covers 25 entries:
  only raw `etl_report.json` differs; the report hash with volatile keys removed and every
  other artifact match. Rebuilt outputs were installed in `backend/data/processed/`.
- Backend: Ruff lint and formatting, mypy, and **1,511 tests pass**, including real-data smoke.
  Frontend: lint, typecheck, formatting, **1,143 tests**, and production build pass.
  OpenAPI matches the canonical schemas. The station snapshot was regenerated from real data
  (one floating-point coordinate changes in its last decimal place).
- Browser acceptance uses the real backend on port 8001 and frontend on `localhost:3000`:
  Rynek Podgórski 2 at 10:00 recommends K01 008 at the Podgórze base, in area. At 21:00,
  K01 176 is excluded as `off shift (07:00–19:00)` and the recommendation has a reason line.
  Marking K01 008 busy chooses K01 128 and displays `marked busy`. Marking all 19 on-shift
  teams busy displays `No eligible ambulance team at 21:00. 4 off shift, 19 marked busy.`
  Diagnostics → Data quality displays `Ambulance teams (PRM plan)`.
  Scripts, results and screenshots are under `.tmp/playwright/prm-acceptance/` (ignored).
- Fixed two review findings with RED→GREEN regressions: eligible teams without any routable
  base now produce `422 NO_STATION_REACHABLE`, with domain and API coverage; changing scenario
  time clears the previous roster, so failed refreshes cannot display stale shift flags.
- Rulings: retained the existing feature checkout and branch, following the repository Git rule.
  The existing 23-team/8-base curated scope is retained; uncurated regional teams are explicitly
  reported outside scope. The published motorcycle row K01 051 M is parsed for the complete
  149-row source roster and remains outside the dispatch scope. No live availability or real
  signal actuation was added.
- Final review found no remaining important issue. Deferred minors: none. No push.
