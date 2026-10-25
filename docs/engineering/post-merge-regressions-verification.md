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
junction stops, 2.9 km/h standard crawl. The first cut of D2/D3 (spec formulas with `v_avg` and
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
  `uv run pytest -q` — 1,279 passed.
- Frontend: `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test`
  (905 passed, 87 files), `npm run build`.
- No schema change; OpenAPI export produced no drift.
