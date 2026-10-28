# 0014: Resource-aware ambulance dispatch (PRM roster)

- Status: Proposed
- Date: 2026-10-27
- Owners: @fjarmula @Piotrek406
- Supersedes: None (amends ADR 0006 ranking for AMBULANCE; fire and police unchanged)

## Context

Every OSM ambulance station and every hospital emergency department (SOR) was an
always-available ambulance origin. The Małopolska PRM plan (update no. 2, 24 June 2026; Table 1a
effective 1 Sep 2026) publishes each ambulance team's base address, type, readiness hours and
operating area. Ranking buildings hides the published fact that a 07:00–19:00 team is not there at
21:00. Design: `docs/superpowers/specs/2026-10-27-resource-aware-ambulance-dispatch-design.md`
(decisions D1–D4).

## Decision

Additive in shape to contract v1; `schema_version` stays `"1.0"`. Pydantic models in
`backend/src/greenwave/schemas/` remain canonical.

- Data: the `places` step reads Tables 1a and 2a (standard-library xlsx reader), resolves base
  coordinates from the committed `data/curated/prm_bases.json` (EMUiA id, or a cited coordinate)
  and writes `resources.parquet` (one row per team in scope). Ambulance stations are PRM bases
  (`StationSourceKind.prm_base`); OSM ambulance stations and SORs without a base are no longer
  origins. An OSM ambulance station within 200 m of a base is reported as matched (D2).
- Eligibility (D1): off shift at the scenario time → excluded `OFF_SHIFT`; on shift and marked
  busy → excluded `BUSY_OVERRIDE`; on shift and unset → eligible with availability
  `assumed_free`, which the UI badges. A `free` override cannot bring a team on shift.
- Area rule (D4): an incident's area is the delegatura of the nearest EMUiA address within 250 m
  (placeholder), else unknown. The fastest in-area team goes first unless an out-of-area team
  arrives more than `area_preference_margin_seconds` (60 s) sooner. Totals are those of the
  request's `time_mode`. The best in-area base always joins the reversed-Dijkstra shortlist.
- Contract:
  - `DispatchRankRequest` gains `scenario_time` (naive local time; default the server's local
    now), `time_mode` (default `ENABLED`) and `availability` (team code → `free` | `busy`).
    Amendment (2026-10-28): `resource_aware` (default `true`); `false` ranks AMBULANCE PRM bases
    like fire and police (no shifts, overrides, area rule or team), and the UI exposes it as a
    "Team-aware dispatch" switch that hides the scenario time and team panel when off.
  - `DispatchRankResponse` gains `scenario_time`, `outcome` (`OK` | `NO_ELIGIBLE_RESOURCE`),
    `incident_area`, `excluded_teams`, `roster` and `area_rule`; `candidates` may hold 0–3 items.
    For AMBULANCE the first candidate is the recommended team, not necessarily the fastest.
  - `RankedCandidate` gains `team` (`TeamAssignment`) and `selection_reason` (first only).
  - New `GET /api/v1/resources?at=` returns the roster and each team's `on_shift` at `at`.
- No eligible team is a 200 with `outcome = NO_ELIGIBLE_RESOURCE` and the exclusions; eligible
  teams that cannot reach the incident stay a 422 `NO_STATION_REACHABLE`.
- Non-goals: no live availability or positions, no severity model (type is shown only), no
  reserve teams, no areas outside Kraków, no claim to reproduce official dispatch protocol.

## Consequences

- The dispatch form gains a scenario time, a team availability panel, exclusions and the reason
  for the choice; the frontend keeps the backend order for ambulances.
- `MANIFEST.json` gains the PRM plan files and `places` requires the plan spreadsheet; the full
  ETL chain must be re-run and the processed directory re-shipped.
- Station ids `STN-A-####` now number PRM bases by address, so older ambulance ids change.
- Only teams with a curated base are in scope: today the 23 Kraków-based teams at 8 bases. The
  OSM extract holds no suburban base, so suburban teams are reported outside the simulated area.
- An older client that assumes at least one candidate must handle the empty list.

## Alternatives considered

- Keeping SORs and OSM stations as origins next to PRM bases: a building without a team has no
  resource to send.
- Pure nearest eligible team (no area rule): ignores the published operating areas.
- A hard area rule: could send a team minutes slower than one next door.
- "No eligible team" as an error: would hide which teams were excluded and why.
- An xlsx library: one more dependency for two tables the standard library reads.
