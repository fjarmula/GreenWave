# Post-merge regressions verification — 2026-10-25

Branch `fix/post-merge-regressions`. Spec:
`docs/superpowers/specs/2026-10-25-post-merge-regressions-design.md`.

## Plan 1: junction motion and ITS hold (D1–D3, ADR 0010)

### Changes

- `93ebc66`, `b69127b`, `a110afc`: cherry-picks of `ccb96c0`, `6e138f9`, `c272ce7` (rolling
  green-wave junctions, backend and mock). The `test_signal_sync` lines asserting hold expiry
  were dropped; the engine golden and the mock-stream snapshot were regenerated and reviewed.
- `05ee178`: the hold covers every `D_min` up to the farthest target's last stop line. Two tests
  that asserted expiry (`test_without_a_late_start...`, the NOMINAL comparison case) were
  restored to their pre-merge expectations.
- `d94f672`: the standard red crossing is wait-based, capped at 15 s and floored at 10 km/h
  (backend and mock).
- `aa83cde`: human-approved amendment after the first sampled run: the hold drives the route's
  edge speeds ahead (not the smoothed `v_avg`), and the crossing length comes from the lowest
  ordinary limit it covers.
- Review fix pass (human-approved): `55d489b` ends a standard crossing where an edge at or below
  the 10 km/h floor starts, keeping a capped extra time (before, any such edge inside the
  would-be crossing made a red light free); `5f9ddae` makes the hold also count junctions whose
  first line lies inside a multi-line target and the time an in-progress slowdown has left;
  the next commit makes `test_priority_is_held_while_the_ambulance_waits_at_the_stop_line` use
  a late-priority programme and assert that the ambulance waited (it was vacuous).
  Deferred: the DISABLED crossing is not cut at the destination, a green line inside a crossing
  drops its remaining extra time, and the mock ENABLED slowdown is not cut at the destination.

### Sampled acceptance

`uv run python scripts/sample_runs.py --routes 40 --seed 11` (and with `--cascade`), real
Kraków data, density 1.0, 0 routes skipped:

| Run | Mode | Terminals | Min pre-arrival speed | Other |
|-----|------|-----------|-----------------------|-------|
| no cascade | ENABLED | completed 40 | 18.9 km/h | 0 zero-speed ticks, 0 safety-hold ticks, max \|arrived_at − est_greenwave\| 0.000 s |
| no cascade | DISABLED | completed 40 | 10.0 km/h | 0 zero-speed ticks |
| cascade | ENABLED | completed 40 | 18.9 km/h | 0 zero-speed ticks, 0 safety-hold ticks, max \|arrived_at − est_greenwave\| 0.000 s |
| cascade | DISABLED | completed 40 | 10.0 km/h | 0 zero-speed ticks |

Before this plan: 24/40 (no cascade) and 22/40 (cascade) `ITS_HOLD_EXPIRED`, 0.0 km/h
junction stops, 2.9 km/h standard crawl. The review fix pass left every number in the table unchanged. The first cut of D2/D3 (spec formulas with `v_avg` and
the limit at the line) gave 9/40 expiries and a 9.0 km/h minimum; see ADR 0010.

### Browser check

Local backend + frontend (`NEXT_PUBLIC_SIMULATION_TRANSPORT=backend`), Floriańska 1, 10x
playback, `/simulation/green-wave` and `/simulation/standard`: both runs completed (2:57,
"Simulated run completed"); the polled speed readout showed no 0 km/h before arrival
(green wave 30.0–68.3 km/h, standard 30.0–68.3 km/h). This address met no red light in
standard mode, so the floor at red lights rests on the sampled runs above, not on the browser.
Evidence (ignored): `.tmp/playwright/post-merge-regressions/`.

### Checks

- Backend: `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy`,
  `uv run pytest -q` — 1,279 passed (1,282 after the review fix pass).
- Frontend: `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test`
  (905 passed, 87 files), `npm run build`. The review fix pass changed no frontend file.
- No schema change; OpenAPI export produced no drift.

## Plan 2: mode-specific estimates and walk breakdown (D4–D5, ADR 0011)

### Changes

- `28e5a2b`: `standard_run_seconds` (dry run of disabled motion) and
  `SimulationStartResponse.estimated_standard_time_sec`; the disabled ETA counts it down; the
  mock reports its own disabled timeline (mock snapshot: only the new field, 401 s).
- `98ab13c`: `DispatchRankRequest.traffic_density_multiplier` and
  `RankedCandidate.standard_seconds`; the frontend re-ranks on a density change.
- `fcb5178`: each page shows, orders and badges its own time; the comparison shows both; the
  backend pre-flight shows the candidate's two times; off-road rows split drive from walk; the
  disabled KPI reads "vs normal traffic"; the driver ETA reads "ETA to access point" with a walk.
- Next commit: `sample_runs.py` gains `est_standard`, `max |arrived_at - est_standard|` and the
  slowest estimate; this record and ADR 0011; `GreenWave_ARCHITECTURE.md` §3 model 3 and the
  dispatch section (human informed of architecture edits on this branch).

### Sampled acceptance

`uv run python scripts/sample_runs.py --routes 40 --seed 11` with `--density 1.0`,
`--density 2.5` and `--cascade`, 0 routes skipped:

| Run | ENABLED | DISABLED | Slowest standard estimate |
|-----|---------|----------|---------------------------|
| density 1.0 | completed 40, min 18.9 km/h, max \|arrived_at − est_greenwave\| 0.000 s | completed 40, min 10.0 km/h, max \|arrived_at − est_standard\| 0.000 s | 12.2 ms |
| density 2.5 | completed 40, min 18.9 km/h, 0.000 s | completed 40, min 10.0 km/h, 0.000 s | 12.1 ms |
| cascade | completed 40, min 18.9 km/h, 0.000 s | completed 40, min 10.0 km/h, 0.000 s | 12.0 ms |

The script also asserts `estimated_standard_time_sec == round(est_standard)` for every run.

### Browser check

Local backend + frontend (`NEXT_PUBLIC_SIMULATION_TRANSPORT=backend`), Chromium:

- Floriańska 1: green wave lists 02m 57s / 03m 20s / 04m 06s; standard lists 02m 57s /
  03m 40s / 04m 00s (Narutowicza's standard time is shorter than its green-wave one: no
  `D_min`); comparison lists `GW … Std …` for each. The winner meets no red light, so its two
  times are equal (02m 57s).
- Moving the density slider to 2.5 sent one rank request with
  `traffic_density_multiplier: 2.5`.
- Błonia (50.0597, 19.9091, pinned on the map), standard page: `05m 58s` with
  `02m 55s drive + 03m 03s on foot · 260 m`; the pre-flight shows standard 02m 55s, green wave
  02m 45s, "drive only, plus 03m 03s on foot".
- A standard run from Floriańska 1 (10x) reported `estimated_standard_time_sec` 177 and
  finished with elapsed 02:57; the KPI read "vs normal traffic". The driver page refuses
  disabled runs, so the disabled ETA has no on-screen consumer; it is covered by
  `driver-presentation.test.ts`.

Scripts (ignored): `.tmp/playwright/mode-estimates/`.

### Review fix pass (opus reviewer, human-approved decision on the default pick)

- `189c690`: the backend pre-flight reads "NO TIME SAVED" and `+{slower}` when the standard
  run is the shorter one (it printed `−-1m -26s` in the "go" colour).
- `312dd7f`: with no explicit pick, each page defaults to the station its own order marks
  "Fastest" (list, map, pre-flight, start); spec D4 and ADR 0011 amended.
- `13b21da`: a density change re-ranks 250 ms after the slider settles and keeps the pick.
- Browser (Floriańska 1, standard page): the checked row is the "Fastest" row; twelve arrow-key
  steps on the density slider sent one rank request (2.7) and kept the third-row pick.
- Deferred minors: the ranking dry-runs all 5 shortlisted stations though 3 are returned; the
  API density test is not density-sensitive at the default cap; the provider's density effect
  has no unit test; the comparison on-foot copy is not named in ADR 0011.
- Checks: frontend 933 passed (87 files), lint, typecheck, format, build; backend unchanged
  (1,297 passed).

## Plan 3: on-site dispatch (D6, ADR 0012)

### Changes

- `9036e6d`: ranking makes a station on the incident's node (or, off-road, an access node
  where walking beats driving) an on-site candidate; `RankedCandidate.on_site`;
  `station_at_incident` always `null`; mock and validator; `sample_runs.py` starts from the
  first driving candidate.
- `77b57c7`: "On site" row, "Dispatch on foot", the on-site result card on the single-run
  pages and the comparison; no simulation request.
- `244d50c`: an on-site row shows one chip ("On site"), so the station name is not cut.
- Next commit: ADR 0012, this record, `GreenWave_ARCHITECTURE.md` (dispatch section, item 10;
  human informed of architecture edits on this branch) and a superseded note in
  `docs/superpowers/specs/2026-10-19-incident-dispatch-design.md` step 6.

### Browser check

Local backend + frontend, Chromium; the incident pinned on Krakowskie Pogotowie Ratunkowe's own
snapped node (50.0601, 19.9507, about 47 m from the station point) on `/simulation/green-wave`,
`/simulation/standard` and `/compare`: KPR first, "On site", `00m 45s` with
`on foot · 60 m`; the start read "Dispatch on foot"; starting showed "Incident at Krakowskie
Pogotowie Ratunkowe · No drive needed. On foot about 00m 45s (60 m) · simulated estimate." and
sent no simulation request; "Back to setup" returned to the form. Floriańska 1 (between
stations) still drives from KPR (02m 57s). Addresses beside a station (Łazarza 14/16,
Jugowicka 10) snap to a neighbouring node and drive 7–9 s from that station: the nearby
station wins, but on site only applies to its own node (spec D6). Scripts and screenshots
(ignored): `.tmp/playwright/on-site/`.

## Whole-branch review and final acceptance

Opus reviewer over `d53334c..ab8bac9` (merge base with `main`): ready with fixes; no critical
findings. Fixed test-first:

- `0153e86`: the standard dry run is bounded by the route (every edge at its ordinary limit
  plus `standard_max_red_loss_seconds` per route stop line); a valid
  `speed_floor_meters_per_second = 0` divided by zero on every rank and start.
- `1262601`: the pre-flight shows only the walk for an on-site pick (it described two
  simulated runs of 00m 00s).
- `8fb00ec`: `GreenWave_ARCHITECTURE.md` model 3 and the hold text match the amended rules.

Deferred minors: the on-site-versus-drive choice and the top-3 cut use green-wave totals on
the standard page too; the plan-named comparison test is replaced by helper tests plus the
browser check; the all-on-site off-road `incident_snapped` path has no direct assertion.

Final checks: backend `ruff`, `ruff format --check`, `mypy`, `pytest` (1,304 passed);
frontend lint, typecheck, format, `npm test` (943 passed, 88 files), build; no OpenAPI or
generated-type drift. `scripts/sample_runs.py --routes 40 --seed 11`, with and without
`--cascade`, 0 skipped: ENABLED 40/40 completed, min 18.9 km/h, max
|arrived_at − est_greenwave| 0.000 s; DISABLED 40/40 completed, min 10.0 km/h, max
|arrived_at − est_standard| 0.000 s; slowest standard estimate 15.1 ms.
