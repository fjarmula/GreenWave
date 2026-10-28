# Post-merge compatibility verification — 2026-10-25

Approved audit findings from `7deff49` are implemented on
`fix/post-merge-system-compatibility`.

## Changes and regression evidence

- `75df5d6`: Stop shares the lifecycle lock with pending plans; ended streams replay their
  latest authoritative snapshot before the terminal. Blocked single and pair planners,
  unknown IDs, completed pair members, and a real 1 m route finishing before subscription
  are covered. Original focused regressions failed before implementation.
- `a7a8074`: comparison Stop confirms unfinished local runs after HTTP success without
  depending on terminal SSE. Generation guards preserve newer runs. Arrival uses ARRIVED
  telemetry independently of recovery completion, route length sums all segments, and an
  ended dock no longer claims it is waiting. Six regressions failed before implementation.
- `f17b89b`: driver/phone details expose ITS feedback; summary and active settings disclose
  the effective scenario. Off-road results distinguish driving to the access point from
  estimated walking distance/time. Incident clearing invalidates late ranking responses.
  Seven presentation regressions and one ranking regression failed before implementation.

## Verification

- Backend: `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy`,
  `uv run pytest -q` — **1,042 passed**.
- Frontend: `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test` —
  **901 passed across 87 test files**; `npm run build` succeeds for all application routes.
- OpenAPI export and TypeScript regeneration produce no contract drift.
- Scoped backend, comparison and presentation reviews approved; final independent branch
  review found no important actionable findings.
- `graphify update .` refreshed the local graph after the additions.

Browser evidence (ignored): `.tmp/playwright/compatibility-fixes/`.

The local real backend was used for desktop/phone scenario selection, disabled NOMINAL
normalization and comparison Stop with terminal SSE callbacks deliberately suppressed.
Result: `Comparison stopped`, dock `Comparison ended`, without waiting for the watchdog.

Off-road visual acceptance used a deterministic simulated response fixture through the
existing frontend transport: 383 s driving plus 650 m / 464 s walking. Generic and comparison
results show the drive/access-point qualification and separate walk; comparison drive delta
remains 117 s. Phone control usability and no horizontal overflow were verified; screenshots
were inspected after entrance transitions completed.

The engine, motion, state, controller policy and engine golden fixture remain unchanged.
Fixed ITS hold expiry remains the pre-existing policy; no real signal actuation or new
runtime dependencies were added. This branch has not been pushed or merged.
