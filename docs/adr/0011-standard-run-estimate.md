# 0011: Exact standard-run estimate and the walk shown apart

- Status: Proposed
- Date: 2026-10-25
- Owners: @fjarmula @Piotrek406
- Supersedes: None (amends ADR 0006's rank contract additively)

## Context

The standard-traffic page showed the green-wave time before a run, and its live ETA counted
down `estimated_normal_time_sec` (car speeds x density plus 35 s per junction), not the
ambulance-without-priority run it shows. An off-road incident showed one drive + walk total
before start while only the drive is simulated. Design:
`docs/superpowers/specs/2026-10-25-post-merge-regressions-design.md` (D4, D5; findings B4, B5,
X2).

## Decision

Additive to contract v1; `schema_version` stays `"1.0"`.

- `standard_run_seconds(route, route_model, density, settings)` drives `move_one_second` in
  DISABLED mode against an untouched controller's ordinary programme queries until arrival and
  returns `arrived_at_s`. A disabled run never requests priority and the programme is
  deterministic from t = 0, so this equals the engine's disabled arrival exactly. A run that
  does not arrive within `ceil(distance / speed floor) + 10 000` s raises instead of returning a
  made-up value.
- `SimulationStartResponse.estimated_standard_time_sec: int >= 0` (both modes, rounded).
- `DispatchRankRequest.traffic_density_multiplier: float in [1.0, 3.0] = 1.0`;
  `RankedCandidate.standard_seconds: float >= 0` at that density. The backend order stays the
  green-wave total.
- `T_normal`, `estimated_normal_time_sec` and `current_time_saved_sec` keep their meaning; in a
  disabled run the KPI is labelled "vs normal traffic".
- Frontend: the station list's time, order and "Fastest" chip follow the page's mode
  (`/simulation/standard` standard, comparison both in backend order, otherwise green wave);
  with no explicit pick the default station is that order's first (the one marked "Fastest"),
  for the list, the map, the pre-flight and the start. The backend pre-flight shows the selected candidate's standard
  and green-wave times. A density change re-ranks 250 ms after the slider settles, keeps the
  pick, and discards stale responses. The disabled ETA
  counts down `estimated_standard_time_sec`. An off-road candidate reads
  `{drive} drive + {walk} on foot · {distance}` under its total; the driver ETA with an on-foot
  leg reads "ETA to access point".

## Consequences

- Each ranked station costs one more dry run (about 12 ms per route on the 40-route Kraków
  sample, at most 5 per rank). A start costs one.
- Standard and green-wave times can be equal (a route that meets no red light), and standard
  can be shorter (it spends no `D_min`); both are simulated estimates, not measured times.
- On the standard page the default station can differ from the green-wave page's for the same
  incident; each page starts from its own fastest unless the dispatcher picks.
- No real signal actuation; no new dependency.

## Alternatives considered

- A closed-form standard estimate (open road plus an expected red loss): rejected; it would not
  match the run, the whole point of the change.
- Reusing `estimated_normal_time_sec` for the standard page: rejected; it models car traffic,
  not the simulated ambulance without priority.

## Validation

- `backend/tests/simulation/test_standard_estimate.py` (equals the disabled engine run for green,
  yellow, red and unknown movements and a two-line junction; open road without junctions),
  `test_assembly.py`, `backend/tests/routing/test_station_ranking.py`,
  `backend/tests/api/test_dispatch_api.py`, `backend/tests/schemas/test_dispatch_schemas.py`.
- `frontend/src/lib/station-choice.test.ts`, `useIncidentDispatch.test.ts`,
  `StationRanking.test.tsx`, `KpiHeader.test.tsx`, `driver-status.test.tsx`, the dispatch form
  and dashboard markup snapshots.
- `backend/scripts/sample_runs.py --routes 40 --seed 11` at density 1.0 and 2.5:
  `docs/engineering/post-merge-regressions-verification.md`.
