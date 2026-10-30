# Simulated ITS feedback validation — 2026-10-23

Specification: the internal development specification (omitted from this evaluation snapshot).
Implementation: four approved milestones on `codex/simulated-its-feedback`.
No physical signal connection, actuation, dependency or deployment change.

## Acceptance evidence

| Criterion | Evidence |
| --- | --- |
| Dispatch is pending, ordinary traffic stays NORMAL | `tests/simulation/test_its_feedback.py::test_request_does_not_clear_without_controller_feedback`; backend and mock browser scenario JSON |
| Controller report drives state and motion | `test_scripted_controller_holds_red_until_its_report_changes`; controller conflicting-yellow/missing-movement tests; UI request/report render test |
| Nominal/delayed/fault scenarios and one terminal | Controller scenario tests, session/API tests; browser NOMINAL pending tick17/accept18, DELAYED accept22, REJECTED18, NO_FEEDBACK timeout25 |
| Invalid/stale/wrong-run/closed-run work is inert | Ledger regression, isolated import/close tests, shared frontend lifecycle helper; adapter/reducer unknown high-sequence poisoning regression |
| Cascade/partial passage/expiry/missing movement | Controller tests, corridor/golden tests, signal-sync tests; late configured acknowledgement expires atomically without activating traffic |
| Playback invariance | `test_session.py::test_every_simulated_second_is_streamed_whatever_the_playback_speed` compares full traces at 1/2/5/10× in both modes; mock golden scenarios |
| Snapshot recovery and recordings | Browser offline REQUESTED tick17 -> latest ACCEPTED tick24; reducer snapshot/stale sequence tests; successful nominal mock comparison and seek; byte/frame limit and failed-recording tests |
| Both transports, six pages, simulation boundary | Four browser scenarios in each transport; `/`, enabled, standard, comparison, diagnostics, driver navigation; driver Stop/last-report; phone scenario selector |

Backend browser uses the existing processed dataset and Mogilska 97, with six route
intersections. A first attempted Floriańska 1 fixture had no intersections and was
replaced; the application was not modified to force a request.

Local browser evidence (ignored, retained in this checkout) is under
`.tmp/playwright/its-feedback/`: `backend-scenarios.json`, `mock-scenarios.json`,
`reconnect.json`, `stop-pending.json`, `supersede.json`, `comparison.json`, scripts and screenshots.
Browser automation used `@playwright/cli` through bash. It did not use MCP browser
control or DOM/accessibility dumps. Phase boundaries, exact expiry, and difficult
stop-line cases use deterministic automated fixtures instead of debug endpoints.

## Review and verification

Fresh branch review found two important cases: unknown high-sequence feedback could
starve valid feedback, and a configured delayed acknowledgement could activate an
expired hold. Both have failing-then-passing regressions. Browser inspection also
removed positive savings claims on ITS faults and clarified NORMAL as an ordinary
traffic report, independent of request status. A separate isolated controller run
caught an import-order cycle; a subprocess regression covers it.

Backend checks: Ruff lint/format, mypy and 958 pytest tests. Frontend checks: lint, generated
route typecheck, Prettier, 555 Vitest tests and production build. Canonical OpenAPI/TypeScript
were regenerated twice with identical hashes. Code graph refreshed after structural
changes. No real controller/network calls were introduced.

## Decisions and limits

- Work stayed on the requested existing branch; no new branch/worktree, push, merge or PR.
- The existing max-first-stop-TTI plus buffer hold calculation remains unchanged.
  Long multi-stop-line crossings can now explicitly fail with ITS_HOLD_EXPIRED.
  Old golden traces and estimate-equals-arrival expectations were updated for this
  approved behavior. No renewal or extra hold allowance was added.
- The synthetic browser controller preserves causal request/decision/report ordering;
  its route and motion model remain simpler than the backend's geographic engine.
- Browser phone emulation confirms selector access, not physical iOS/Android behavior.
- Reconnect is latest-snapshot recovery, not replay. History and recording limits remain.
- Estimates remain model baselines. There is no production ITS compatibility or guaranteed
  travel-time savings claim. ADR 0008 remains Proposed for human review.
