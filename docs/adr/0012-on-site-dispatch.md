# 0012: On-site dispatch

- Status: Proposed
- Date: 2026-10-25
- Owners: @fjarmula @Piotrek406
- Supersedes: None (amends ADR 0006 ranking step 6 and ADR 0009)
- Amended (2026-10-28): `station_at_incident` is removed (it was always `null`); on site versus drive is decided on the request's `time_mode` totals.

## Context

An incident whose snapped node is a station's own node could not be routed (`plan_route`
raises `NoRoute`), so ranking reported that station as `station_at_incident` and dispatched the
next one, often minutes away. Off the network, a station whose node was the only access node
was dropped the same way. Design: `docs/superpowers/specs/2026-10-25-post-merge-regressions-design.md`
(D6; finding B2).

## Decision

Additive to contract v1; `schema_version` stays `"1.0"`.

- A station whose node equals the incident's snapped node is a candidate with
  `RankedCandidate.on_site = true` (default `false`), `greenwave_seconds = standard_seconds =
  distance_m = 0` and `on_foot = {access_point: station.position, distance_m, seconds}`: the
  EPSG:2178 straight line from the station to the incident x `on_foot_detour_factor` at
  `on_foot_speed_meters_per_second` (ADR 0009 placeholders). It ranks by its walk; ties by
  `station_id`.
- Off the network, every station whose node is an access node gets the same on-site option; it
  replaces the station's driven option when it is strictly faster or the station has none
  (driving wins ties).
- When every candidate is on site and the incident is off the network, `incident_snapped` is
  the best on-site station's node at its straight-line distance.
- `station_at_incident` stays in the schema, always `null`, marked deprecated.
- Frontend: the row reads "On site" with `on foot · {distance}` and one time in every mode; the
  start reads "Dispatch on foot"; starting shows "Incident at {station}" / "No drive needed. On
  foot about {m:ss} ({distance}) · simulated estimate." with "Back to setup" and never calls the
  simulation API (single run or comparison). The mock ranks a station at distance 0 as on site
  with a 0 m walk.

## Consequences

- An incident at a station's own node is answered by that station. An incident next to a
  station but on a different node still drives from it (a few seconds); this is the routable
  answer, not an on-site one.
- No route is fabricated: an on-site candidate has no simulation and no signal state.
- `sample_runs.py` starts from the first driving candidate and skips an all-on-site route.
- The straight-line walk ignores barriers, as in ADR 0009.

## Alternatives considered

- Keep skipping the station (`station_at_incident`): rejected; it dispatched a farther station.
- A zero-length simulated run: rejected; it would fabricate a route and a signal timeline.
- Point-on-edge snapping so near-station incidents route: out of scope (spec).

## Validation

- `backend/tests/routing/test_station_ranking.py` (on-site candidate, 0 m walk, two on-site
  stations tie by id, off-road driving wins when faster, station node as the only access node,
  brute-force oracle), `test_access.py` (`walk_between`), `backend/tests/api/test_dispatch_api.py`.
- `frontend/src/lib/station-choice.test.ts` (`isOnSite`, `onSiteResult`, `shownOnSite`),
  `StationRanking.test.tsx`, `OnSiteResult.test.tsx`, `DispatchForm.snapshot.test.tsx`,
  `mock-dispatch.test.ts`, `validate.test.ts`.
- Browser check: `docs/engineering/post-merge-regressions-verification.md`.
