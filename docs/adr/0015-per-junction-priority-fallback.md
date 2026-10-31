# 0015: Per-junction fallback for failed priority requests

- Status: Proposed
- Date: 2026-10-30
- Owners: @fjarmula @Piotrek406
- Supersedes: ADR 0008 (simulated ITS feedback) in part: its rule that rejection, timeout and
  hold expiry end the run with `ITS_REJECTED`, `ITS_TIMEOUT` or `ITS_HOLD_EXPIRED`.

## Context

A single rejected or unanswered priority request ended the whole simulated run, although the
vehicle could still reach the incident and every later junction could still be prioritised. The
dashboard therefore could not show what a dispatcher most needs: how much a partly failing corridor
still saves. Design: `docs/superpowers/specs/2026-10-29-per-junction-fallback-design.md`.

## Decision

Additive to contract v1; `schema_version` stays `"1.0"`.

- Request status, intersection signal state and crossing strategy are separate axes. A failed
  request (`REJECTED`, `TIMED_OUT`, `EXPIRED`) puts its unpassed targets into
  `CrossingStrategy.STANDARD_FALLBACK` for the rest of the run. The run continues, its mode never
  changes and every other junction keeps requesting priority. A grouped request fails as one.
- Fallback junctions are crossed by disabled-mode rules (ordinary programme at each route stop
  line). A hold waiting at the line ends and decides at release. Following the shared-delay
  correction, both modes retain the common slowdown remainder independently of cautious crossing;
  it is never omitted, erased by green, or restarted by fallback. Failed targets are never re-requested, never shown
  as prioritised and never enter RECOVERY.
- On acknowledgement timeout the engine emits the correlated `TIMED_OUT` feedback and withdraws the
  request from the controller; the withdrawal reserves the next number in the run's single
  feedback sequence. Late feedback for a failed request is ignored.
- `ItsScenario.MIXED` draws each request's outcome from the validated `its_outcome_seed` and the
  request's sorted target ids (FNV-1a 32-bit with the MurmurHash3 `fmix32` finaliser, top two
  bits). Presets are unchanged; signal colours are never randomised.
- Telemetry: `IntersectionTelemetry.crossing_strategy` (null in disabled runs) and
  `SimulationCompletedEvent.fallback_intersection_ids`. The `ITS_*` cancel reasons stay valid but
  are no longer emitted.

## Consequences

- Rejected and timed-out runs now complete and report a saving, possibly zero or negative, that
  includes every waited and fallback second. Clients must not expect an `ITS_*` cancellation.
- Older clients ignore the additive fields; a client validating `ItsScenario` strictly must accept
  `MIXED`.
- The mock transport mirrors the behaviour, the hash and the fields.

## Alternatives considered

- Keep cancelling the run: hides the partial benefit and the realistic recovery path.
- Retry a failed request: invents protocol behaviour the controller contract does not define.
- Switch the whole run to standard mode on the first failure: penalises junctions that would still
  grant priority.

## Validation

`backend/tests/simulation/test_priority_fallback.py` (rejection, timeout while held, hold expiry,
downstream priority, grouped failure, playback invariance, seed validation, late acceptance),
updated session and golden tests, and the mock tests in `frontend/src/lib/mock-its-controller.test.ts`
and `frontend/src/lib/its-outcome.test.ts`.
