# Standard mode and the savings baseline

## Requirement and diagnosis

Standard mode must show its own simulated travel time without a Green Wave savings claim.
The selected station's estimate, start response, completed standard run, and baseline used
for Green Wave savings must describe the same route and standard motion at the selected density.
Drive and on-foot estimates stay separate. All values remain simulated.

The pre-flight component did not receive the selected mode. Backend pre-flight already used
an exact disabled-motion dry run, but telemetry and completed summaries still used the older
normal-traffic formula. Mock pre-flight also used that formula instead of its disabled timeline.

## Plan and acceptance

1. Reproduce both defects with failing regression tests.
2. Reuse the standard-motion dry run as a distance/time profile. Compare elapsed time at the
   same distance; standard runs report zero savings. At arrival subtract displayed rounded
   trip times so the result agrees exactly with the standard and Green Wave totals.
3. Use the disabled timeline for mock pre-flight and mock savings too. Hide savings and
   Green Wave estimates throughout standard-mode setup, live telemetry and finished summaries.
   Preserve both estimates in Green Wave and comparison setup. Translate new copy into Polish.
4. Run backend/frontend checks, browser verification, review the diff, then commit locally.

The normal-traffic estimate remains in the existing API for compatibility; it is no longer the
savings baseline. No new fields, dependencies, routing policy or signal actuation are introduced.
Live baseline times are interpolated between standard dry-run samples (one simulated second);
arrival uses the exact standard total. The profile is built once per engine, with linear
planning time/storage in standard trip seconds and logarithmic lookup per telemetry tick.

## Review follow-up

Independent review found no introduced regressions. It identified a pre-existing rounding edge:
Python rounds exact half-seconds to even, JavaScript rounds them up. Backend pre-flight and
station drive times now follow Python's rounding, with regression cases for both even/odd ties.

## Verification (2026-10-29)

- Frontend: lint, generated route types/TypeScript, format check, 1,254 tests and production build pass.
- Backend: Ruff lint/format and mypy pass; full pytest: 1,528 pass, one local dataset failure:
  `tests/dataset/test_real_data_smoke.py::test_committed_curated_files_match_the_processed_report`.
  The existing processed `etl_report.json` has no `curated_sha256` entries for
  `data/curated/prm_bases.json` and `data/overrides/roundabouts.json`. These inputs and their
  ETL report are outside this fix. All simulation regressions and the engine golden pass.
- Six real Kraków route pairs (two incidents, densities 1.0/1.5/3.0, cascade enabled): ranked
  standard estimate = start estimate = standard completion; Green Wave savings = displayed
  standard total minus displayed Green Wave total, including zero and negative results.
- Playwright CLI: mock standard pre-flight 02m 49s = finished 02m 49s, with no saving card,
  live saving KPI or completed saving row. Polish phone result at 390 px also matches and
  has no horizontal overflow. Screenshots and browser results are in `.tmp/playwright/`.
- Independent review, including the rounding follow-up: no actionable findings.
- Golden event changes are restricted to `current_time_saved_sec`; movement, elapsed time,
  controller feedback and signal events are preserved. Local graph refreshed.
- Playwright CLI Green Wave: pre-flight standard 02m 49s, Green Wave 02m 24s; completed
  standard baseline 02m 49s, travel 02m 24s, saved 00m 25s.
