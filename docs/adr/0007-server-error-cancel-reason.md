# 0007: Server-error cancel reason

- Status: Proposed
- Date: 2026-10-22
- Owners: @fjarmula @Piotrek406
- Supersedes: None (amends ADR 0003 additively)

## Context

If the backend simulation loop raised, `SessionManager._run` only logged the exception. No
terminal event was published, so subscribers waited out their 15 s silence timeout and the
dashboard showed a generic "no simulated telemetry" error. The dead session also stayed active
until the next start superseded it. Decision D2 of
`docs/superpowers/plans/2026-10-22-repo-audit-master.md` (finding B5) asks for a terminal event
that tells the client the server failed, and for the dashboard to say: "Simulation server error.
Retry the green corridor initialization."

## Decision

Additive to contract v1; `schema_version` stays `"1.0"`. Pydantic models in
`backend/src/greenwave/schemas/` remain canonical.

- `CancelReason` gains `SERVER_ERROR`.
- When the loop raises, the session logs the exception (`simulation_loop_failed`, with the
  simulation id) and publishes `SIMULATION_CANCELLED` with `reason: SERVER_ERROR` and the last
  completed tick. It is an ordinary terminal: the stream closes after it, a reconnect replays only
  it, `POST /stop` is a no-op success, and the run is no longer active.
- The dashboard shows the D2 copy in an error-tone summary with Back to dispatch setup. A start
  that fails with HTTP 5xx and no contract error code shows the same copy in setup.
- Retry is manual: the user goes back to setup (settings are kept) and initializes again. No
  automatic retry.
- The mock transport never emits `SERVER_ERROR`.

## Consequences

- Clients learn of a loop failure within one tick interval instead of after their silence timeout.
- Consumers that matched the reason exhaustively (`STOPPED | SUPERSEDED`) must accept the third
  value. The frontend validator would otherwise drop the event as invalid and report a lost stream.
- An older dashboard rejects the unknown value as an invalid frame and ends the run with a stream
  error: still immediate, but with generic copy.
- Simulation only: no endpoint actuates a signal or calls an external service.

## Alternatives considered

- A new `SIMULATION_FAILED` event type: rejected; it widens the union and every terminal check
  for one case that `SIMULATION_CANCELLED` already models.
- Reusing `STOPPED`: rejected; the dashboard would tell the user they stopped the run.
- Bumping `schema_version` to `2.0`: rejected; the change is additive.

## Validation

- `backend/tests/simulation/test_session.py`: failure terminal, replay, stop no-op and no
  supersession after a failure.
- `backend/tests/api/test_simulation_stream_api.py::test_stream_of_a_crashed_run_ends_with_a_server_error_terminal`.
- Frontend: `validate.test.ts`, `simulation-copy.test.ts`, `RunSummary.test.tsx`.
- CI OpenAPI drift check (`contracts/openapi.json`, `frontend/src/types/api.generated.ts`).
