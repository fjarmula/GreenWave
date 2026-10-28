# 0010: Rolling junctions, hold coverage and the floored standard crossing

- Status: Proposed
- Date: 2026-10-25
- Owners: @fjarmula @Piotrek406
- Supersedes: None (amends ADR 0008's hold calculation and ADR 0003 D17's TTI basis)

## Context

Merge `ab4cf02` dropped three approved commits (`ccb96c0`, `6e138f9`, `c272ce7`): the
ER Green Wave vehicle again stopped about 3 s at every junction, backend and mock alike.
The ITS hold kept ADR 0008's "max TTI plus buffer" estimate: TTI is the open-road time to
the first stop line at the smoothed speed, so it ignored every `D_min` up to the target, the
distance to a multi-line target's last line and a slower road ahead. Sampled on the real
Kraków network (40 routes, seed 11) 24 of 40 nominal runs ended `ITS_HOLD_EXPIRED`.
The standard-traffic crossing spread `c x D_u x mu` (35 s at mu 1) over a fixed 30 m, a crawl
of about 2.9 km/h for about 37 s. Design: `docs/superpowers/specs/archive/2026-10-25-post-merge-regressions-design.md`
(D1-D3).

## Decision

- **Rolling junctions (D1).** The three commits are re-applied. ER Green Wave spends each
  `D_min` as a rolling slowdown over `greenwave_approach_distance_m` (60 m) before the first
  stop line, never below `greenwave_min_rolling_speed_kmh` (15 km/h), continuing past the
  line when needed and cut at the destination; the trip still takes `T_greenwave`. The safety
  hold at the first stop line (leave only once every route light there was shown green) stays.
- **Hold coverage (D2).** For each target `i`:
  `release_i = open_road(distance -> last_stop_line_m_i) + D_min x k_i + r`, where `open_road`
  drives each route edge at its ambulance speed, `k_i` counts unpassed route intersections
  whose first stop line is at or before target `i`'s or before its last stop line, and `r` is
  the extra time a slowdown in progress has still to spend. `hold = max(its_min_hold_seconds,
  ceil(max_i release_i) + its_hold_buffer_seconds)`; the contract floor of 40 s stays.
  `expected_arrival_utc` is unchanged (nearest member, open-road TTI). No renewal or retry is
  added; expiry stays a failed run (ADR 0008).
- **Floored standard crossing (D3).** At a non-green route line: `wait_s` = seconds until the
  ordinary programme turns that movement green (`D_u` when unknown);
  `C = min(standard_clearance_factor x wait_s x mu, standard_max_red_loss_seconds)`;
  `L = max(standard_crossing_distance_m, C / (1/floor - 1/v_min))`, `v_min` being the lowest
  ordinary limit over the edges the crossing covers (recomputed until stable). An edge at or
  below the floor at the line gives `C = 0`; one further on ends the crossing where it starts,
  with `C` capped at `(slow_start - line) x (1/floor - 1/v_min)` so the edges before it keep the
  floor. New settings `standard_min_rolling_speed_kmh = 10` (gt 0) and
  `standard_max_red_loss_seconds = 15` (ge 0), both finite PoC placeholders. The mock mirrors
  this with the fixed `MOCK_STANDARD_CLEARANCE_SECONDS` as its wait (contract level).
- Non-goals: hold renewal, recalibrating `D_u`, changing `T_normal`.

## Consequences

- Nominal green-wave runs complete; holds are longer (for example 44 -> 46/49 s in the engine
  golden, 55 -> 61 s in the architecture example) but still simulated and bounded.
- The hold no longer depends on `v_avg`; the smoothed speed still drives the TTI thresholds and
  `expected_arrival_utc`.
- Standard-traffic runs lose at most 15 s per red crossing and roll at 10 km/h or more, except on
  an edge whose ordinary limit is itself at or below 10 km/h. Standard trip times shrink; the
  `current_time_saved_sec` KPI against `T_normal` is unchanged in meaning.
- Spec D2/D3 were amended during implementation (human-approved 2026-10-25): the first cut used
  `v_avg` and the limit at the line, which left 9/40 expiries and 9.0 km/h dips on real data.
- No contract change; no real signal actuation; no new dependency.

## Alternatives considered

- Keep the smoothed speed (`v_avg`) for the hold: rejected; it overestimates a slower road ahead
  (route 1 of the sample: 24.6 m/s assumed, 18.1 m/s driven, expired 9 m short).
- Hold renewal or retry: rejected by ADR 0008; it would hide a too-short estimate.
- Limit at the stop line only for `L`: rejected; a crossing running onto a slower edge dropped to
  9.46 km/h.
- Recalibrating `D_u = 35 s`: out of scope; the cap bounds its effect on one crossing.

## Validation

- `backend/tests/simulation/test_dispatch.py` (every `D_min` to the farthest target, last stop
  line of a multi-line target, passed junctions, route speeds ahead, minimum hold).
- `backend/tests/simulation/test_motion_modes.py` (rolling slowdown and safety hold, tight hold
  outlasts the slowdowns, `standard_crossing`, floor on every disabled tick, crossing onto a
  slower edge), `test_phases.py` (seconds until green), `test_route_track.py`,
  `test_signal_sync.py`, `test_session.py`, `test_engine.py`, the engine golden.
- `frontend/src/lib/mock-session.test.ts` and the mock-stream snapshot.
- `backend/scripts/sample_runs.py --routes 40 --seed 11` with and without `--cascade`:
  `docs/engineering/history/post-merge-regressions-verification.md`.
