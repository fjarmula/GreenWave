# P1 Quick Fixes (JSON response-only, rolling corridor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Also: test-driven-development, verification-before-completion, playwright-cli. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The JSON dialog shows only the response, and in Green Wave mode the vehicle slows through junctions instead of stopping.

**Architecture:** The JSON fix is a component simplification. The motion fix reuses the existing rolling-crossing mechanism in `motion.py` (`cautious_crossing_remaining_m` / `cautious_time_remaining_s` + `cautious_speed_mps`): in ENABLED mode `D_min` is spread over an approach window ending at each intersection's first stop line, extended past the line when needed to respect a speed floor. The red-light safety hold at the line is unchanged. The mock gets the same visible slowdown.

**Tech Stack:** Python 3.12, Pydantic settings, pytest; Next.js/React, Vitest; `@playwright/cli`.

**Spec:** `docs/superpowers/specs/2026-10-23-soft-glass-live-comparison-design.md` (sections P1a, P1b).

## Global Constraints

- Trip time in ENABLED mode stays exactly `T_greenwave` (`estimated_greenwave_time_sec`); DISABLED motion is unchanged byte-for-byte.
- The vehicle never shows 0 km/h for `D_min`; only the safety hold (route light not last shown green at the stop line) may stop it.
- Slowdown never below `greenwave_min_rolling_speed_kmh` (default 15 km/h); approach window `greenwave_approach_distance_m` (default 60 m).
- No dependency/lockfile changes. Generated contracts are not touched (no schema change in P1).
- `GreenWave_ARCHITECTURE.md` edit is pre-approved by the human (2026-10-23 brainstorm); mention it in the milestone report.
- Checks: `cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`; `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`.
- Commit subjects `<category>: <message>`; stage explicit paths only.

## Review Focus

1. Two junctions closer than the approach window: second window starts at the first line, not earlier; trip time still exact. Test in Task 2 (`test_close_junctions_share_the_gap_and_keep_trip_time`).
2. Route starting on or just before a stop line (window ≈ 0 m): the remainder is spent past the line at the floor, no dwell at 0 km/h. Task 2 (`test_zero_window_spends_d_min_past_the_line`).
3. Late priority (light not green at the line): the vehicle still holds at the line and resumes rolling the remaining slowdown afterwards. Task 2 (`test_safety_hold_still_waits_for_green`).
4. Edge speed below the floor (slow street): no division by zero / negative distance; window used as-is. Task 2 (`test_slow_edge_below_floor_uses_window_only`).
5. Route ending inside a slowdown window: arrival recorded, crossing fields cleared. Task 2 (`test_arrival_inside_a_slowdown_clears_the_crossing`).

---

### Task 1: JSON dialog shows the response only

**Files:**
- Modify: `frontend/src/components/diagnostics/JsonDetails.tsx` (remove `side` state, the `hud-segmented` "Payload direction" group and request branches)
- Test: `frontend/src/components/diagnostics/endpoint-json.test.tsx`

- [ ] **Step 1: Failing test** `it("shows only the response body, with no request/response switch")`: render `OpenJsonViewer` via `JsonViewer` with a capture having `requestBody: '{"x":1}'`, `responseBody: '{"y":2}'` (static markup, as the existing test does). Assert markup contains `"y": 2`, does not contain `aria-label="Payload direction"`, does not contain `Request body`, and the copy button text is `Copy response` (or `Copy event` when `eventType` is set).
- [ ] **Step 2:** `cd frontend && npx vitest run src/components/diagnostics/endpoint-json.test.tsx` → FAIL.
- [ ] **Step 3:** Implement: body/omitted always from `responseBody`/`responseOmitted`; empty note "No response body captured for this observation."; `<pre aria-label>` is `Event body` or `Response body`.
- [ ] **Step 4:** Same command → PASS; update any snapshot that changed and review the diff.
- [ ] **Step 5:** Commit `fix: show only the response in the JSON viewer`.

### Task 2: Rolling slowdown in ENABLED motion (backend)

**Files:**
- Modify: `backend/src/greenwave/simulation_settings.py` (add two settings after `min_intersection_delay_seconds`)
- Modify: `backend/src/greenwave/simulation/motion.py` (`move_one_second`, new helper)
- Modify: `backend/src/greenwave/simulation/state.py` (docstring + one field)
- Test: `backend/tests/simulation/test_motion_modes.py`; regenerate `backend/tests/simulation/golden/engine_events.json` deliberately

**Interfaces:**
- Produces settings: `greenwave_approach_distance_m: float = Field(default=60, gt=0, allow_inf_nan=False)`, `greenwave_min_rolling_speed_kmh: float = Field(default=15, gt=0, allow_inf_nan=False)`, each with a `# APPROVED 2026-10-23 (human): ...` comment like neighbours.
- Produces `EngineState.slowdown_intersection_id: str | None = None` — the intersection whose `D_min` slowdown has been started (so it is started once).
- Produces `greenwave_slowdown(item_line_m: float, window_start_m: float, speed_mps: float, settings: SimulationSettings) -> float` in `motion.py`: returns the slowdown length in metres = `max(item_line_m - window_start_m, needed)` where `needed = D_min / (1/v_floor - 1/speed_mps)` when `speed_mps > v_floor`, else `item_line_m - window_start_m`. `D_min = settings.min_intersection_delay_seconds`, `v_floor = greenwave_min_rolling_speed_kmh / 3.6`.

Algorithm for ENABLED (replaces the dwell; DISABLED branch untouched):
- `window_start_m = max(previous passed first stop line or 0.0, line_m - greenwave_approach_distance_m)` for the next unpassed intersection (`next_stop`).
- The window start is a motion limit like an edge end. On reaching it (and `slowdown_intersection_id != stop.id`), set `crossing = greenwave_slowdown(...)`, `cautious = D_min`, `slowdown_intersection_id = stop.id`. While `crossing > 0` the speed is `cautious_speed_mps(track.speed_mps(edge), crossing, cautious)` (ambulance speed, **not** the ordinary limit used by DISABLED).
- On reaching the first stop line: `dwell = 0`, `dwelling = stop.id` (keeps the existing `may_leave_stop_line` safety hold); the crossing fields persist through the hold and continue past the line.
- `_ambulance_status` in `telemetry.py` already reports `CROSSING_INTERSECTION` while `cautious_crossing_remaining_m > 0`; no change.

- [ ] **Step 1: Failing tests** (reuse `_engine`, `_run`, `_at` helpers; `GREEN` phase programme):
  - Replace `test_enabled_mode_keeps_the_minimum_dwell_whatever_the_phase` with `test_enabled_mode_keeps_d_min_in_trip_time_whatever_the_phase`: same assertions as today (`arrived_at_s == approx(200/13 + 3)`, crossing fields 0 at the end) for `phase in [None, GREEN, YELLOW, RED]`; priority reaches the light long before arrival in this fixture, so no phase holds.
  - `test_enabled_vehicle_never_stops_at_a_cleared_light`: GREEN phase; every state with `simulated_time_s` in 1..arrival has `distance_travelled_m` strictly greater than the previous state's.
  - `test_enabled_slowdown_respects_the_floor`: GREEN; per-second distance deltas ≥ `15/3.6 - 1e-6` for all seconds before arrival.
  - `test_close_junctions_share_the_gap_and_keep_trip_time`: `stop_lines=(90.0, 110.0)`, GREEN → `arrived_at_s == approx(200/13 + 6)`.
  - `test_zero_window_spends_d_min_past_the_line`: `stop_lines=(0.5,)` → no second with zero movement; `arrived_at_s == approx(200/13 + 3)`.
  - `test_safety_hold_still_waits_for_green`: RED programme in ENABLED with `clearing_tti_seconds`/`priority_green_tti_seconds` set to 0 via settings overrides so priority never arrives in time → at least one second with zero movement at `distance_travelled_m == 90.0`.
  - `test_slow_edge_below_floor_uses_window_only`: `speeds_kmh=(10.0, 10.0)` → finite, `arrived_at_s` approx `200/(13*10/36) + 3` (use the track's own speed; assert via `engine` estimates if simpler: equals `Estimates.greenwave_seconds` built for that speed).
  - `test_arrival_inside_a_slowdown_clears_the_crossing`: `stop_lines=(195.0,)` → final state `cautious_crossing_remaining_m == 0.0` and `arrived`.
  - `test_greenwave_slowdown_length`: `greenwave_slowdown(90.0, 30.0, 13.0, SimulationSettings()) == approx(60.0)`; with window 5 m returns `approx(3 / (1/(15/3.6) - 1/13))`; with `speed_mps=3.0` returns the window.
- [ ] **Step 2:** `cd backend && uv run pytest tests/simulation/test_motion_modes.py -v` → new tests FAIL.
- [ ] **Step 3:** Implement settings, state field, `greenwave_slowdown`, and the ENABLED branch in `move_one_second` per the algorithm above. Update the `move_one_second` and `EngineState` docstrings (dwell → slowdown + safety hold).
- [ ] **Step 4:** Motion tests PASS. Run `uv run pytest tests/simulation -v`; for `test_engine_golden.py` regenerate the golden file with the repo's documented regeneration path (read the test header), then `git diff --stat backend/tests/simulation/golden/` and confirm only ENABLED positions/speeds/statuses changed and `ARRIVED`/completion ticks are unchanged.
- [ ] **Step 5:** Full backend checks green.
- [ ] **Step 6:** Commit `fix: roll through green-corridor junctions instead of stopping`.

### Task 3: Architecture and invariants docs

**Files:**
- Modify: `GreenWave_ARCHITECTURE.md` §2 paragraph starting "In the simulation the ambulance dwells $D_{\min}$" (~line 137) and the state-machine bullet near line 192 mentioning "dwelling $D_{\min}$ or held for green"; `CROSSING_INTERSECTION` description (~line 387).
- Modify: `docs/engineering/domain-invariants.md` if it mentions the dwell (`grep -n "dwell\|D_min\|D_{\\\\min" docs/engineering/domain-invariants.md`).

- [ ] **Step 1:** Rewrite to: the ambulance spends $D_{\min}$ as a rolling slowdown over the last `greenwave_approach_distance_m` (60 m) before each intersection's first controlled stop line, never below `greenwave_min_rolling_speed_kmh` (15 km/h), continuing past the line when the window is too short; it still waits at the line if a route light was not last shown green. $T_{\mathrm{greenwave}}$ formula unchanged.
- [ ] **Step 2:** Commit `docs: describe rolling green-corridor slowdown`.

### Task 4: Mock parity (visible slowdown)

**Files:**
- Modify: `frontend/src/lib/mock-simulation-config.ts` (add `MOCK_MIN_INTERSECTION_DELAY_SECONDS = 3`, `MOCK_GREENWAVE_APPROACH_DISTANCE_M = 60`, `MOCK_MIN_ROLLING_SPEED_MPS = 15 / 3.6`)
- Modify: `frontend/src/lib/mock-session.ts` (`mockTimeline`)
- Test: `frontend/src/lib/mock-session.test.ts`, `frontend/src/lib/mock-simulation-adapter.golden.test.ts`

Today the mock drives at `total / greenwaveSeconds`, i.e. `D_min` already spread over the whole route, so it never stops but shows no slowdown. Change ENABLED to open-road speed `total / (greenwaveSeconds - n * MOCK_MIN_INTERSECTION_DELAY_SECONDS)` (n = route intersections) plus, before each stop, a crossing leg built exactly like the backend (window, floor extension) reusing `cautiousSpeedMps(ambulanceMps, crossing, delay)`.

- [ ] **Step 1: Failing tests** in `mock-session.test.ts`: `it("slows before each junction in Green Wave mode and keeps the trip time")` — ENABLED request; `session.timeline.tripSeconds` ≈ `greenwaveSeconds` (±1e-6); the leg ending at each `distance_along_route_m` has `speedMps < ambulance open-road speed` and ≥ `MOCK_MIN_ROLLING_SPEED_MPS`. `it("never reports 0 km/h in Green Wave mode")` — advance to completion, every tick `ambulance.speed_kmh > 0` before ARRIVED.
- [ ] **Step 2:** `cd frontend && npx vitest run src/lib/mock-session.test.ts` → FAIL.
- [ ] **Step 3:** Implement in `mockTimeline`.
- [ ] **Step 4:** PASS; run `npx vitest run src/lib/mock-simulation-adapter.golden.test.ts`, update the golden only for ENABLED speed/position, review diff.
- [ ] **Step 5:** Full frontend checks green. Commit `fix: show the green-corridor slowdown in the mock`.

### Task 5: Browser verification

- [ ] With the dev server (mock), `playwright-cli open --mobile http://localhost:3000/simulation/green-wave`, start a run at 10×, sample `speed_kmh` from the KPI every 500 ms via `playwright-cli --raw eval` for the whole run; save to `.tmp/playwright/p1/speeds.json`; assert no `0` before arrival.
- [ ] Repeat against the backend transport (`NEXT_PUBLIC_SIMULATION_TRANSPORT=backend`, backend running) on a route with ≥ 3 junctions.
- [ ] Diagnostics: open a recent activity "View JSON"; screenshot `.tmp/playwright/p1/json-dialog.png` shows no Request tab.
- [ ] Report numbers, the architecture-doc edit, and the proposed commits.
