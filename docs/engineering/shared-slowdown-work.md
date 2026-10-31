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

## Motion milestone verification

- Common and cautious budgets are independent; common delay starts once by controlled intersection ID, including STANDARD_FALLBACK. Origin stop lines now take an explicit first decision.
- Dry-run upper bound includes common delay; mock timelines preserve both budgets through rebuilds. Behavioral docs and snapshots updated; no schema or generated-contract change.
- Backend Ruff lint/format, strict mypy, and full pytest passed. Frontend lint/typecheck/format, all 1,310 tests and production build passed. New motion regressions include exact live and final same-route savings, green/red/yellow, adjacent and multi-line intersections, destination and origin boundaries, fallback and configurable delay.
- Independent motion review found no correctness defects; its requested cautious-leg speed-cap coverage was restored.
- Legacy browser smoke assumes a preselected incident and obsolete tick labels. The current Playwright CLI flow selected an incident on the map, completed GreenWave and Standard runs, and verified displayed saving = Standard minus actual (proof under .tmp/playwright/shared-slowdown-verified.json). No browser test source was changed.
- Proposed commit: `fix: share rolling intersection delay across simulation modes`.

## Experiment milestone verification

- Maintained runner and instructions reproduce sampling and fixed ranking/density choices. Reports retain partial failures, missing ranks and on-site walking separately; each mode selects its own fastest available station.
- Seven harness tests cover exact sampling, empty strata, negative/tied/faster counts, independent station winners including partial-mode failures, actual-engine/profile equality, common-budget consumption, arrival limits and on-site/missing-candidate CSV orchestration.
- Independent review identified on-site walking and partial-mode winner omissions. Both had failing regressions before correction and now pass.
- Complete checks: 1,579 backend tests, Ruff lint/format, strict mypy (application plus experiments); 1,310 frontend tests, lint/typecheck/format/build; agent cleanup, graphify automation and setup shell checks (with backend Python on PATH).
- A 12-pair/24-simulation smoke passed with no failures. Repeat smoke from the final clean revision before handoff; leave the full experiment to the maintainer. No pre-fix statistics or post-fix averages were added to README.
- Proposed commit: `feat: add reproducible paired simulation experiment runner`.

## Results publication plan (approved 2026-10-31)

Specification: publish the verified 200-incident post-fix results in README and bilingual /docs, link a durable REPORT.md, open a focused PR to main, then recreate submission from finalized main with identical current application source and no internal development artifacts.

1. Preserve a readable report under docs/results/2026-10-31/REPORT.md, including methodology, signed results, rank/density and controlled-intersection strata, provenance hashes and limitations. Raw execution outputs remain ignored.
2. Add matching concise README and PL/EN About-tab summaries using existing content blocks. Verify values, link and structural parity, then full quality checks and browser review.
3. Publish codex/shared-slowdown-results and open a PR to main. Preserve existing local main history; no force push or reset. Main must be finalized before submission publication.
4. In a separate checkout, apply the saved metadata manifest and adapt presentation/hook/test adjustments to current files; preserve current README plus evaluator notice. Compare protected application/data/contract/test/Docker/CI files byte-for-byte and run checks before publishing submission. No merging old submission history.

### Publication verification

- Verified report statistics, five density rows, all intersection strata, fastest-candidate counts and provenance hashes against the full clean-revision run. Raw outputs were not added to Git.
- Independent publication review found no correctness issues.
- Full backend checks passed (1,579 tests). Frontend content consistency test first failed before publication content was added; all 1,311 tests and production build now pass. The existing layout test caught an anonymous panel created by placing the report link after a standalone note; placing the link inside the results heading group preserves the established layout.
- Proposed commit: `docs: publish verified post-fix simulation experiment results`.
