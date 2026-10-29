# Simulated ITS feedback: behavior check and corrections

> Superseded in part (2026-10-30): rejection, timeout and hold expiry no longer end the run;
> they fall back per junction (ADR 0015,
> `docs/superpowers/specs/2026-10-29-per-junction-fallback-design.md`).

## Requirement and expected behavior

Check the four response presets shown in setup against the backend and mock controller.
Nominal accepts a pending request after 1 simulated second; delayed accepts after 5;
rejected declines after 1; no feedback leaves it pending until the engine's 8-second timeout.
Timing starts at request submission, not at run start, and playback changes wall-clock pacing
only. Acceptance starts clearing, while confirmed route-green requires legal signal transitions.
Rejection, timeout or hold expiry end the run visibly. Standard mode sends no priority requests.
Routes without controlled intersections need no ITS response. A request that is no longer
needed because all targets were passed is released without activating priority.

## Diagnosis and plan

The main backend and mock scenario paths implement these semantics. Two issues need correction:
the Polish selector leaves the rejection caption in English and omits its 1-second timing;
the mock controller puts passed pending targets into RECOVERY even though they never held
priority, unlike the backend. A partially passed group must also avoid activating those targets
when its remaining targets are later accepted.

1. Add failing regressions for Polish captions and pending/partial passage without priority.
2. Fix the mock recovery transition and add concise setup copy explaining simulated request
   timing, clearing and failure outcomes. Preserve accepted-target recovery for 15 seconds.
3. Verify exact decision times for all four scenarios in both transports, disabled-mode behavior,
   legal signal transitions and playback invariance. Run frontend checks, browser checks and an
   independent review. Commit on the dedicated branch.

No new API fields, dependencies, route selection, retry/fallback behavior or real actuation.

## Verification (2026-10-29)

- Backend exact timing regressions exercise nominal/delayed/rejected/no-feedback at 1× and
  10× playback: decisions occur 1/5/1/8 simulated seconds after request submission.
- Mock timing tests exercise the same matrix. Pending full/partial passage stays NORMAL;
  an accepted target recovers for exactly 15 seconds. Regressions failed before the fix.
- Frontend lint, typecheck, format check, all 1,266 tests and production build passed.
  Four setup markup snapshots were updated for the caption and explanatory copy; event
  and movement snapshots did not change.
- Backend Ruff lint/format and mypy passed; full pytest: 1,536 passed, one existing local
  dataset failure: `test_committed_curated_files_match_the_processed_report` in
  `tests/dataset/test_real_data_smoke.py`. The processed ETL report is missing curated-input
  hashes, as recorded for the preceding standard-mode fix; dataset artifacts are unchanged.
- Playwright CLI exercised all four choices in mock transport: nominal and delayed show
  acceptance; rejection and no response show the matching cancellation and no completed
  savings. Polish selector at 390 px shows `odrzucenie · 1 s` with no horizontal overflow.
  Evidence is in `.tmp/playwright/its-feedback-check/` (ignored).
- Independent code review found no actionable issues. Code graph refreshed.

Timings shown are the application's defaults. Backend simulation settings remain configurable;
this change does not expose or alter those settings or add any external controller connection.
