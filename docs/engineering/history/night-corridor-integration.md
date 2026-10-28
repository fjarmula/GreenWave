# Night Corridor integration with main

## Scope and acceptance

Keep main's simulated ITS controller, engine, motion, signal synchronization and frozen
engine-event characterization. Keep the feature branch's glass UI, driver sheet, station
choice, map framing and concurrent live comparison. Retain the additive routing/access
and comparison API support consumed by that frontend. All signals remain simulated.

Integration steps: reconcile the engine/session boundary; regenerate canonical contracts;
verify controller-failure behavior in both transports and UI; run both quality suites,
production build and browser smoke; merge only after PR checks pass.

## Conflict diagnosis and resolution

The branches changed the same lifecycle, signal UI and generated types. The feature branch
also replaced sequential recording/replay with two simultaneous streams, while main added
feedback handling to the deleted recorder. Choosing either side globally would discard
required behavior. Main's motion/state files and engine golden fixture are retained
unchanged; feature rolling-slowdown changes are excluded.

Each comparison member uses main's independent engine/controller. The shared session loop
advances unfinished members once per simulated second. Stop and supersession close both;
failed second planning closes the already planned first engine. The selected ITS scenario
applies to the enabled run; the standard baseline normalizes to NOMINAL.

ITS failures are shown immediately in the affected pane, suppress race-leader wording,
and produce an unsuccessful comparison after the other member ends. Late stop failures
cannot overwrite a newer comparison. Mock transport emits feedback before dispatch/tick,
reports ITS cancellation and closes each controller. Driver ordinary/recovery states use
neutral wording rather than inventing a red indication.

The feature's inclusive on-foot limit also needed a numerical fix: geographic projection
round trips displaced the exact boundary by 3.58e-10 metres. The spatial radius allows
1e-8 metres of rounding error; the existing test still rejects a point 0.01 metres outside.

## Verification

- Backend: Ruff lint/format, mypy and full pytest suite, including main's unchanged engine
  golden and real-engine paired NOMINAL/REJECTED/NO_FEEDBACK isolation tests.
- Frontend: ESLint, generated Next/TypeScript checks, Prettier, full Vitest suite and
  production webpack build with the pinned package-lock dependencies.
- Canonical OpenAPI and TypeScript are regenerated from the combined Pydantic schemas.
- Browser evidence is kept locally under `.tmp/playwright/merge/` (ignored).

Main's hold-expiry policy is preserved: even a nominal scenario may fail if the simulated
vehicle cannot pass within the requested hold. Such runs are never presented as completed
savings. Dependency installation reports existing package advisories; dependency upgrades
are outside this merge resolution.
