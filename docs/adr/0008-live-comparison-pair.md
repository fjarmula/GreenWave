# 0008: Live comparison pair

- Status: Accepted
- Date: 2026-10-23
- Owners: @fjarmula @Piotrek406
- Supersedes: None (amends ADR 0003 additively)

## Context

The `/compare` screen recorded an ER Green Wave run and then a standard-traffic run one after the
other through the single active run, and replayed both. The contest demo needs both runs watched
live and side by side, so the time saved is felt rather than replayed (design
the internal development specification (omitted from this evaluation snapshot), section P4). Contract v1
(ADR 0003) allows one active simulation and starts runs one at a time; two separate `/start`
calls would supersede each other, and two independent loops would let the panes' simulated clocks
drift apart, which makes the race dishonest.

## Decision

Additive to contract v1; `schema_version` stays `"1.0"`. Pydantic models in
`backend/src/greenwave/schemas/` remain canonical.

- New endpoint `POST /api/v1/simulation/compare/start` takes `ComparisonStartRequest`: the
  `SimulationStartRequest` fields minus `green_wave_mode`, plus `enabled_simulation_id` and
  `disabled_simulation_id` (client-chosen, must differ). It returns `ComparisonStartResponse`
  with both start responses (`enabled`, `disabled`); both plan the same route. Errors map exactly
  as for `/start` (422 planning/validation codes, 409 for an id that is live in the active
  operation, 503 when the network is unavailable).
- The backend runs one active **operation** at a time: a single run or one pair. Starting
  anything supersedes the whole active operation (`SUPERSEDED` to every live member). Stopping
  either pair member stops both (`STOPPED`); a member that already completed keeps its completed
  terminal. A loop failure ends every live member with `SERVER_ERROR` (ADR 0007).
- Lockstep: one shared loop task advances the pair. Each wall-clock interval
  (`tick_interval_seconds / playback_speed`) steps every unfinished member exactly once, so both
  always share the same simulated second. A completed member stops stepping; the operation ends
  when every member has a terminal.
- Each run keeps its own `simulation_id`, SSE stream (`GET /api/v1/simulation/{id}/stream`) and
  stop endpoint. Tick, dispatch, completed and cancelled event schemas are unchanged.
- Non-goals: no replay, scrubbing or recorded comparison; no more than two members; no new
  event types.

## Consequences

- The comparison screen can stream both runs at once and they never diverge in simulated time.
- `SessionManager` holds a tuple of active sessions instead of one; eviction keeps every active
  member streamable.
- Clients that only use `/start` see no change; a pair is superseded by a later `/start` exactly
  like a single run.
- Two engines run per interval during a comparison; each step is the existing bounded 1 Hz work.

## Alternatives considered

- Two `/start` calls with an "allow concurrent" flag: two loops could drift apart and the
  one-active-operation rule would become ambiguous.
- Keep record-then-replay: rejected by the human; the race must be live.
- One combined stream carrying both runs: a new event schema and a second SSE consumer path for
  no benefit; each run already has its own stream.

## Validation

`backend/tests/schemas/test_simulation_schemas.py` (comparison request), lockstep, supersede,
stop and failure tests in `backend/tests/simulation/test_session.py`, endpoint tests in
`backend/tests/api/test_simulation_api.py`, and the regenerated `contracts/openapi.json` diff
containing additions only.
