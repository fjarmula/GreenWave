# 0009: On-foot access to off-road incidents

- Status: Proposed
- Date: 2026-10-24
- Owners: @fjarmula @piotr-lorek
- Supersedes: None (amends ADR 0003 and ADR 0006 additively)

## Context

An incident more than `max_snap_distance_meters` (150 m) from a routable node was rejected with
`DESTINATION_OFF_NETWORK`. Measured on the snapshot, the Błonia and Park Jordana interiors contain
only `footway` / `path` / `steps` ways: no track and no emergency-tagged way. Making tracks and
emergency ways routable (spec C, `backend/README.md` "access ways") therefore fixes forest and
outskirts locations but not Błonia (50.0597, 19.9090), which stays off the network. A crew
reaches such incidents by driving to the nearest practical point and walking the rest
(design `docs/superpowers/specs/archive/2026-10-24-dispatch-access-and-map-framing-design.md`, section D).

## Decision

Additive to contract v1; `schema_version` stays `"1.0"`. Pydantic models in
`backend/src/greenwave/schemas/` remain canonical.

- An incident that snaps normally (≤ `max_snap_distance_meters`) is unchanged.
- Otherwise the destination becomes an **access node**: a main-component (snap-set) node whose
  on-foot distance to the incident is at most `max_on_foot_meters` (800 m, inclusive). On-foot
  distance = straight line (EPSG:2178) × `on_foot_detour_factor` (1.3); on-foot time = distance /
  `on_foot_speed_meters_per_second` (1.4). All three are PoC placeholders
  (`GREENWAVE_SIM_MAX_ON_FOOT_METERS`, `GREENWAVE_SIM_ON_FOOT_DETOUR_FACTOR`,
  `GREENWAVE_SIM_ON_FOOT_SPEED_METERS_PER_SECOND`).
- The access node is chosen per origin to minimise ambulance drive time + on-foot time (ties by
  node key), never the origin's own node. It is not the nearest node by straight line.
- No access node within the limit → 422 `DESTINATION_OFF_NETWORK` with the message
  `Incident is farther than 800 m on foot from any vehicle access point` (the number comes from
  the setting).
- `plan_route` owns the fallback, so `/simulation/start`, `/simulation/compare/start` and
  `/dispatch/rank` behave the same. The client keeps sending the incident position.
- Ranking seeds one reversed Dijkstra at every access node with its on-foot seconds (on-road: one
  seed at 0, as before) for the shortlist, then runs the real pipeline per station; candidates are
  ordered by `greenwave_seconds + on_foot.seconds`.
- Contract: new `OnFootLeg {access_point: Position, distance_m ≥ 0, seconds ≥ 0}`;
  `RankedCandidate.on_foot: OnFootLeg | null = null`;
  `SimulationStartResponse.destination_on_foot: OnFootLeg | null = null`. For an off-road
  incident, `destination_snapped` / `incident_snapped` is the access node, with `snap_distance_m`
  the straight-line distance.
- Non-goals: origins never use the fallback (`ORIGIN_OFF_NETWORK` is unchanged); no pedestrian
  routing graph.

## Consequences

- The simulation ends at the access node. `time_saved` and both estimates cover the drive only;
  the walk is identical in both modes and is shown separately (ranking sub-line
  `incl. {distance} on foot`, a dotted beacon-coloured connector on the map, the driver terminal
  line `Arrived at access point in {duration} · {distance} on foot`).
- The straight-line walk ignores barriers (river, rail, fences, walls); an access node across the
  Vistula can be chosen. Documented, not modelled.
- `plan_route` for an off-road incident runs one extra single-source Dijkstra from the origin,
  O((V + E) log V) on the ~36k-node graph; ranking replaces its single-source reversed Dijkstra
  with a seeded one of the same complexity.
- Additive fields: older clients ignore them; the frontend validator accepts them absent, `null`
  or valid.
- The rank error copy changes to `No vehicle access within 800 m of this location`.

## Alternatives considered

- **Nearest node by straight line**: simplest, but it can send a crew to the far side of a park
  when a faster road ends a little farther away; rejected.
- **Raise the snap limit**: silently treats a long walk as a drive and hides it from the
  dispatcher; rejected.
- **A pedestrian routing graph** (footways, paths, steps): models barriers, but it needs a second
  graph, its ETL and validation; out of scope for the PoC.

## Validation

- `backend/tests/routing/test_access.py` (inclusive limit, walk cost, seeded Dijkstra equals
  networkx for one seed, best-access tie and exclusion rules).
- `backend/tests/routing/test_planner.py` (fastest total not nearest, origin on an access node,
  on-road routes unchanged, off-road origins still rejected).
- `backend/tests/routing/test_station_ranking.py` (order by total, brute-force agreement,
  unreachable access nodes skip a station).
- `backend/tests/api/` (rank and start return the leg; comparison members share the access node;
  the 422 message) and the frontend validator, ranking, connector, palette and driver-status tests.
- Browser check at Błonia centre on the rebuilt data (`.tmp/playwright/p8/`).
