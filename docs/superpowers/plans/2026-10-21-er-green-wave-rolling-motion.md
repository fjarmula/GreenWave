# ER Green Wave Rolling Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make disabled ER Green Wave red/yellow crossings roll at a positive cautious speed rather than stop, while keeping enabled and green movement unchanged.

**Architecture:** The motion loop consumes the canonical phase decision from the phase-domain plan. It models a controlled crossing as distance plus an extra cautious-time budget distributed across edge segments, preserving determinism, speed caps, and exact arrival time.

**Tech Stack:** Python 3.12, Pydantic Settings, pytest.

**Spec:** `docs/superpowers/specs/2026-10-21-er-green-wave-corrections-design.md`

## Global Constraints

- Execute `2026-10-21-er-green-wave-phase-domain.md` first.
- Enabled-mode dwell and priority behaviour remain equivalent in tests.
- Disabled red/yellow speed is positive and no greater than the ordinary current-edge limit.
- Disabled green movement remains normal ambulance motion.
- Disabled runs still create no corridor activation, cascade, or ITS event.

## Review Focus

- The controlled crossing crosses an edge boundary with different speed limits.
- A second stop line inside the controlled distance starts a fresh penalty.
- `standard_crossing_distance_m == 0` with a positive delay is rejected.
- Terminal telemetry reports actual movement during the arrival tick.
- A legacy omitted mode preserves the enabled path.

---

### Task 1: Make cautious-crossing state explicit

**Files:**
- Modify: `backend/src/greenwave/simulation/state.py`, `backend/src/greenwave/simulation_settings.py`
- Test: `backend/tests/simulation/test_motion_modes.py`

**Interfaces:**
- `EngineState` gains `cautious_crossing_remaining_m: float` and `cautious_time_remaining_s: float`.
- `SimulationSettings.standard_crossing_distance_m` is strictly positive.

- [ ] **Step 1: Write failing state/configuration tests**

Assert zero and negative crossing distances are rejected and a disabled red entry has explicit remaining distance and cautious time rather than `dwell_remaining_s`.

- [ ] **Step 2: Run focused test to verify failure**

Run: `cd backend && uv run pytest tests/simulation/test_motion_modes.py -q`

Expected: FAIL because disabled mode still creates a dwell.

- [ ] **Step 3: Add immutable cautious-crossing fields and validation**

Keep `dwell_remaining_s` solely for the enabled minimum dwell. Change the setting field to a strictly positive finite distance and update the former zero-distance regression accordingly.

- [ ] **Step 4: Run focused test to verify pass**

Run: `cd backend && uv run pytest tests/simulation/test_motion_modes.py -q`

Expected: PASS.

### Task 2: Apply phase decisions in motion

**Files:**
- Modify: `backend/src/greenwave/simulation/motion.py`, `backend/src/greenwave/simulation/engine.py`, `backend/src/greenwave/simulation/telemetry.py`
- Test: `backend/tests/simulation/test_motion_modes.py`, `backend/tests/simulation/test_engine.py`, `backend/tests/simulation/test_dispatch.py`

**Interfaces:**
- `move_one_second(...)` accepts `route_movement_color_at(intersection_id, at_s) -> SignalPhaseColor | None`; it calls it with the exact in-tick time the stop line is reached.
- `cautious_speed_mps(limit_mps: float, remaining_distance_m: float, remaining_extra_s: float) -> float` returns `1 / (1 / limit_mps + remaining_extra_s / remaining_distance_m)`.

- [ ] **Step 1: Write failing behaviour tests**

Assert disabled red and yellow crossings have nonzero movement in every crossing tick, never exceed the speed limit, and consume the same total added cautious time. Assert disabled green has no penalty and enabled tests stay unchanged.

- [ ] **Step 2: Run focused motion/engine tests to verify failure**

Run: `cd backend && uv run pytest tests/simulation/test_motion_modes.py tests/simulation/test_engine.py tests/simulation/test_dispatch.py -q`

Expected: FAIL because disabled motion does not inspect phases and dwells at the stop line.

- [ ] **Step 3: Implement rolling cautious traversal**

At each unpassed disabled stop line, call the canonical route-movement function with `state.simulated_time_s + elapsed_in_step`. For RED, YELLOW, or `None`, initialize both cautious budgets; distribute extra time by traversed controlled distance across edges. For GREEN, do not initialize a penalty. A later stop line replaces an active cautious budget. Engine telemetry calls that same canonical programme after motion, before display-head constraints.

- [ ] **Step 4: Correct arrival-tick telemetry speed**

Return the actual distance moved in an arrival tick to `ambulance_telemetry`, while retaining `ARRIVED` and exact fractional `arrived_at_s`.

- [ ] **Step 5: Run focused tests to verify pass**

Run: `cd backend && uv run pytest tests/simulation/test_motion_modes.py tests/simulation/test_engine.py tests/simulation/test_dispatch.py -q`

Expected: PASS.

### Task 3: Verify estimates and regression coverage

**Files:**
- Modify only if required: `backend/src/greenwave/routing/estimates.py`
- Test: `backend/tests/routing/test_estimates.py`, `backend/tests/simulation/test_motion_modes.py`

- [ ] **Step 1: Write failing cross-edge and deterministic replay tests**

Use two speed-limit edges and a fixed phase clock. Assert arrival equals the segment-time formula, repeated runs match, and disabled never dispatches or activates a corridor.

- [ ] **Step 2: Implement only necessary estimate changes**

Keep final KPI time authoritative for disabled runs; do not add a misleading GreenWave estimate to disabled presentation.

- [ ] **Step 3: Run focused checks**

Run: `cd backend && uv run pytest tests/simulation/test_motion_modes.py tests/simulation/test_engine.py tests/simulation/test_dispatch.py tests/routing/test_estimates.py -q`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/greenwave/simulation/state.py backend/src/greenwave/simulation_settings.py backend/src/greenwave/simulation/motion.py backend/src/greenwave/simulation/engine.py backend/src/greenwave/simulation/telemetry.py backend/src/greenwave/routing/estimates.py backend/tests/simulation/test_motion_modes.py backend/tests/simulation/test_engine.py backend/tests/simulation/test_dispatch.py backend/tests/routing/test_estimates.py
git commit -m "fix: roll through simulated red crossings"
```
