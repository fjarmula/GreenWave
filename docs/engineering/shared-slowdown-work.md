# Shared slowdown correction and reproducible experiments

## Specification

Apply configured D_min (default 3 seconds) once per unique controlled intersection in both modes, independently of signal-dependent cautious crossing. Preserve priority requests, confirmation, holds and recovery; fallback must retain the unspent common delay and never restart it. Keep exact Standard dry-run timing and same-route savings, including negatives. No real signal actuation. Follow the user's 200-incident/two-seed, three fixed station, five-density experiment design; full run is left to the maintainer.

## Plan and acceptance

1. Archive exact submission history, README, deletions and modifications; verify bundle and remote tips; retire remote/local submission. Commit reusable preparation recipe on main.
2. Add failing motion regressions. Separate common rolling-window state from cautious-crossing state; start common windows in both modes, including fallback. Update dry-run bound, mock, behavioral explanations and affected tests. Verify backend/frontend suites and browser smoke; commit correction.
3. Maintain experiment runner and analysis outside temporary files. Test sampling, empty strata, failures and summaries; run a small actual-engine smoke, document commands/output provenance and limitations. Commit runner.
4. Review complete diff and all acceptance criteria, run required checks, record commits and handoff.

## Decisions and progress

- Work stays on main as explicitly requested; no branch creation, merge or main push.
- Initial worktree was clean. Original tips and verified backup are recorded in submission-preparation/archive/refs.json.
- Existing common slowdown and Standard cautious crossing share one motion budget. Standard never starts the former; fallback currently discards it. Separate budgets preserve common delay while retaining existing replacement semantics for cautious crossings at later stop lines.
- Reuse existing configuration names for compatibility; greenwave_approach_distance_m and greenwave_min_rolling_speed_kmh now govern both modes' common slowdown. No public schema change needed.
