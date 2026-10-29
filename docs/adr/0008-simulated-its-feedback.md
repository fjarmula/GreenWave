# 0008: Simulated ITS request and feedback

- Status: Proposed
- Date: 2026-10-23
- Supersedes: amendments to ADR 0003 D2/D3/D16/D18/D19

## Context

Previously the engine changed signal state and only then logged dispatch through a
record-only gateway. The dashboard could show priority green without a controller
report. The approved specification requires a causal boundary without adding real
actuation, a network adapter or a second service.

## Decision

Use a fresh deterministic in-process simulated ITS controller per run. The engine
owns motion, observations, one-hop request selection, a bounded correlated ledger,
timeout detection and telemetry projection. The controller owns decisions, targets,
the existing phase programme, shown heads and complete reported snapshots.

Submission cannot return acceptance or mutate reported traffic. An engine step moves
under its previous confirmed report, advances the controller, validates ordered
feedback, checks acknowledgement timeouts, submits new requests and emits a tick.
Nominal/delayed/rejected decisions occur after 1/5/1 simulated seconds; no-feedback
times out after 8. Valid deadline feedback wins over timeout. Configuration validates
normal <= delayed < timeout and normal >= 1. Playback affects emission pacing only.

Acceptance starts CLEARING; TTI <= 25 allows targeting green. Report PRIORITY_GREEN
only with supported route indications all green after legal transitions. Missing
movements remain CLEARING. Disabled crossing retains its pure exact fractional-time
ordinary programme query. Dispatch selection retains 40 s/250 m one-hop rules and
own-TTI ties. No fifth traffic state is introduced.

Requests use `(simulation_id, message_id)` and a monotonic feedback sequence per run.
Passage releases each target, while a group releases only after all pass. Early
passage prevents late activation. The existing hold duration is enforced from
submission, passage at expiry wins, and no automatic renewal/retry is added.
Rejection/timeout/expiry produce final diagnostic tick then one ITS_REJECTED /
ITS_TIMEOUT / ITS_HOLD_EXPIRED cancellation. Close on every terminal, idempotently.
(Proposed superseding change: ADR 0015 replaces this cancellation with per-junction fallback.)

Add ITS_FEEDBACK to the stream. Feedback precedes dispatch precedes tick precedes
terminal. SSE id remains tick. Self-contained ticks carry request snapshots and
observation time, so dropped feedback and reconnect-at-now reconcile without replay.
Frontend sequence guards are independent of tick/dispatch guards. Record feedback
bytes, reject failed comparisons, and replay stored snapshots within existing bounds.

The browser's synthetic controller uses the same causal separation and scenarios,
with synthetic geometry and a simpler motion model. UI labels request status,
reported traffic and unavailable/retained observations separately. All six routes
share the root runtime; the driver opens no extra subscription.

## Consequences

ADR 0003 D16/D18 selection no longer means entering confirmed CLEARING immediately;
D2 gains feedback/fault reasons and D3/D19 gain ordering/snapshot semantics. Existing
hold estimates can expire on long multi-line intersections or controller waits;
this is an explicit failed run, never silent renewal or claimed savings. Model
estimates are not guaranteed measured trip times. Canonical Pydantic models generate
OpenAPI and TypeScript; schema_version stays 1.0 with compatible defaults.

There are no outbound ITS calls, physical commands, new dependencies or production
ITS compatibility claims. A future network adapter needs a separately approved
contract and safety/reliability design. This ADR remains Proposed pending human review.

## Validation

- backend/tests/schemas/test_its_feedback_schemas.py
- backend/tests/its/test_controller.py
- backend/tests/simulation/test_its_feedback.py and test_session.py
- frontend/src/lib/its-feedback.test.ts and mock-its-controller.test.ts
- frontend/src/lib/comparison/recording.test.ts
- frontend/src/components/hud/ItsFeedbackStatus.test.tsx and driver status test
- Local browser evidence: .tmp/playwright/its-feedback/ (ignored).
