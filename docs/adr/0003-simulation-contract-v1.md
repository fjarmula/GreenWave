# 0003: Simulation contract v1

- Status: Accepted
- Date: 2026-10-16
- Owners: @fjarmula @Piotrek406
- Supersedes: None
- Superseded in part: D9 by architecture §6 item 11 (every simulated second is its own tick; playback shortens only the wall-clock interval); D16/D18 confirmation semantics by ADR 0008 simulated ITS feedback; D18 `expected_arrival_utc` is now emission time + smallest TTI / `playback_speed` (wall-clock). The rest stands.

## Context

Phase 2 builds the simulation engine (backend) and wires the dashboard to it (frontend) in parallel. `GreenWave_ARCHITECTURE.md` §4 defines the payloads but leaves gaps, and the frontend's temporary types disagree with it (a fifth state `CLEARING_CASCADE`, an untyped ambulance status, no coordinates for intersections, no terminal stream event). Anything left open here becomes a contract change later. The decisions below close the gaps before either branch starts. Decision numbers D1–D23 refer to the internal development specification (omitted from this evaluation snapshot) §2.

## Decision

The Pydantic models in `backend/src/greenwave/schemas/simulation.py` are the canonical contract. `contracts/openapi.json` and `frontend/src/types/api.generated.ts` are generated from them. Phase 0 ships those models, three stub endpoints returning HTTP 501, and the regenerated artifacts. Tag: `contract-v1`.

### Contract shape

- **D1 Ownership.** Piotr owns the backend branch, Filip the frontend branch; disjoint paths (plan 00 §4).
- **D2 Stream events.** One union discriminated on `event_type`: `SIMULATION_TICK`, `ITS_DISPATCH`, `SIMULATION_COMPLETED`, `SIMULATION_CANCELLED` (`reason: STOPPED | SUPERSEDED`). Every event has `schema_version: "1.0"`, `is_simulated: true`, `simulation_id`, `tick` and `timestamp`.
- **D3 SSE framing.** First frame `retry: 2000`. Each event: `event:` = `event_type`, `id:` = `tick`, `data:` = event JSON. The server closes the stream after a terminal event. OpenAPI cannot express this; it is recorded here and in architecture §4. `id:` is non-decreasing: ticks start at 1, an `ITS_DISPATCH` shares the id of the tick that produced it and precedes that tick's `SIMULATION_TICK`, a terminal event repeats the last tick id.
- **D4 Start response.** `intersections_on_route: string[]` stays. Added: `route_intersections` (`{id, name | null, kind, position {lat, lng}, distance_along_route_m}` in route order), `origin_snapped`, `destination_snapped` (`{position, snap_distance_m}`).
- **D5 Tick intersections.** Every tick lists all route intersections in route order. `tti_seconds` is `int | null` (`null` once passed). `name` is nullable.
- **D6 `is_active_corridor`** = `state` in {`CLEARING`, `PRIORITY_GREEN`}; computed by the backend.
- **D7 Errors.** `ErrorResponse {schema_version, error_code, message}`. `ORIGIN_OFF_NETWORK` 422, `DESTINATION_OFF_NETWORK` 422, `NO_ROUTE` 422, `SIMULATION_ID_IN_USE` 409, `SIMULATION_NOT_FOUND` 404. FastAPI's default 422 stays for request-schema violations.
- **D8 `simulation_id`** is client-generated, pattern `^[A-Za-z0-9_-]{1,64}$`.
- **D9 Playback speed.** Optional `playback_speed` int `1..10`, default `1`, in the start request. The wall-clock tick stays 1 Hz; each tick advances `playback_speed` simulated seconds as 1 s sub-steps, so no 40/25/0/15 s threshold is skipped. At 10x a route of about 360 simulated seconds finishes in about 36 s.
- **D10 Health** is unchanged.
- **State enum** is exactly `NORMAL | CLEARING | PRIORITY_GREEN | RECOVERY`. `CLEARING_CASCADE` is not a state (`is_cascade` is the flag). Ambulance status: `EN_ROUTE | APPROACHING_INTERSECTION | CROSSING_INTERSECTION | ARRIVED`. `traffic_density_multiplier` is in `[1.0, 3.0]`.

### Simulation semantics

- **D11 Routing weight.** Shortest path by ambulance travel time `L_e / V_ambulance(e)`. `T_normal` and `T_greenwave` are both computed on that same path.
- **D12 Snapping.** Nearest graph node in EPSG:2178 from which a route exists. Maximum snap distance **150 m**, engine configuration (`max_snap_distance_meters`), not a contract field. Beyond it: `ORIGIN_OFF_NETWORK` / `DESTINATION_OFF_NETWORK`.
- **D13 Kinematics.** Each simulated second the ambulance advances at `V_ambulance` of its current edge, carrying the remainder across edges. It dwells `D_min = 3 s` at the first controlled stop line of each unique intersection. Simulated arrival is therefore about `T_greenwave`. `v_avg` is an EMA (alpha 0.25), initialised to `V_ambulance` of the first edge, floored at 5 m/s.
- **D14 Ambulance status.** `ARRIVED` at the route end; `CROSSING_INTERSECTION` during a dwell; `APPROACHING_INTERSECTION` when the next unpassed intersection is `CLEARING` or `PRIORITY_GREEN`; otherwise `EN_ROUTE`.
- **D15 KPI** `current_time_saved_sec` = normal-mode time for the distance covered so far (edge normal times pro rata plus `D_u` per passed intersection) minus elapsed simulated seconds, rounded. It ends at `T_normal - T_greenwave` (+/- rounding).
- **D16 Cascade: one hop only.** Only an intersection that entered `CLEARING` through its own TTI <= 40 s (`is_cascade=false`) can cascade. A cascade-triggered `CLEARING` (`is_cascade=true`) never cascades further. Cascade looks only ahead along the route, uses the inclusive 250 m along-route stop-line distance measured from the triggering intersection, and is disabled when `enable_cascade_mode=false`. Every other intersection enters `CLEARING` by its own TTI. Architecture §4 rule 1 originally read as transitive (an upstream `j` entering `CLEARING`); it now says one hop explicitly. Rejected: transitive cascade, which can clear a long avenue at once and makes the clearing window depend on chain length.
- **D17 Extended hold.** `hold_duration_sec = max(40, ceil(TTI at dispatch) + its_hold_buffer_seconds)` with `its_hold_buffer_seconds = 5`. For a group dispatch the largest TTI in the group is used. The buffer is engine configuration, not a contract field. Rationale: the old fixed 40 s hold expired before the ambulance arrived at cascaded intersections (a cascaded intersection can enter `CLEARING` with TTI above 40 s); 5 s covers `ceil` rounding plus the 3 s `D_min` crossing dwell. The schema rejects `hold_duration_sec < 40`. Rejected: keep 40 s fixed (the gap is real).
- **D18 ITS batching.** One `ITS_DISPATCH` per tick containing every intersection that entered `CLEARING` in that tick (TTI-triggered plus their cascade group). `expected_arrival_utc` = emission time + smallest TTI in the group. `message_id` = `MSG-ITS-<n>`, numbered per simulation.
- **D19 Lifecycle.** The run starts on `POST /start` with a server-authoritative clock and ticks regardless of subscribers. On connect the stream sends the latest snapshot, then live events; reconnect resumes at "now" (no replay). After `ARRIVED` the engine ticks until every intersection is `NORMAL` (<= 15 s), then emits `SIMULATION_COMPLETED`. A finished session stays readable until superseded. Unknown id: 404 `SIMULATION_NOT_FOUND`.
- **D20 Timestamps.** `timestamp` = wall-clock UTC at emission. Simulated time = `kpi_metrics.total_time_elapsed_sec`.

### Integration plumbing

- **D21 Cross-origin.** Backend CORS allow-list from `GREENWAVE_CORS_ORIGINS` (default `http://localhost:3000`), never `*`. Frontend `NEXT_PUBLIC_API_BASE_URL` (default `http://127.0.0.1:8000`). No Next.js rewrite proxy (proxies can buffer SSE).
- **D22 Transport switch.** `NEXT_PUBLIC_SIMULATION_TRANSPORT = mock | backend`, default `mock` until Phase 3. The mock stays as the offline demo fallback.
- **D23 Frontend validation.** No new dependency, no hand-written second schema: narrow type guards on the envelope and the fields the UI reads; unknown `event_type` is ignored and logged.

### Decisions not on the approved list (made while writing the contract)

These fill details the list does not cover. Challenge them in review.

1. `tick` and `timestamp` are on every stream event (the SSE `id:` needs a tick on events other than `SIMULATION_TICK`).
2. `SIMULATION_COMPLETED` carries the final `kpi_metrics`.
3. `StopResponse` is `{schema_version, is_simulated, simulation_id, status: "STOPPED"}`; stopping an already finished session is a no-op that still returns 200. `ErrorResponse` has no `is_simulated`, as specified in D7.
4. `RouteIntersection.kind` is `signalised_junction | midblock_signal | pedestrian_crossing` (the ETL's kinds), exposed as a closed enum.
5. Same-tick tie: an intersection reaching TTI <= 40 s in the tick in which it would be cascaded is `is_cascade=false` (own TTI wins), so it can itself cascade. Cascade triggers are evaluated from the set of own-TTI entries of that tick.
6. `Position` bounds `lat` in [-90, 90] and `lng` in [-180, 180]. Route coordinates are `[lng, lat]` pairs.
7. `ItsDispatchPayload` fixes the architecture constants as literals: `priority_level: 1`, `vehicle_type: "AMBULANCE"`, `action: "FORCE_GREEN_PHASE"`; the event fixes `system_source: "ER_GREENWAVE_ENGINE"` and `target_system: "STeR_KRAKOW_ITS"`.
8. The start response `status` is the literal `"INITIALIZED"`.
9. `tick` is `>= 0`: ticks start at 1; a terminal event emitted before any tick carries 0.
10. `SimulationStreamEvent` is a Pydantic `RootModel` over the discriminated union so OpenAPI has a named component and the generated TypeScript has a named union. Backend code constructs the member models (`SimulationTickEvent`, ...) directly; `SimulationStreamEvent` is for validation and OpenAPI only.
11. The generated TypeScript marks `playback_speed` as required in `SimulationStartRequest` (openapi-typescript treats fields with a default as non-optional). The wire contract stays optional with default 1; the frontend may simply always send it.

## Consequences

- Backend and frontend can proceed in parallel against one frozen contract; changes follow the contract-change protocol (plan 00 §5), additive only during Phase 2.
- The ITS console can show real dispatches instead of synthesised log lines; the UI can distinguish arrival, stop and supersede from a dropped connection.
- `playback_speed` makes a demo run about 36 s at 10x instead of 6+ minutes.
- The longer hold keeps cascaded intersections green until arrival, at the cost of holding some of them longer than 40 s (up to TTI + 5 s). This is simulated only; no real actuation (PoC boundary).
- The SSE framing is not machine-checked by OpenAPI; it is covered by tests in the backend branch.
- Architecture §4 and §6 are edited (rule 1, Phase 3 hold, new decisions 10 and 11).

## Alternatives considered

- Transitive cascade (D16 a): rejected, see D16.
- Fixed 40 s hold (D17 a): rejected, see D17.
- WebSocket instead of SSE: not reopened; the architecture already chose SSE.
- Generating zod validators from OpenAPI (D23): needs a new dependency; type guards chosen.
- Next.js rewrite proxy for CORS (D21): can buffer SSE; explicit CORS chosen.

## Validation

- `backend/tests/schemas/`: architecture §4 examples validate against the models; boundary tests for multiplier, `playback_speed`, state enum, `is_simulated`, `hold_duration_sec`; union dispatches on `event_type`.
- `backend/tests/api/`: OpenAPI contains the three paths and every model.
- CI `contract-drift` regeneration check for `contracts/openapi.json` and `api.generated.ts`.
- `api.generated.ts` inspected: enums and literals are TS string-literal unions and `SimulationStreamEvent` narrows on `event_type`.

## Additive change 2026-10-19

`RouteIntersection` adds four required fields while retaining `schema_version: "1.0"`:
`signal_count` (integer, at least 1), `approach_count` (integer, at least 1), `needs_review`
(boolean), and `cascade_targets` (later intersection ids in route order; empty when cascade mode
is disabled or there are no targets).

## Additive change 2026-10-22

`CancelReason` adds `SERVER_ERROR` (simulation loop failure) while retaining
`schema_version: "1.0"`; see ADR 0007.
