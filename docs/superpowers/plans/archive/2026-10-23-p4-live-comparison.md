# P4 Live Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: subagent-driven-development or executing-plans, test-driven-development, systematic-debugging (for async lifecycle), verification-before-completion, playwright-cli; emil-design-eng for Task 6. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking "Start comparison" starts the Green Wave and standard-traffic runs of the same scenario simultaneously and in lockstep; both are watched live side by side and the screen ends on a result card.

**Architecture:** The backend `SessionManager` generalises its single active run to one active *operation* of one or two sessions; a pair is planned together and advanced by one shared loop task, so both runs always share the same simulated second. A new additive endpoint `POST /api/v1/simulation/compare/start` (ADR 0008) starts a pair; each run keeps its own id and the existing SSE stream. The frontend adapter gains `startComparison`; a new live comparison controller holds one `SimulationState` per mode via the existing `simulationReducer`/`connectSimulationStream`; the recording/replay path is deleted.

**Tech Stack:** FastAPI, Pydantic v2, asyncio, pytest; Next.js 16.4/React 19.3, Vitest, MapLibre; `@playwright/cli`.

**Spec:** `docs/superpowers/specs/2026-10-23-soft-glass-live-comparison-design.md` (section P4). Mockup (local): `.superpowers/brainstorm/19135-1792746801/content/comparison-live.html`. UI styling follows P2 (Soft Glass); backend Tasks 1–3 and frontend Tasks 4–5 do not depend on P2.

## Global Constraints

- Contract change is additive only; `contract-v1` events and existing endpoints unchanged. Pydantic is canonical: after schema change run `cd backend && uv run python scripts/export_openapi.py && cd ../frontend && npm run generate:types`; never hand-edit `contracts/openapi.json` or `frontend/src/types/api.generated.ts`.
- One active operation at a time: a single run or one pair. Starting anything supersedes the whole active operation (`CancelReason.SUPERSEDED` to every live member). Stopping either pair member stops both (`STOPPED`). A loop failure ends both with `SERVER_ERROR`.
- Lockstep: per wall-clock interval (`tick_interval_seconds / playback_speed`) every unfinished member advances exactly one `engine.step`; a member that completed stops stepping; the operation ends when all members have terminals.
- Both members use the same request fields except `simulation_id` and `green_wave_mode` (ENABLED / DISABLED).
- No replay, scrub or "watch again"; recording code is removed.
- Live readout shows measured distance lead only: exact copy `Green Wave ahead by {d}`, `Standard traffic ahead by {d}`, `Level` (|lead| < 10 m), and after the first arrival `Green Wave arrived · standard traffic {d} behind` / `Standard traffic arrived · Green Wave {d} behind`. `{d}` uses `formatSignalDistance` rules (`"120 m"`, `"0.7 km"`; define locally if P3 is not merged: `< 1000` → nearest 10 m, else one decimal km).
- Result card: both actual `total_time_elapsed_sec` from completion events, `completionDelta` with `comparisonResultLabel` wording, "Signals given priority {n} of {total}" counted client-side from Green Wave ticks (`PRIORITY_GREEN` reached), "New comparison". `current_time_saved_sec` is not shown on this screen.
- Either mode may lead or win; copy stays neutral.
- `GreenWave_ARCHITECTURE.md` §4 edit ("Only one active simulation runs at a time") is pre-approved by the human; mention it in the milestone report.
- No dependency/lockfile changes. Browser artefacts under `.tmp/playwright/p4/`.
- Checks: backend `uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`; frontend `npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`.

## Review Focus

1. Stop pressed on one pane while the other has already arrived: the arrived run keeps its completion terminal; only the live one gets `STOPPED`; UI shows the result card with the stopped run marked. Task 2 test `stopping_a_pair_after_one_arrival_cancels_only_the_live_member`; Task 5 test.
2. A plain `/start` (Green Wave page) while a pair runs: both pair members get `SUPERSEDED`, comparison UI shows "Comparison replaced by another simulation". Task 2 test `single_start_supersedes_a_running_pair`; Task 5 test.
3. Planning fails for the pair (`NO_ROUTE`): no session starts, active operation untouched, 422 returned once. Task 3 API test `compare_start_maps_planning_errors`.
4. One stream drops and reconnects mid-race (backend transport): that pane shows stale/reconnecting; the other keeps running; the race readout freezes the stale side's position rather than jumping. Task 5 test `stale side freezes in the readout`.
5. Duplicate ids (`enabled_simulation_id == disabled_simulation_id`) or an id equal to the active run: 422 / 409. Task 1 schema test and Task 3 API test.

---

### Task 1: ADR and schemas

**Files:**
- Create: `docs/adr/0008-live-comparison-pair.md` (template `docs/adr/0001-template.md`; Status Accepted 2026-10-23; decision = Global Constraints bullets 1–3 + endpoint)
- Modify: `backend/src/greenwave/schemas/simulation.py` (+ `__all__`), `backend/src/greenwave/schemas/__init__.py`
- Test: `backend/tests/schemas/test_simulation_schemas.py`

**Interfaces — Produces:**
- `ComparisonStartRequest(BaseModel)`: `enabled_simulation_id: SimulationId`, `disabled_simulation_id: SimulationId`, `origin: Position`, `destination: Position`, `traffic_density_multiplier` (same annotation as start), `enable_cascade_mode: bool`, `playback_speed` (same annotation/default), `vehicle_type: VehicleType = VehicleType.AMBULANCE`; `@model_validator` rejecting equal ids.
- `ComparisonStartRequest.member(mode: GreenWaveMode) -> SimulationStartRequest`.
- `ComparisonStartResponse(BaseModel)`: `schema_version: SchemaVersion`, `is_simulated: Literal[True]`, `enabled: SimulationStartResponse`, `disabled: SimulationStartResponse`.

- [ ] **Step 1: Failing tests:** `test_comparison_request_rejects_equal_ids`; `test_comparison_member_carries_mode_and_id` (`member(ENABLED).simulation_id == enabled id`, `green_wave_mode == ENABLED`, other fields equal).
- [ ] **Step 2:** `cd backend && uv run pytest <that file> -v` → FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** Write ADR. Commit `feat: add comparison pair schemas and ADR 0008`.

### Task 2: Session manager operations and lockstep loop

**Files:**
- Modify: `backend/src/greenwave/simulation/session.py`
- Test: `backend/tests/simulation/test_session.py` (reuse `_Engine`, `_CompletingEngine`, `_planner`, fixtures)

**Interfaces — Produces:**
- `SessionManager.start_comparison(request: ComparisonStartRequest) -> ComparisonStartResponse` — raises `SimulationIdInUseError` if either id is a live active member; plans both members with `asyncio.to_thread` (sequentially, inside the lock) before superseding anything.
- Internal: `self._active: tuple[_Session, ...]` (empty = idle) replacing `_Session | None`; `_Session.task` points at the shared operation task; `_run(sessions: tuple[_Session, ...])` replaces `_run(session)`; `_cancel_operation(reason)` cancels the shared task once then publishes a cancelled event to every member without a terminal; `stop(id)` on a member → `_cancel_operation(STOPPED)` when that member is live; `_evict_retained` keeps every active member.

Loop body (per iteration): `live = [s for s in sessions if not s.state.completed]`; step each `live` member with the same `self._clock()` value and publish its events; break when none live; sleep `tick_interval_seconds / playback_speed - elapsed` (both members share `playback_speed`). On exception publish `SERVER_ERROR` to every member without terminal.

- [ ] **Step 1: Failing tests:**
  - `test_pair_members_advance_in_lockstep` — subscribe to both, collect ticks; for every k, both have tick k before either has tick k+1 (record arrival order).
  - `test_pair_keeps_streaming_the_slower_member_after_the_first_completes` — engines completing at 3 and 5 ticks → both terminals completed, slower has 5 ticks.
  - `test_stopping_one_member_stops_both` — `stop(enabled_id)` → both terminals `SIMULATION_CANCELLED` reason `STOPPED`.
  - `test_stopping_a_pair_after_one_arrival_cancels_only_the_live_member`.
  - `test_single_start_supersedes_a_running_pair` and `test_comparison_start_supersedes_a_running_single`.
  - `test_failed_pair_planning_keeps_the_active_operation` (`_failing_planner`).
  - `test_pair_loop_failure_ends_both_with_server_error`.
  - `test_pair_members_are_kept_by_eviction` (limit 1 → both active members still streamable).
  - Existing single-run tests stay green unchanged.
- [ ] **Step 2:** `uv run pytest tests/simulation/test_session.py -v` → new FAIL. **Step 3:** implement (single run = operation of one). **Step 4:** PASS; `uv run mypy`.
- [ ] **Step 5:** Commit `feat: run comparison pairs in lockstep`.

### Task 3: Endpoint, OpenAPI, architecture doc

**Files:**
- Modify: `backend/src/greenwave/api/simulation.py` (new route `@router.post("/compare/start", response_model=ComparisonStartResponse, responses=...)` mirroring `start_simulation` error mapping)
- Test: `backend/tests/api/test_simulation_api.py`, `backend/tests/api/test_simulation_stub_openapi.py` if it pins paths
- Regenerate: `contracts/openapi.json`, `frontend/src/types/api.generated.ts`
- Modify: `GreenWave_ARCHITECTURE.md` §4 ("Only one active simulation runs at a time…") → one active operation: a run or a comparison pair started together by `POST /api/v1/simulation/compare/start`, advanced in lockstep; link ADR 0008. Add the endpoint to the API section that lists `/start` (`grep -n "/api/v1/simulation/start" GreenWave_ARCHITECTURE.md`).
- Modify: `frontend/src/types/telemetry.ts` (aliases `ComparisonStartRequest`, `ComparisonStartResponse`)

- [ ] **Step 1: Failing tests:** `test_compare_start_returns_both_routes` (200, `enabled.green_wave_mode == "ENABLED"`, `disabled.green_wave_mode == "DISABLED"`, same `total_distance_m`); `test_compare_start_maps_planning_errors` (off-network origin → 422 `ORIGIN_OFF_NETWORK`); `test_compare_start_rejects_an_active_id` (409); both ids streamable via `/simulation/{id}/stream`.
- [ ] **Step 2:** FAIL → implement → PASS. Regenerate contracts (command in Global Constraints); `git diff --stat contracts frontend/src/types` shows only additions.
- [ ] **Step 3:** Full backend checks + `cd frontend && npm run typecheck`. Commit `feat: add comparison start endpoint`.

### Task 4: Adapters

**Files:**
- Modify: `frontend/src/lib/simulation-adapter.ts` (type), `frontend/src/lib/transport/backend-simulation-adapter.ts` (+ test), `frontend/src/lib/mock-simulation-adapter.ts` (+ `mock-simulation-adapter.test.ts`), `frontend/src/lib/diagnostics/observe-adapters.ts` (+ test; capture as operation `"compare-start"`)

**Interfaces — Produces:** `SimulationAdapter.startComparison: (request: ComparisonStartRequest) => Promise<ComparisonStartResponse>` (rejects with `SimulationAdapterError`, same as `start`).

Mock: replace the single `session` with `sessions: Map<string, MockSession>` and `operation: string[]` (ids of the active operation); `start` and `startComparison` cancel the whole operation (`SUPERSEDED`); one shared timer emits the next tick for every unfinished session in the operation per interval; `stop(id)` cancels the whole operation; subscribers keyed by id.

- [ ] **Step 1: Failing tests:** backend adapter posts to `${baseUrl}/api/v1/simulation/compare/start` and validates the response (reuse `validate.ts`; add a `validateComparisonStartResponse` there with its test); mock: `it("streams both comparison runs on one clock")` (fake timers, both subscribers receive tick n before either receives n+1), `it("supersedes a running pair on a plain start")`, `it("stopping one comparison run stops both")`; observe wrapper records a `compare-start` capture.
- [ ] **Step 2:** FAIL → implement → PASS; full frontend checks. Commit `feat: start comparison pairs through both transports`.

### Task 5: Live comparison controller and race selectors

**Files:**
- Delete: `frontend/src/lib/comparison/recording.ts`, `replay.ts`, `comparison-controller.ts` and their tests; `frontend/src/components/comparison/ComparisonReplay.tsx`, `comparison-replay.test.tsx`
- Create: `frontend/src/lib/comparison/live-comparison.ts` (+ test), `frontend/src/lib/comparison/race.ts` (+ test)
- Modify: `frontend/src/lib/comparison/fixtures.test-support.ts`, `frontend/src/components/comparison/ComparisonProvider.tsx`

**Interfaces — Produces:**
- `type ComparisonMode = "ENABLED" | "DISABLED"`
- `type LiveComparisonState = { status: "idle" | "starting" | "running" | "finished" | "cancelled" | "error"; runs: Record<ComparisonMode, SimulationState>; priorityIds: string[]; reason: string | null }` (`runs` start as `initialSimulationState`).
- `createLiveComparisonController(adapter: SimulationAdapter, slot: ReturnType<typeof createOperationSlot>, timing: { staleAfterMilliseconds: number; lostAfterMilliseconds: number }) => { start(request: ComparisonStartRequest): Promise<void>; stop(): Promise<void>; reset(): void; getState(): LiveComparisonState; subscribe(listener: () => void): () => void }` — acquires slot `"comparison"`, calls `adapter.startComparison`, feeds `START_SUCCEEDED` per mode into `simulationReducer`, connects both streams with `connectSimulationStream`, accumulates `priorityIds` from ENABLED ticks (`state === "PRIORITY_GREEN"`), sets `finished` when both runs are FINISHED/CANCELLED, releases the slot on terminal/error/reset; superseded → `cancelled` with reason `"Comparison replaced by another simulation"`. `stop()` calls `adapter.stop(enabled id)`.
- `type RaceStanding = { leader: ComparisonMode | "LEVEL"; leadM: number; arrived: ComparisonMode | null; positions: Record<ComparisonMode, number> /* 0–1 share of route */ }`
- `raceStanding(route: SimulationStartResponse, runs: Record<ComparisonMode, SimulationState>): RaceStanding` — distance via `distanceAlongRoute(route.route_geometry, …)` of each run's latest `liveTelemetry.ambulance.position` (stale runs keep their last telemetry, so they freeze); LEVEL when `|lead| < 10`.
- `raceReadout(standing: RaceStanding): string` — exact copy from Global Constraints.
- `comparisonResult(runs: Record<ComparisonMode, SimulationState>, priorityIds: string[], route: SimulationStartResponse): { enabledSeconds: number; disabledSeconds: number; delta: number; label: string; prioritised: number; total: number } | null` — null until both have `completion`; `label` = previous `comparisonResultLabel` wording (move that function here).

- [ ] **Step 1: Failing tests** (`race.test.ts`): lead/leader both directions; LEVEL under 10 m; `raceReadout` exact strings incl. arrived variants and km formatting; `comparisonResult` null until both complete, delta sign and labels `Green Wave faster` / `standard traffic faster` / `same travel time`; `prioritised` counts unique ids. (`live-comparison.test.ts`, fake adapter): `start` acquires and releases the slot; both runs reach RUNNING; ENABLED ticks accumulate `priorityIds`; `finished` after both terminals; supersede → `cancelled` with the exact reason; `stale side freezes in the readout` (stop delivering ticks to one side → `raceStanding` positions for it unchanged); stopping after one arrival → status `finished` with the other run CANCELLED.
- [ ] **Step 2:** FAIL → implement → PASS. Remove deleted modules' imports (`grep -rn "comparison/replay\|comparison/recording\|ComparisonReplay" frontend/src`).
- [ ] **Step 3:** Full frontend checks. Commit `feat: drive the comparison from two live streams`.

### Task 6: Comparison workspace UI

**Files:**
- Rewrite: `frontend/src/components/comparison/ComparisonWorkspace.tsx`; create `ComparisonLivePane.tsx`, `RaceBar.tsx`, `ComparisonResultCard.tsx`
- Modify: `frontend/src/app/globals.css` (`.comparison-*`; delete `.comparison-transport*`, `.comparison-timeline*`, `.comparison-preparation`)
- Test: `frontend/src/components/comparison/comparison-workspace.test.tsx`

**Interfaces — Consumes:** Task 5 controller, `raceStanding`, `raceReadout`, `comparisonResult`; `MapContainer` with `snapshot={runs[mode]}` (existing prop).

Layout (mockup `comparison-live.html`, P2 styling): setup = existing `DispatchForm` flow with primary "Start comparison" (no mode toggle); running = two equal panes (desktop) each with a glass label chip (tone dot + "Green Wave" / "Standard traffic") and a glass stat chip (speed km/h, distance left); phone = one map + segmented toggle Green Wave / Standard traffic (toggle does not affect streams); below maps a glass `RaceBar` (route track, two vehicle dots in mode tones, readout text, "Station"/"Incident" ends); one Stop button. Finished = `ComparisonResultCard` over the maps (glass sheet): two arrival times (`formatMinutesSeconds`), delta line with label, "Signals given priority {n} of {total}", "New comparison" (calls `reset`). Cancelled/error = same card with the reason and "New comparison".

- [ ] **Step 1: Failing tests** (static render with controller state fixtures): running shows both pane labels, readout text and exactly one Stop; phone toggle present (class-gated); finished shows result card copy and no Stop/replay/scrub controls (`queryAll` for "Play", "Restart", `type="range"` → none); cancelled shows the reason.
- [ ] **Step 2:** FAIL → implement → PASS; snapshots; full checks.
- [ ] **Step 3:** Playwright (mock and backend transports): start comparison at 10×; screenshots every 5 s → `.tmp/playwright/p4/race-*.png`; assert via `--raw eval` that both panes' tick counters never differ by > 1; phone toggle; stop mid-race; plain Green Wave start in another tab supersedes; result card at end. Record durations.
- [ ] **Step 4:** Commit `feat: watch the comparison live with a race bar and result card`.

### Task 7: Closeout

- [ ] Full backend and frontend checks; `graphify update .`.
- [ ] Report: ADR 0008, architecture-doc edit, deleted recording/replay modules, Playwright evidence, proposed commits.
