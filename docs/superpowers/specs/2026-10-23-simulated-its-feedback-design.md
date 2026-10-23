# Simulated ITS feedback loop: design

Status: proposed for review; documentation only. No implementation authorized by this document.

## Intent

Demonstrate the central operational idea: a priority request leaves the routing engine, a
separate simulated ITS controller accepts or rejects it, and controller feedback determines
the traffic state displayed to the dispatcher and driver. Sending a request must never be
presented as confirmation that a signal has become green.

The human requested a branch from `main` and a plan for this update after discussing the
missing request-to-feedback flow. Timing defaults, failure policy, and interface choices
below are planning recommendations, not independently approved product requirements.

## Current implementation and gap

- `simulation/engine.py:step` calls `advance_corridor`, replaces intersection state, and
  only then calls `gateway.dispatch`. Signal phases are generated inside that same engine.
- `its/gateway.py:ItsGateway.dispatch` returns `None`; `MockItsGateway` retains and logs
  payloads. It cannot reject a request or report an observed state.
- `simulation/session.py` fans out events through bounded subscriber queues. Reconnection
  provides the latest snapshot, not history. Ordinary events can be dropped.
- The browser validates SSE events and stores in-memory simulation state. Its separate
  mock adapter generates synthetic events locally. Comparison records enabled then disabled.

Consequently, current state changes are not consequences of an ITS response. Merely adding
an acceptance log line would leave that gap intact.

## Scope and boundaries

- Simulation only; all new envelopes retain `is_simulated: true` and `schema_version: "1.0"`.
- No network controller integration, real signal actuation, external services, new dependencies,
  database, authentication, multi-mission scheduling, or deployment changes.
- Preserve HTTP routes, SSE transport, route choice, station ranking, geographic dataset,
  English UI, existing simulation modes, and the four intersection states.
- Add separate request status; do not add a fifth intersection state for pending requests.
- The backend remains authoritative in backend mode. Browser mock mode must demonstrate the
  same causal sequence, explicitly labelled synthetic.
- The outgoing `ItsDispatchPayload` stays intact as an illustrative internal contract. It is
  not represented as compatible with any actual city ITS protocol.

## Proposed flow and ownership

```mermaid
sequenceDiagram
    participant E as Simulation engine
    participant C as Simulated ITS controller
    participant B as SSE/backend projection
    participant U as Dashboard
    E->>C: Submit correlated priority request
    E->>B: ITS_DISPATCH + tick showing REQUESTED
    B->>U: Request pending; last reported traffic state
    Note over C: Simulated acknowledgement delay
    C-->>E: ACCEPTED or REJECTED feedback
    C-->>E: Controller snapshot: actual simulated signal indications
    E->>B: ITS_FEEDBACK + tick with controller snapshot
    B->>U: Acceptance separately from reported signal state
    Note over C: Transition programme permits route green
    C-->>E: Snapshot confirms route indications green
    E->>B: Tick with reported PRIORITY_GREEN
    B->>U: Simulated controller reports priority green
    E->>C: Vehicle passed: release priority
    C-->>E: RECOVERY, then NORMAL
```

The engine owns motion, TTI, one-hop cascade selection, request submission, timeout detection,
and projection. The controller owns its request decisions, signal programme, phase transitions,
and reported intersection/signal snapshots. SSE and UI never calculate an acknowledgement
or infer green from elapsed time. This controller is an in-process deterministic simulator,
not a second server or a self-HTTP endpoint.

Split corridor request selection from confirmed intersection state. A selected intersection
is marked requested in a ledger, preventing repeat requests while it still reports NORMAL.
Keep one grouped dispatch per tick and one request per intersection per run; retain existing
40 s clearing trigger, 25 s priority eligibility, one-hop 250 m cascade, and 15 s recovery.
Controller input supplies current per-intersection TTI and passage information on each step;
the controller does not calculate a moving green deadline from wall-clock timestamps.

### Controller boundary

Introduce a per-run `SimulatedItsController`, constructed by a factory during planning.
Do not share mutable controller state across sessions. Use these typed interfaces in
`its/models.py` and `its/controller.py` (internal dataclasses may differ from public models):

```python
submit(request: ItsRequest) -> None
advance(observation: ItsObservation) -> ItsControllerUpdate
ordinary_route_color_at(intersection_id: str, at_simulated_sec: float) -> SignalPhaseColor | None
close() -> None
```

- `ItsRequest`: simulation ID, message ID, submitted simulated second, existing dispatch
  payload, and cascade flags for its targets. Correlation key is `(simulation_id, message_id)`.
- `ItsObservation`: simulated second, current TTI and passed flag for every route intersection.
- `ItsControllerUpdate`: ordered request feedback, complete reported intersection states,
  signal heads and indicators, and observation simulated second.
- Controller construction receives the route model, settings, and feedback scenario. `advance`
  runs once per tick; there are no sleeps, background tasks, or network effects in it.
- `close` is idempotent and discards pending work. No later callback may affect a stopped run.

`submit` cannot return acceptance or mutate the engine's reported traffic state. Each engine
step moves (enabled mode uses the previous confirmed controller snapshot), advances the controller with current
observations, applies its feedback, selects/submits new requests, and publishes feedback
then the tick. New submissions cannot receive feedback until a subsequent step. On a timeout,
publish its final diagnostic tick before the single cancellation terminal; emit no completion.

Reuse/refactor the existing pure state-machine and phase helpers into controller-owned logic;
do not maintain a second competing phase programme. Keep controller target states separate
from reported states: targeting green is not yet a green confirmation. Maintain existing
yellow/conflict constraints. Report PRIORITY_GREEN only when all supported route vehicle
indications at that intersection report green. Without supported route vehicle indications,
never invent green confirmation: retain CLEARING until passage and show phase unavailable.
Do not change the disabled-mode crossing model: `ordinary_route_color_at` is a pure query
of the controller-owned ordinary programme at the exact fractional simulated second a stop
line is reached. It returns a programme colour, not an observed priority confirmation, and
does not mutate state. Do not replace this query with the previous integer-tick snapshot;
that would change crossing decisions near phase boundaries. Disabled runs submit no priority
requests. Enabled motion may cross a controlled stop line only
under the existing minimum-dwell and confirmed-route-light constraints.

## Request lifecycle, timing and failure policy

Add `its_scenario: NOMINAL | DELAYED | REJECTED | NO_FEEDBACK`, default NOMINAL, to start
request and response. Expose it in dispatch setup for enabled simulations. Comparisons use
NOMINAL for both recordings. A disabled standalone run normalizes it to NOMINAL and the
response echoes that effective value; priority scenario controls are disabled in that mode.

Recommended settings in `SimulationSettings`, in simulated seconds:

| Setting | Default | Validation |
| --- | --- | --- |
| `its_ack_delay_seconds` | 1 | integer >= 1 |
| `its_delayed_ack_seconds` | 5 | integer >= normal delay and < timeout |
| `its_ack_timeout_seconds` | 8 | integer > both acknowledgement delays |

At submitted second `s`, NOMINAL accepts at `s+1`, DELAYED accepts at `s+5`, REJECTED
rejects at `s+1`, and NO_FEEDBACK sends no acknowledgement. Values above are defaults, read
through existing settings. Process valid feedback at the deadline before declaring timeout.
Wall-clock UTC remains an emission/illustrative arrival timestamp; it does not drive controller
decisions. Outcomes and simulated-second traces must match at 1x and 10x.

Request statuses: REQUESTED -> ACCEPTED -> RELEASED, or REQUESTED -> REJECTED/TIMED_OUT;
an accepted request can become EXPIRED. No automatic retries in this increment.

- Acceptance is atomic for a grouped request. Accepted targets enter reported CLEARING;
  priority is eligible when current TTI <= 25 s, but green awaits phase transition completion.
- Passage explicitly releases each target. Recover for 15 s then report NORMAL. Mark a grouped
  request RELEASED only when every target has released; one target releasing must not drop
  priority for the rest. Ordinary programme green is not proof of accepted priority.
- A pending request whose targets all pass before acknowledgement becomes RELEASED; ignore
  later acceptance. For partial passage, accept only still-relevant targets and recover passed
  ones without activating them. Preserve original target identity in diagnostics.
- Enforce `hold_duration_sec` from submission time; the existing max-TTI-plus-buffer calculation
  stays. Expiration while a target still needs priority is an explicit EXPIRED failure, never
  silently renewed. Passage at the exact expiry second wins over expiry.
- Rejection, acknowledgement timeout, and active hold expiry end the enabled run with new
  cancel reasons ITS_REJECTED, ITS_TIMEOUT, ITS_HOLD_EXPIRED respectively. Freeze the last
  displayed position, show the cause, close controller state, and require an explicit new run.
  Do not emit completion or claim successful savings. Do not switch modes automatically.
- Stop, supersede, server failure and normal completion close the per-run controller. Cleanup
  releases only synthetic state and cannot issue real commands. In terminal UI, identify the
  retained traffic snapshot as the last report, not a continuing live observation.
- Exact duplicate submissions/feedback are idempotent. Reject conflicting duplicate request
  contents. Ignore/log feedback for unknown request/run IDs, duplicate/older sequence numbers,
  impossible lifecycle transitions, unknown targets, or closed runs without mutating state.
  Such invalid feedback does not extend the acknowledgement deadline.

## Public telemetry and reconnect behavior

Define canonical models in new `schemas/its.py`, referencing shared models from
`schemas/simulation.py` without circular imports (move shared ITS payload definitions to
`schemas/its.py` if needed; keep exports compatible). Regenerate OpenAPI and TypeScript.

- `ItsRequestSnapshot`: `message_id`, `intersections_group`, `status`,
  `submitted_at_simulated_sec`, nullable `acknowledged_at_simulated_sec`,
  `last_updated_at_simulated_sec`, `last_feedback_sequence` (0 while only REQUESTED),
  and nullable closed-enum `reason`.
- `ItsFeedbackEvent`: ordinary simulation envelope plus `event_type: ITS_FEEDBACK`,
  `request_message_id`, `feedback_sequence` (positive, increasing per run), request `status`
  excluding REQUESTED, `intersections_group`, `observed_at_simulated_sec`, and nullable reason.
- Add `its_requests` (default `[]`) and nullable `its_observed_at_simulated_sec` to ticks.
  Existing `intersections` and `signal_phases` contain the complete latest controller snapshot.
  Timestamp `null` means controller feedback unavailable; an empty legacy field is never
  interpreted as confirmation. Every new backend tick has a controller observation timestamp.
- Feedback reason enum: CONTROLLER_REJECTED, ACK_TIMEOUT, HOLD_EXPIRED; null on ordinary
  acceptance/release. Snapshot and feedback status/reason combinations must be validated.
- Keep existing ITS_DISPATCH fields and ordering. Within one tick, emit controller feedback
  ordered by sequence, then new dispatches ordered by message sequence, then SIMULATION_TICK,
  then an optional terminal. SSE `id` remains tick; it is not a unique feedback identifier.
- Frontend deduplicates feedback by `(simulation_id, feedback_sequence)`, independently of
  last telemetry tick and dispatch IDs. Each snapshot's `last_feedback_sequence` also prevents
  an older delayed feedback event regressing that request after snapshot reconciliation.
  Reject wrong-run/malformed data before state updates.
- Request snapshots include all submitted requests for that route, bounded by its intersection
  count. A tick is self-contained: dropped feedback events and reconnect-at-now must not leave
  stale REQUESTED UI. Do not add unbounded event history or promise SSE replay.
- Comparison records/counts feedback bytes and rejects failed or incomplete runs. Preserve
  10,000-tick and 32 MiB pair limits. Replay uses stored controller snapshots, never synthesizes
  a successful acknowledgement or infers state from a request.

## Presentation

In the existing ITS console and intersection inspector, present request status independently
of reported traffic state: for example, “Priority accepted · simulated controller reports
CLEARING”. Show request ID, targets, and submitted/acknowledged simulated seconds. Pending,
rejected, timeout and expiry have text labels; color alone is insufficient. “Priority green”
requires controller confirmation; missing supported phases retain the existing unavailable label.
Legacy/mock payloads lacking feedback say “ITS feedback unavailable”.

Add the scenario selector to the dispatch form, keeping the same settings accessible on phone.
Update diagnostics with outgoing request and incoming feedback as distinct observed operations,
inspectable original JSON, and an architecture explanation that identifies both as in-process
simulation. Preserve existing history/body limits. Driver view consumes the same confirmed
snapshot and failure message, without a second subscription or controller.

## Acceptance criteria

1. Before acceptance, request is REQUESTED and reported state remains ordinary NORMAL;
   neither dispatch nor acceptance alone can claim confirmed priority green.
2. A controller test double withholding green keeps the map and enabled motion from inventing
   it even after the old 25 s threshold. Injected reported changes reach tick, reducer and UI.
3. NOMINAL and DELAYED show distinct request/acknowledgement times and controller transitions;
   REJECTED and NO_FEEDBACK end once with their specific cause and no successful completion.
4. Duplicate, out-of-order, wrong-run and post-close feedback cannot regress or activate state.
5. Cascaded groups, partial passage, stop near a stop line, expiry, and missing signal movements
   satisfy the lifecycle rules without stuck sessions or invented green indications.
6. 1x and 10x have identical domain traces after excluding wall-clock timestamps.
7. Latest-tick reconnect/drop recovery restores request and controller state. Faults invalidate
   comparison; successful replay retains feedback and existing recording limits.
8. Backend and mock modes demonstrate the causal sequence; all six routes and existing
   standard-mode semantics remain usable. No real controller commands or outbound ITS calls.

## Alternatives and trade-offs

Logging acceptance while retaining engine-owned green was rejected: it does not establish
causality. A separate HTTP ITS simulator was rejected for this increment: it adds deployment
and transport failure work without improving the core demonstration. The selected deterministic
in-process controller establishes a testable boundary; a future network adapter would require
a separately approved contract, async delivery/reliability design and safety review.

This deliberately changes enabled-mode timing and may change recorded outcomes. Existing
preflight estimates remain model estimates, not controller guarantees; update their explanatory
copy and relevant golden expectations only after behavior tests justify the change.
