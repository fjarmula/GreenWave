# Post-merge regressions and dispatch-time honesty: design

Status: approved by the human on 2026-10-25 (bug report + "work on all of those bugs" after the
investigation's recommendations). Branch: `fix/post-merge-regressions`.

## Findings this design resolves

| # | Finding | Root cause |
|---|---------|------------|
| B1 | ER Green Wave vehicle stops ~3 s at every junction (backend and mock). | Merge `ab4cf02` took the ITS branch's `motion.py`, `state.py`, settings, motion tests, golden and mock files wholesale, dropping `ccb96c0`, `6e138f9`, `c272ce7`. |
| B2 | Incident at or near a station dispatches from another station. | Node snapping: incident and station share a node, `plan_route` raises `NoRoute`, ranking drops the station by design (`station_at_incident`). |
| B3 | Standard-traffic red crossing crawls at ~2.9 km/h for ~37 s. | Flat `C_u = c·D_u·μ` with `D_u = 35 s` spread over a fixed 30 m. |
| B4 | Off-road incident shows one total (drive + walk) before start, only the drive runs. | Station row shows `greenwave + walk` with a single "incl. X m on foot" note. |
| B5 | Standard page shows the green-wave time. | `RankedCandidate` carries only `greenwave_seconds`; no pre-run standard estimate exists. |
| X1 | ~55–60 % of nominal ENABLED runs end `ITS_HOLD_EXPIRED` mid-route. | `hold_duration_sec = max(40, ceil(TTI)+5)`; TTI is open-road time to the first line and ignores every `D_min` up to and including the target and the distance to its last line. |
| X2 | Standard run ETA counts down the car-traffic estimate. | `etaSeconds` uses `estimated_normal_time_sec` (car speeds × μ + 35 s/junction), not the ambulance-without-priority run. |
| X3 | Merge dropped the tests guarding B1; `test_signal_sync` now asserts expiry. | Same merge. |

## Decisions

### D1 — Restore rolling green-wave junctions (B1, X3)
Re-apply `ccb96c0`, `6e138f9`, `c272ce7` in that order. Values as approved 2026-10-23:
`greenwave_approach_distance_m = 60`, `greenwave_min_rolling_speed_kmh = 15`. The safety hold at
the first stop line (wait until every route light there was shown green) stays. Regenerate the
backend golden and the frontend mock-stream snapshot.

### D2 — Hold covers the time the vehicle actually needs (X1)
Amends ADR 0008's "existing max-TTI-plus-buffer calculation stays"; no renewal or retry is added
and expiry stays a failed run.

```
release_i = open_road(distance → last_stop_line_m_i)  +  D_min × k_i
k_i       = count of unpassed route intersections j with first_stop_line_m_j ≤ first_stop_line_m_i
hold      = max(its_min_hold_seconds, ceil(max_i release_i) + its_hold_buffer_seconds)
```
`open_road` drives each route edge at its ambulance speed (`RouteTrack.open_road_seconds`).
Amended 2026-10-25 (human): the first cut divided by `v_avg`, which overestimates a slower road
ahead and left 9/40 sampled runs expiring. Amended again 2026-10-25 (human, review fix): `k_i`
also counts `j` with `first_stop_line_m_j < last_stop_line_m_i`, and `release_i` adds the
in-progress slowdown's `cautious_time_remaining_s` (conservative).
`expected_arrival_utc` is unchanged (nearest member, open-road TTI). The mock already uses its
exact timeline and is unchanged.

### D3 — Standard red crossing rolls, never below a floor (B3)
At a route stop line whose ordinary movement is not GREEN (unchanged sampling rule):
- `wait_s` = seconds until that movement is next GREEN in the ordinary programme (0 if GREEN);
  for an unknown movement (`None`) `wait_s = D_u`.
- Extra time `C = min(standard_clearance_factor × wait_s × μ, standard_max_red_loss_seconds)`.
- Crossing length `L = max(standard_crossing_distance_m, C / (1/floor − 1/limit))` where
  `limit` is the lowest ordinary limit over the edges the crossing covers (recomputed until
  stable) and `floor = standard_min_rolling_speed_kmh/3.6`. If `limit ≤ floor`, `C = 0` (drive at
  the limit; it is already slow). Amended 2026-10-25 (human): the first cut used the limit at the
  line only, and a crossing running onto a slower edge dropped to 9.46 km/h. Amended again
  2026-10-25 (human, review fix): only an edge at or below the floor at the line gives `C = 0`;
  a later one ends the crossing where it starts, with
  `C ≤ (slow_start − line) × (1/floor − 1/limit_before)`.
- New settings: `standard_min_rolling_speed_kmh = 10` (gt 0), `standard_max_red_loss_seconds = 15`
  (ge 0). Both finite. PoC assumptions, not measured values.
- Mock mirrors this with a fixed `wait_s = MOCK_STANDARD_CLEARANCE_SECONDS` (it has no
  seconds-until-green helper); documented as contract-level.

### D4 — Exact pre-run standard estimate (B5, X2)
`standard_run_seconds(route, route_model, density, settings) -> float`: drives
`move_one_second` in DISABLED mode against the pure ordinary programme until arrival and returns
`arrived_at_s`. It must equal a DISABLED engine run's `arrived_at_s` exactly (no ITS in disabled
mode; the programme is deterministic from t = 0). Measured cost ≤ 17 ms per route.
- `SimulationStartResponse.estimated_standard_time_sec: int ≥ 0` (round of the above).
- `RankedCandidate.standard_seconds: float ≥ 0`; `DispatchRankRequest.traffic_density_multiplier:
  float in [1.0, 3.0] = 1.0`. Additive; `schema_version` stays `"1.0"`.
- `T_normal`, `estimated_normal_time_sec` and the `current_time_saved_sec` KPI are unchanged
  (the product's normal-traffic baseline). The KPI header in DISABLED mode labels that number
  "vs normal traffic" instead of "Time saved".
- Frontend: the station list, its "Fastest" chip and its order use the page's mode
  (`/simulation/standard` → standard, otherwise green wave; comparison shows both). Backend
  pre-flight shows the selected candidate's standard and green-wave times (replaces "AFTER
  START"). `etaSeconds` uses `estimated_standard_time_sec` in DISABLED mode.

### D5 — Drive + walk shown apart (B4)
Station row with `on_foot`: primary value is the total; the line under it reads
`7:02 drive + 9:10 on foot · 650 m` (mode-specific drive). Driver ETA while running is
labelled "to access point" when `destination_on_foot` is set.

### D6 — On-site dispatch (B2)
A station whose node equals the incident's snapped node becomes a candidate instead of being
skipped: `on_site = true`, `greenwave_seconds = standard_seconds = distance_m = 0`,
`on_foot = {access_point: station.position, distance_m: straight(station, incident) × detour,
seconds: distance_m / walk speed}` (EPSG:2178 straight line, ADR 0009 factors). For an off-road
incident whose access set contains the station's own node, the on-site option is offered when it
is faster than the station's driven option or the driven option raises `NoRoute`.
`station_at_incident` stays in the schema and is always `null` (deprecated). Starting an on-site
candidate never calls the simulation API: the UI shows an on-site result card
("Incident at {station}: no drive needed. On foot about {m:ss} ({distance}) · simulated
estimate.") with "Back to setup". Mock: a station at distance 0 is an on-site candidate with a
0 m walk.

## Out of scope
Edge (point-on-road) snapping; ITS hold renewal; recalibrating `D_u = 35 s`; changing `T_normal`.

## Documentation
New ADR 0010 (D1–D3, amends ADR 0008 hold calculation), ADR 0011 (D4–D5, amends ADR 0006),
ADR 0012 (D6, amends ADR 0006 and 0009). Plans, in execution order:
`plans/2026-10-25-junction-motion-and-hold.md` (D1–D3), `plans/2026-10-25-mode-specific-estimates.md`
(D4–D5), `plans/2026-10-25-on-site-dispatch.md` (D6). `GreenWave_ARCHITECTURE.md` §3 models 2 and 3, the snapping rule (item 10) and the
dispatch section are updated (human informed 2026-10-25).
