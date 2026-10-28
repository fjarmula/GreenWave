# ER Green Wave mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user run one simulated dispatch with ER Green Wave enabled or disabled, accurately showing the selected intersection behaviour, zoom-only simulated movement lights, and the final total travel time.

**Architecture:** Add one canonical mode enum and additive phase telemetry in Pydantic, then carry those values through planning, engine state, motion and telemetry. The enabled path retains current priority behaviour; the disabled path never dispatches priority and applies a deterministic clearance-plus-speed-limited controlled crossing. The frontend remains transport-agnostic: the mock and backend adapters provide the same generated contract, the HUD builds the selected request, and MapLibre renders the received phase samples only above a high zoom threshold.

**Tech Stack:** Python 3.12, FastAPI, Pydantic, pytest; Next.js/React/TypeScript, MapLibre GL, Vitest, Tailwind; generated OpenAPI TypeScript types.

**Spec:** `docs/superpowers/specs/2026-10-20-er-green-wave-mode-design.md`

## Global Constraints

- Simulation only: never add live controller integration, commands, or operational safety claims.
- `GreenWaveMode.ENABLED` is the default and preserves the existing priority path; disabled never creates a corridor or ITS dispatch.
- Open-road route and ambulance edge-speed behaviour are identical in both modes.
- Standard crossings use the existing intersection delay scaled by traffic density plus a configurable, speed-limit-capped controlled distance.
- Signal phases are deterministic explanatory simulation data, labelled as such; phase markers are hidden below the high-zoom threshold.
- Pydantic schemas are canonical; export `contracts/openapi.json` and regenerate `frontend/src/types/api.generated.ts`, never hand-edit either.
- Add no dependencies. Follow `frontend/AGENTS.md`; inspect installed Next.js guidance before frontend production edits.
- Preserve unrelated dirty-worktree changes; stage explicit paths only and do not push, switch branches, or open a PR.

## Review Focus

- A legacy start request omitting the new mode must run as enabled; cover it in backend schema/API tests in Task 1.
- A disabled run with cascade enabled must still emit no ITS dispatch and no active corridor; cover it in Task 3.
- A controlled crossing spanning an edge boundary must cap speed across the full configured distance and then restore ambulance speed; cover it in Task 2.
- Missing/incomplete signal geometry must result in no invented phase markers, not an invalid start/tick payload; cover it in Tasks 1 and 5.
- A mock run and backend run must expose the same selected mode and phase shape to the dashboard; cover mock session/adapter parity in Task 4.

---

## File map

| File(s) | Responsibility |
|---|---|
| `backend/src/greenwave/schemas/simulation.py`, `schemas/__init__.py` | Canonical mode and simulated phase contract. |
| `backend/src/greenwave/simulation_settings.py`, `state.py`, `route_track.py`, `motion.py`, `engine.py`, `telemetry.py` | Deterministic enabled/disabled motion, phase projection, and event emission. |
| `backend/src/greenwave/simulation/assembly.py`, `route_model.py`, `routing/network_index.py` | Carry selected mode, suppress disabled cascade, and expose known signal locations. |
| `backend/src/greenwave/etl/intersections/frames.py`, `dataset/constants.py`, `dataset/integrity.py` | Persist and validate signal-point coordinates used by the read-only routing index. |
| `backend/tests/{schemas,simulation,routing,etl,dataset,api}/` | Contract, model, motion, phase, and integrity regression coverage. |
| `frontend/src/lib/{start-request,mock-session,mock-simulation-adapter,simulation-copy,transport/validate}.ts` | Build and validate the mode/phase contract and make mock transport match it. |
| `frontend/src/components/hud/{DispatchForm,RunSummary}.tsx`, `components/hud/dispatch/GreenWaveToggle.tsx` | Accessible mode selection and total-time-first summary. |
| `frontend/src/components/map/{MapContainer,SignalMarkers}.tsx` | High-zoom phase marker lifecycle and rendering. |
| `frontend/src/**/*.{test,snapshot.test}.{ts,tsx}` | Frontend behaviour, accessibility, adapter parity and visual snapshots. |

### Task 1: Freeze the additive mode and phase contract

**Files:**
- Modify: `backend/src/greenwave/schemas/simulation.py`, `backend/src/greenwave/schemas/__init__.py`
- Modify: `backend/src/greenwave/simulation/route_model.py`, `backend/src/greenwave/simulation/assembly.py`
- Modify: `backend/tests/schemas/test_simulation_contract.py`, `backend/tests/simulation/test_route_model.py`, `backend/tests/api/test_sse.py`
- Regenerate: `contracts/openapi.json`, `frontend/src/types/api.generated.ts`

**Interfaces:**
- Produces `GreenWaveMode(StrEnum) { ENABLED, DISABLED }`, `SignalPhaseColor(StrEnum) { RED, YELLOW, GREEN }`, `SignalMovementKind(StrEnum) { VEHICLE, PEDESTRIAN }`, and a `SignalPhaseIndicator` containing `intersection_id`, stable `signal_key`, `kind`, `color`, `position`, and `accessible_label`.
- Adds `green_wave_mode: GreenWaveMode = ENABLED` to `SimulationStartRequest` and `SimulationStartResponse`; adds `signal_phases: list[SignalPhaseIndicator]` to `SimulationTickEvent`.
- Consumes signal locations supplied through `RoutingIndex`; disabled planning passes `cascade_enabled=False` regardless of the request's legacy cascade toggle.

- [ ] **Step 1: Write failing schema and response tests**

Test default deserialisation of a start request without `green_wave_mode`, explicit enabled/disabled values, rejection of invalid mode/phase enums, presence of the mode in a start response, and a tick with zero or more valid phase indicators. Extend SSE fixtures so a tick must validate the new list.

- [ ] **Step 2: Run focused schema/API tests to verify failure**

Run: `cd backend && uv run pytest tests/schemas tests/api/test_sse.py -q`

Expected: FAIL because the new enums/fields are absent.

- [ ] **Step 3: Implement the canonical additive schemas and planning propagation**

Add the closed enums and models in `simulation.py`, re-export them, propagate `request.green_wave_mode` through `plan_simulation()`/`SimulationEngine`/`to_start_response()`, and calculate `effective_cascade_enabled = request.green_wave_mode is ENABLED and request.enable_cascade_mode`. Preserve the current default-enabled wire behaviour.

- [ ] **Step 4: Export the contract and regenerate frontend types**

Run: `cd backend && uv run python scripts/export_openapi.py && cd ../frontend && npm run generate:types`

Expected: generated OpenAPI and TypeScript include the new enum/models and fields.

- [ ] **Step 5: Run focused tests and generated-type drift checks**

Run: `cd backend && uv run pytest tests/schemas tests/simulation/test_route_model.py tests/api/test_sse.py -q && cd ../frontend && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the contract increment**

```bash
git add backend/src/greenwave/schemas/simulation.py backend/src/greenwave/schemas/__init__.py backend/src/greenwave/simulation/assembly.py backend/src/greenwave/simulation/route_model.py backend/tests/schemas backend/tests/simulation/test_route_model.py backend/tests/api/test_sse.py contracts/openapi.json frontend/src/types/api.generated.ts
git commit -m "feat: add ER Green Wave mode contract"
```

### Task 2: Persist usable signal locations and project deterministic phases

**Files:**
- Modify: `backend/src/greenwave/etl/intersections/frames.py`, `backend/src/greenwave/dataset/constants.py`, `backend/src/greenwave/dataset/integrity.py`
- Modify: `backend/src/greenwave/routing/network_index.py`
- Create: `backend/src/greenwave/simulation/phases.py`
- Modify: `backend/src/greenwave/simulation_settings.py`, `backend/src/greenwave/simulation/telemetry.py`
- Test: `backend/tests/etl/test_intersections.py`, `backend/tests/dataset/test_loader.py`, `backend/tests/routing/test_network_index.py`, `backend/tests/simulation/test_phases.py`

**Interfaces:**
- Produces `RoutingIndex.signal_approaches(intersection_id: str) -> tuple[SignalApproachRef, ...]`, where each reference has stable signal key and WGS84 position.
- Produces `project_signal_phases(route_model: RouteModel, state: EngineState, index: RoutingIndex, settings: SimulationSettings) -> list[SignalPhaseIndicator]`.
- Adds validated simulation settings for normal green/yellow/all-red phase durations and the documented controlled-crossing distance; all are deterministic `GREENWAVE_SIM_` inputs.

- [ ] **Step 1: Write failing ETL/index tests**

Add fixture assertions that `signal_approaches.parquet` carries WGS84 signal coordinates, integrity rejects their absence/invalidity, and the index returns stable per-intersection signal references. Include a no-approach intersection case that returns an empty tuple.

- [ ] **Step 2: Run the ETL/index tests to verify failure**

Run: `cd backend && uv run pytest tests/etl/test_intersections.py tests/dataset/test_loader.py tests/routing/test_network_index.py -q`

Expected: FAIL because coordinates and the index accessor do not exist.

- [ ] **Step 3: Persist and load real processed signal positions**

Extend the existing approach-frame construction to write the signal point's longitude/latitude, add those required columns and validation, and build an immutable `intersection_id -> SignalApproachRef[]` lookup. Preserve deterministic ordering by `(intersection_id, signal_key)` and do not synthesize coordinates for missing source data.

- [ ] **Step 4: Write failing phase-projection tests**

In `test_phases.py`, assert a fixed normal cycle produces only valid red/yellow/green values, pedestrian/vehicle conflict rules hold, `CLEARING`/`PRIORITY_GREEN` override the emergency route signal correctly, recovery returns to the cycle, and empty geometry produces no indicators.

- [ ] **Step 5: Implement `project_signal_phases(...)` and telemetry projection**

Use settings and simulated time only. Determine the emergency approach from the route stop-line/approach mapping; during priority hold it green and set conflicting vehicle/pedestrian signals red. Add `signal_phases=project_signal_phases(...)` to `tick_event()`; MapLibre must receive data only through this contract.

- [ ] **Step 6: Run focused phase/data tests**

Run: `cd backend && uv run pytest tests/etl/test_intersections.py tests/dataset/test_loader.py tests/routing/test_network_index.py tests/simulation/test_phases.py -q`

Expected: PASS.

- [ ] **Step 7: Commit the data and phase increment**

```bash
git add backend/src/greenwave/etl/intersections/frames.py backend/src/greenwave/dataset/constants.py backend/src/greenwave/dataset/integrity.py backend/src/greenwave/routing/network_index.py backend/src/greenwave/simulation/phases.py backend/src/greenwave/simulation_settings.py backend/src/greenwave/simulation/telemetry.py backend/tests/etl/test_intersections.py backend/tests/dataset/test_loader.py backend/tests/routing/test_network_index.py backend/tests/simulation/test_phases.py
git commit -m "feat: expose simulated intersection phases"
```

### Task 3: Model disabled intersection crossing without changing open-road motion

**Files:**
- Modify: `backend/src/greenwave/simulation/state.py`, `backend/src/greenwave/simulation/route_track.py`, `backend/src/greenwave/simulation/motion.py`, `backend/src/greenwave/simulation/engine.py`, `backend/src/greenwave/simulation/telemetry.py`
- Modify: `backend/src/greenwave/routing/estimates.py`
- Test: `backend/tests/simulation/test_engine.py`, `backend/tests/simulation/test_motion_modes.py`, `backend/tests/simulation/test_dispatch.py`, `backend/tests/routing/test_estimates.py`

**Interfaces:**
- `RouteTrack.speed_limit_mps(index: int) -> float` returns the unboosted current edge speed limit.
- `EngineState` records only the minimal immutable data needed to continue a standard controlled-crossing distance after a clearance dwell.
- `move_one_second(..., green_wave_mode: GreenWaveMode, traffic_density_multiplier: float) -> tuple[EngineState, float]` keeps existing enabled semantics and applies the disabled state machine.

- [ ] **Step 1: Write failing enabled/disabled motion tests**

Create a two-edge route with one stop line. Assert that before the stop line enabled and disabled positions/speeds match; enabled retains its current minimum dwell; disabled waits `delay_seconds * density`, is limited to unboosted speed over exactly the configured crossing distance (including across an edge), and immediately resumes ambulance speed. Assert arrival time and KPI reflect the selected actual motion.

- [ ] **Step 2: Run focused motion tests to verify failure**

Run: `cd backend && uv run pytest tests/simulation/test_engine.py tests/simulation/test_motion_modes.py tests/routing/test_estimates.py -q`

Expected: FAIL because the engine has no mode-aware crossing state.

- [ ] **Step 3: Implement the smallest explicit crossing state machine**

Add validated controlled-crossing/clearance settings. Preserve `dwell_remaining_s` semantics or introduce clearly named immutable fields for standard clearance and remaining capped distance; do not overload a value so telemetry cannot identify a crossing. Add unboosted edge-speed lookup to `RouteTrack`, carry 1-second budget over edges and phase boundaries, and retain fractional arrival precision.

- [ ] **Step 4: Make estimates and KPI semantics mode-aware**

Have `estimate_times()` expose the selected-run estimate (or a named mode-specific estimate) used by start response and the engine. The final `total_time_elapsed_sec` must be exact simulated arrival in either mode; do not describe a disabled run's result as GreenWave time. Keep any comparative `current_time_saved_sec` explicitly based on documented simulated baselines.

- [ ] **Step 5: Prevent priority side effects when disabled**

Test and implement that disabled runs never call `advance_corridor` into active states and never invoke gateway dispatch, even if `enable_cascade_mode=True`; phase telemetry still follows the normal cycle. Preserve all enabled dispatch/cascade tests unchanged.

- [ ] **Step 6: Run focused backend tests**

Run: `cd backend && uv run pytest tests/simulation/test_engine.py tests/simulation/test_motion_modes.py tests/simulation/test_dispatch.py tests/routing/test_estimates.py -q`

Expected: PASS.

- [ ] **Step 7: Commit the mode-aware engine increment**

```bash
git add backend/src/greenwave/simulation/state.py backend/src/greenwave/simulation/route_track.py backend/src/greenwave/simulation/motion.py backend/src/greenwave/simulation/engine.py backend/src/greenwave/simulation/telemetry.py backend/src/greenwave/routing/estimates.py backend/tests/simulation/test_engine.py backend/tests/simulation/test_motion_modes.py backend/tests/simulation/test_dispatch.py backend/tests/routing/test_estimates.py
git commit -m "feat: simulate standard intersection crossings"
```

### Task 4: Make the frontend request and mock transport mode-aware

**Files:**
- Create: `frontend/src/components/hud/dispatch/GreenWaveToggle.tsx`
- Modify: `frontend/src/components/hud/DispatchForm.tsx`, `frontend/src/lib/start-request.ts`, `frontend/src/lib/mock-session.ts`, `frontend/src/lib/mock-simulation-adapter.ts`, `frontend/src/lib/transport/validate.ts`
- Test: `frontend/src/lib/start-request.test.ts`, `frontend/src/lib/mock-session.test.ts`, `frontend/src/lib/mock-simulation-adapter.test.ts`, `frontend/src/lib/transport/validate.test.ts`, `frontend/src/components/hud/DispatchForm.snapshot.test.tsx`

**Interfaces:**
- `DispatchSettings` gains `greenWaveMode: GreenWaveMode`; `buildStartRequest(...)` writes it to the generated request type.
- `GreenWaveToggle({ mode, onChange })` has accessible Enabled/Disabled controls and simulation-only explanatory copy.
- Mock start/tick objects carry the generated `green_wave_mode` and `signal_phases` fields, matching backend validation shape.

- [ ] **Step 1: Write failing request/control/mock tests**

Assert default UI mode is enabled, an accessible change produces `DISABLED` in `DispatchSettings` and the start request, mock disabled runs emit no dispatch/corridor state, and malformed/missing phase fields are rejected by the transport validator.

- [ ] **Step 2: Run focused frontend tests to verify failure**

Run: `cd frontend && npm test -- start-request.test.ts mock-session.test.ts mock-simulation-adapter.test.ts transport/validate.test.ts components/hud/DispatchForm.snapshot.test.tsx`

Expected: FAIL because the UI and mock lack the mode/phase contract.

- [ ] **Step 3: Implement the request control and mock parity**

Place the new ER Green Wave control beside traffic parameters; retain cascade control only as an enabled-mode implementation option, disabling/explaining it when Green Wave is disabled. Update the mock's route time/progress/corridor transitions to reproduce the selected mode at contract level, including deterministic phase samples. Keep mock values visibly synthetic.

- [ ] **Step 4: Extend validation and run focused frontend tests**

Update narrow guards only for fields the UI reads; validate enum membership, finite positions, and phase indicator arrays. Run the Step 2 command again.

Expected: PASS.

- [ ] **Step 5: Commit the request/transport increment**

```bash
git add frontend/src/components/hud/dispatch/GreenWaveToggle.tsx frontend/src/components/hud/DispatchForm.tsx frontend/src/lib/start-request.ts frontend/src/lib/mock-session.ts frontend/src/lib/mock-simulation-adapter.ts frontend/src/lib/transport/validate.ts frontend/src/lib/*.test.ts frontend/src/lib/transport/validate.test.ts frontend/src/components/hud/DispatchForm.snapshot.test.tsx
git commit -m "feat: add ER Green Wave mode control"
```

### Task 5: Render zoom-only phase detail and total time first

**Files:**
- Modify: `frontend/src/components/map/MapContainer.tsx`, `frontend/src/components/map/SignalMarkers.tsx`
- Modify: `frontend/src/lib/simulation-copy.ts`, `frontend/src/components/hud/RunSummary.tsx`
- Test: `frontend/src/components/map/SignalMarkers.test.tsx`, `frontend/src/lib/simulation-copy.test.ts`, `frontend/src/components/hud/RunSummary.snapshot.test.tsx`

**Interfaces:**
- `SignalMarkers` consumes `SignalPhaseIndicator[]`, listens for `zoomend`, and renders no phase DOM below `SIGNAL_PHASE_DETAIL_ZOOM`.
- `summarizeFinishedRun(route, finalKpis)` returns a first item labelled `Total travel time`, followed by secondary simulated/comparative values only where their labels remain accurate for the selected mode.

- [ ] **Step 1: Write failing map and summary tests**

Use a MapLibre marker test double to assert phase markers are absent below the threshold, appear at supplied backend positions above it, update colour/ARIA label on a tick, and remove cleanly when phases disappear or the component unmounts. Assert the finished summary leads with final total time and identifies the selected ER Green Wave mode.

- [ ] **Step 2: Run focused frontend tests to verify failure**

Run: `cd frontend && npm test -- components/map/SignalMarkers.test.tsx lib/simulation-copy.test.ts components/hud/RunSummary.snapshot.test.tsx`

Expected: FAIL because map markers still represent only intersection state and the summary is not total-time-first.

- [ ] **Step 3: Replace the state-dot overlay with a high-zoom phase layer**

Keep marker lifecycle isolated in `SignalMarkers`. Subscribe to zoom only while a map exists, use backend-provided positions/labels without geometry fabrication, render vehicle and pedestrian indicators with visible text/ARIA labels and a simulated-state cue, and preserve cleanup across MapLibre style changes. Pass tick phases through `MapContainer`.

- [ ] **Step 4: Update summary copy and tests**

Use `completion.kpi_metrics.total_time_elapsed_sec` as the primary result. Display the persisted selected mode and make any retained normal/GreenWave estimates conditional and accurately labelled. Do not present a simultaneous comparison or real-world claim.

- [ ] **Step 5: Run focused frontend tests**

Run: `cd frontend && npm test -- components/map/SignalMarkers.test.tsx lib/simulation-copy.test.ts components/hud/RunSummary.snapshot.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the map/summary increment**

```bash
git add frontend/src/components/map/MapContainer.tsx frontend/src/components/map/SignalMarkers.tsx frontend/src/lib/simulation-copy.ts frontend/src/components/hud/RunSummary.tsx frontend/src/components/map/SignalMarkers.test.tsx frontend/src/lib/simulation-copy.test.ts frontend/src/components/hud/RunSummary.snapshot.test.tsx
git commit -m "feat: show detailed simulated signal phases"
```

### Task 6: Regenerate artifacts and verify the complete feature

**Files:**
- Modify only generated contract files if Task 1's schema output changed: `contracts/openapi.json`, `frontend/src/types/api.generated.ts`
- Modify: `GreenWave_ARCHITECTURE.md` and/or an ADR only if the final additive contract decisions need a durable accepted record; notify the human before editing either.

**Interfaces:**
- Consumes the finished canonical schema and all backend/frontend test suites.
- Produces fresh verification evidence; no code behaviour is added in this task.

- [ ] **Step 1: Re-export OpenAPI and generated types from the final schema**

Run: `cd backend && uv run python scripts/export_openapi.py && cd ../frontend && npm run generate:types`

Expected: no hand edits; generated diff is limited to the approved mode/phase contract.

- [ ] **Step 2: Run backend quality gates**

Run: `cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`

Expected: all commands exit 0.

- [ ] **Step 3: Run frontend quality gates**

Run: `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`

Expected: all commands exit 0.

- [ ] **Step 4: Review the focused diff and contract drift**

Run: `git diff --check && git diff -- backend frontend contracts docs/superpowers/specs/2026-10-20-er-green-wave-mode-design.md docs/superpowers/plans/2026-10-20-er-green-wave-mode.md && git status --short`

Expected: no whitespace errors; only scoped feature files and generated artifacts changed.

- [ ] **Step 5: Commit verification/documentation changes if needed**

```bash
git add contracts/openapi.json frontend/src/types/api.generated.ts GreenWave_ARCHITECTURE.md docs/adr
git commit -m "docs: record ER Green Wave mode contract"
```

Only stage files that actually changed and only after explicit human notice if architecture documentation is edited.

## Self-review

- **Spec coverage:** Task 1 covers the canonical selectable mode and generated contract; Task 2 creates deterministic, backend-owned phase data from real available signal positions; Task 3 delivers the two movement policies and blocks disabled priority; Task 4 keeps mock/backend transports coherent and exposes the choice; Task 5 provides high-zoom UI and total-time-first outcome; Task 6 verifies every acceptance criterion.
- **Type consistency:** `GreenWaveMode` and `SignalPhaseIndicator` originate in Pydantic, are generated into TypeScript, pass through request/response/tick state, and are consumed only by transport-agnostic UI components.
- **Review-focus coverage:** Legacy default: Task 1. Disabled cascade/dispatch: Task 3. Crossing across edge boundary: Task 3. Missing geometry: Task 2/5. Transport parity: Task 4.
- **Proportion:** The plan defines interfaces, values and verification without prescribing implementation bodies. ETL location persistence is included because the current dataset/index has no per-signal WGS84 coordinate usable by the requested per-side map detail.
