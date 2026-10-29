# Per-junction graceful fallback for priority requests: design

## Requirement

A failed priority request (rejected, acknowledgement timeout, or hold expiry) affects only its own
target junctions. The run keeps going, every other junction keeps requesting priority, and the run
mode never flips to `DISABLED`. All values stay simulated; no real signal actuation is added.

This supersedes the previous behaviour recorded in `docs/engineering/its-feedback-check.md`, where
rejection, timeout and hold expiry cancelled the run (`ITS_REJECTED`, `ITS_TIMEOUT`,
`ITS_HOLD_EXPIRED`).

## Three separate state axes

| Axis | Values | Owner |
| --- | --- | --- |
| Request status | `REQUESTED` (pending), `ACCEPTED`, `REJECTED`, `TIMED_OUT`, `RELEASED`, `EXPIRED` | ledger (engine) |
| Intersection signal state | `NORMAL`, `CLEARING`, `PRIORITY_GREEN`, `RECOVERY` | simulated controller |
| Crossing strategy | `PRIORITY`, `STANDARD_FALLBACK` (none for a standard-mode run) | engine |

`REJECTED`, `TIMED_OUT` and `EXPIRED` are terminal failures. Each puts every target of the request
that is not yet passed into `STANDARD_FALLBACK`, permanently. Late or duplicate feedback for a
failed request is ignored by the ledger (no transition leaves a failed status).

## Outcomes

- **Accepted:** unchanged. Clearing starts; motion waits for the confirmed route green.
- **Rejected:** correlated `ITS_FEEDBACK` (`REJECTED`, `CONTROLLER_REJECTED`); targets fall back.
- **No response:** stays `REQUESTED` until `its_ack_timeout_seconds` (default 8 s) after
  submission; the engine emits a correlated `ITS_FEEDBACK` (`TIMED_OUT`, `ACK_TIMEOUT`) and tells
  the controller to withdraw the request, so a late acceptance can never activate priority.
  No controller feedback is fabricated. The withdrawal reserves the next number in the run's
  single feedback sequence (owned by the controller), so later decisions are never mistaken for
  stale ones.
- **Hold expired:** same fallback for the targets still ahead. Expiry was a run-ending failure
  before; treating it like the other failures keeps "a single failure never ends the run" true.

## Motion under fallback

Motion stays one function for both modes. Each unpassed intersection is priority when the run is
enabled and the intersection is not in fallback; otherwise it follows standard rules:

- Priority intersections: unchanged `D_min` rolling slowdown and safety hold at the first stop line
  until the route light was shown green.
- Fallback (and standard-mode) intersections: at each route stop line, the ordinary programme
  decides (green drives on; red/yellow/unknown starts the capped standard crossing).

Transitions mid-approach:

- **During an approach slowdown:** the remaining slowdown of that junction is dropped when the
  vehicle reaches the junction's first fallback stop line, where the standard decision replaces it.
  A slowdown remainder belonging to an earlier priority junction is kept and merged, so no junction
  loses its own delay and none is counted twice.
- **Held at the stop line:** the hold ends on the next second; the standard decision is taken at
  release time, from the ordinary programme at that moment. The time already held counts as trip
  time; the vehicle never waits indefinitely.
- Signals: the controller treats failed targets as never prioritised. They stay or return to the
  ordinary programme through legal light transitions. A target that never held priority does not
  enter `RECOVERY`; an expired target that held priority returns through the controller's normal
  path.

Grouped and cascade requests share one outcome: the whole group falls back together. Targets of
the group already passed are unaffected. Downstream junctions not in the group are requested later
as usual.

## Mixed (randomised) scenario

New `ItsScenario.MIXED`. Each request's outcome is drawn from a validated
`its_outcome_seed` (start request, `0..4294967295`, default `0`) and the request's stable identity:
its sorted target intersection ids. Draw: FNV-1a 32-bit hash of `"<seed>:<id1>,<id2>,..."`,
finalised with MurmurHash3 `fmix32` (plain FNV barely changes between ids differing in the last
character); its top two bits pick accept after 1 s, accept after 5 s, reject after 1 s, or no
response. No wall clock, no signal-colour randomness. Both transports implement the same hash. The four presets are unchanged.

## Contract changes (additive)

- `ItsScenario.MIXED`; `its_outcome_seed` on `SimulationStartRequest`, `ComparisonStartRequest`
  and echoed on `SimulationStartResponse`.
- `CrossingStrategy` enum; `IntersectionTelemetry.crossing_strategy: CrossingStrategy | None`
  (null in standard-mode runs), so a reconnecting client sees fallback from one tick snapshot.
- `SimulationCompletedEvent.fallback_intersection_ids: list[str]` (route order, default empty).
- `CancelReason.ITS_*` values remain for compatibility; the engine no longer emits them.

## Metrics

`time_saved = round(standard baseline at position) - round(actual elapsed)` is unchanged. Waiting
and fallback time are part of the actual time, so savings can be zero or negative. Completed
fallback runs are tagged through `fallback_intersection_ids`.

## UI

- A non-terminal warning (`role="status"`) lists each failed request and its targets, with the
  outcome (rejected / no response / hold expired) and "crossing with ordinary signals". It is
  derived from the request snapshots, so it survives reconnects.
- Intersection rows mark `STANDARD_FALLBACK`; next-signal copy says "Ordinary green" vs
  "Priority green" so ordinary green is never shown as granted priority.
- Finished summary adds a "Priority fallback" row naming the fallback junction count.
- Setup offers the `Mixed` scenario with a seed input. English and Polish copy.
- Mock transport mirrors all of the above.
