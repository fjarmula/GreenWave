# ER Green Wave Phase Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define one deterministic simulated phase decision that identifies supported vehicle/pedestrian movements and drives both motion and map telemetry.

**Architecture:** Keep source classification and phase grouping in backend domain data. Extract a pure phase-decision result from display-head progression, then project that result into existing `SignalPhaseIndicator` telemetry; no MapLibre component determines a phase.

**Tech Stack:** Python 3.12, Polars, Pydantic, pytest.

**Spec:** `docs/superpowers/specs/2026-10-21-er-green-wave-corrections-design.md`

## Global Constraints

- Phase colours are deterministic explanatory simulation data, never live controller data.
- `traffic_signals` supports vehicle and pedestrian indicators; `pedestrian_crossing` supports pedestrian only.
- Derive normal groups from controlled approach identity, never `signal_key` sort position.
- Do not fabricate a position when source geometry is absent.
- Preserve priority conflict rules and legal displayed vehicle transitions.

## Review Focus

- An unknown `node_type` is rejected or omitted explicitly, never rendered as a vehicle signal.
- Multiple controlled edges on one source node map to one stable movement group.
- Reordered source rows preserve the same phase decision.
- A route approach with no matching supported vehicle signal returns `None`; disabled motion treats it conservatively while telemetry emits no invented marker.
- Display-head history cannot change the movement colour used by motion.

---

### Task 1: Represent supported simulated movements and stable groups

**Files:**
- Modify: `backend/src/greenwave/routing/network_index.py`, `backend/src/greenwave/simulation/route_model.py`
- Modify: `backend/tests/routing/test_network_index.py`, `backend/tests/simulation/test_phases.py`

**Interfaces:**
- Produces `SignalApproachRef.movement_kinds: tuple[SignalMovementKind, ...]` and `movement_group: str | None`.
- Produces `RouteIntersection.route_signal_keys: frozenset[str]` for the current route approach.

- [ ] **Step 1: Write the failing domain tests**

Assert `traffic_signals` produces `(VEHICLE, PEDESTRIAN)`, `pedestrian_crossing` produces `(PEDESTRIAN,)`, unknown types are omitted, and route approach grouping is stable when input rows are reordered. Cover more than two groups and an empty controlled-edge identity. Add the legacy start request omitting `green_wave_mode` regression in `backend/tests/schemas/test_simulation_schemas.py` or `backend/tests/api/test_simulation_api.py`.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `cd backend && uv run pytest tests/routing/test_network_index.py tests/simulation/test_phases.py -q`

Expected: FAIL because movement support and stable groups are absent.

- [ ] **Step 3: Implement source-node classification and grouping**

Create the movement tuple from persisted `node_type`; set `movement_group` to the joined sorted controlled-edge ids or `None` when empty. Per intersection, sort unique non-null groups and assign their ordinal modulo two. Build `route_signal_keys` only from vehicle-capable source nodes whose controlled edges meet `approach_edge_ids`.

- [ ] **Step 4: Run focused tests to verify pass**

Run: `cd backend && uv run pytest tests/routing/test_network_index.py tests/simulation/test_phases.py -q`

Expected: PASS.

### Task 2: Extract the canonical phase decision

**Files:**
- Modify: `backend/src/greenwave/simulation/phases.py`, `backend/src/greenwave/simulation/state.py`
- Test: `backend/tests/simulation/test_phases.py`

**Interfaces:**
- Produces `PhaseDecision` with `intersection_id`, `signal_key`, `kind`, `movement_color`, and `position`.
- Produces `route_movement_color_at(route_model: RouteModel, state: EngineState, intersection_id: str, at_s: float, settings: SimulationSettings) -> SignalPhaseColor | None` and `phase_decisions(..., at_s: float) -> tuple[PhaseDecision, ...]`.
- `advance_signal_phases(...)` consumes these decisions and only applies display-head transition constraints.

- [ ] **Step 1: Write failing decision tests**

Test green/yellow/red route movement lookup, priority overrides, pedestrian-only output, phase-less intersections returning `None`, equality with reordered references, and that pedestrians stay red during CLEARING/PRIORITY_GREEN.

- [ ] **Step 2: Run focused test to verify failure**

Run: `cd backend && uv run pytest tests/simulation/test_phases.py -q`

Expected: FAIL because the pure phase-decision interface does not exist.

- [ ] **Step 3: Implement `phase_decisions(...)`**

Build normal slots from the per-intersection group ordinal; use `route_signal_keys` only for vehicle CLEARING/PRIORITY overrides; omit unsupported/null-group kinds. Keep `SignalHead` responsible only for legal displayed vehicle transitions.

- [ ] **Step 4: Project existing telemetry from decisions**

Update `advance_signal_phases(...)` to emit one `SignalPhaseIndicator` per supported decision after applying the legal displayed state; preserve the existing public indicator shape unless a new field is proven necessary.

- [ ] **Step 5: Run focused tests**

Run: `cd backend && uv run pytest tests/simulation/test_phases.py -q`

Expected: PASS.

### Task 3: Verify the phase-domain increment

**Files:**
- Modify only if required: `contracts/openapi.json`, `frontend/src/types/api.generated.ts`

- [ ] **Step 1: Export the contract only if a Pydantic public schema changed**

Run: `cd backend && uv run python scripts/export_openapi.py && cd ../frontend && npm run generate:types`

Expected: generated changes only when a public schema changed.

- [ ] **Step 2: Run focused backend checks**

Run: `cd backend && uv run ruff check src/greenwave/routing/network_index.py src/greenwave/simulation/phases.py src/greenwave/simulation/route_model.py tests/routing/test_network_index.py tests/simulation/test_phases.py && uv run pytest tests/routing/test_network_index.py tests/simulation/test_phases.py -q`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/src/greenwave/routing/network_index.py backend/src/greenwave/simulation/route_model.py backend/src/greenwave/simulation/phases.py backend/src/greenwave/simulation/state.py backend/tests/routing/test_network_index.py backend/tests/simulation/test_phases.py
# Add contracts/openapi.json and frontend/src/types/api.generated.ts only if Step 1 changed them.
git commit -m "fix: model simulated signal movements"
```
