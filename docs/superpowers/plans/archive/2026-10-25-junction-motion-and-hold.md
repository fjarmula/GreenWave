# Junction Motion and ITS Hold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The green-wave vehicle rolls through junctions again, nominal green-wave runs stop dying of `ITS_HOLD_EXPIRED`, and standard-traffic red crossings roll at ≥ 10 km/h instead of crawling at 2.9 km/h.

**Architecture:** Re-apply the three commits the merge `ab4cf02` dropped (backend motion + frontend mock), then make the dispatch hold cover every `D_min` up to the farthest target's last stop line, then replace the flat standard crossing with a floor-respecting, capped, wait-based crossing that reuses the same "extend past the line" idea. A sampling script proves all three on real Kraków data.

**Tech Stack:** Python 3.12 / pytest / pydantic-settings (backend); TypeScript / Vitest (frontend mock).

**Spec:** `docs/superpowers/specs/2026-10-25-post-merge-regressions-design.md` (decisions D1, D2, D3; findings B1, B3, X1, X3).

## Global Constraints

- Simulation only; never add real signal actuation.
- Branch `fix/post-merge-regressions` (already created from `main`). Local commits only; no push, PR, rebase, amend or branch switch without authorization. Stage explicit paths; never `git add -A`.
- Commit subjects `<category>: <message>` (feat|fix|refactor|docs|test|chore|build|ci|perf|style|revert).
- Restored values: `greenwave_approach_distance_m = 60`, `greenwave_min_rolling_speed_kmh = 15`.
- New values: `standard_min_rolling_speed_kmh = 10` (gt 0, finite), `standard_max_red_loss_seconds = 15` (ge 0, finite). Mark both `# PLACEHOLDER 2026-10-25 (human: ...)` like neighbouring settings.
- No ITS hold renewal/retry; expiry remains a failed run (ADR 0008).
- No new dependencies. No hand-edited `contracts/openapi.json` or `api.generated.ts` (this plan changes no schema).
- Backend checks: `cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`. Frontend checks (Node 22+): `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`.
- Tell the human before editing `GreenWave_ARCHITECTURE.md` (already announced for this branch; mention it in the milestone report).

## Review Focus

- A late priority (route starting just before a junction) must still hold the vehicle at the line — the restored `test_safety_hold_still_waits_for_green` must stay green after Task 2 and Task 3.
- Multi-line intersections: the hold must reach the **last** stop line, not the first (Task 2 test `test_hold_reaches_the_last_stop_line_of_a_multi_line_target`).
- Cascade groups: one hold covers the farthest member including all `D_min` before it (Task 2 test `test_hold_covers_every_d_min_up_to_the_farthest_target`).
- Standard crossing on an edge whose ordinary limit is at or below the floor must not slow further or divide by zero (Task 3 test `test_limit_at_or_below_floor_adds_no_extra_time`).
- A second red line inside an active standard crossing replaces it with its own decision (existing `test_a_stop_line_inside_a_crossing_starts_a_fresh_penalty`, updated values) — no accumulated crawl.

---

### Task 1: Re-apply the dropped rolling-junction commits

**Files (via cherry-pick):**
- Modify: `backend/src/greenwave/simulation/motion.py`, `backend/src/greenwave/simulation/state.py`, `backend/src/greenwave/simulation_settings.py`
- Modify: `backend/tests/simulation/test_motion_modes.py`, `test_engine.py`, `test_signal_sync.py`, `golden/engine_events.json`
- Modify: `frontend/src/lib/mock-session.ts`, `mock-simulation-config.ts`, `mock-session.test.ts`, `__snapshots__/mock-stream.json`

**Interfaces:**
- Produces: `greenwave_slowdown(item_line_m, window_start_m, speed_mps, settings) -> float` and `EngineState.slowdown_intersection_id: str | None` (both from `ccb96c0`); settings `greenwave_approach_distance_m`, `greenwave_min_rolling_speed_kmh`.

Verified by a trial run on 2026-10-25: the only conflicts are `test_signal_sync.py`, the backend golden and the mock-stream snapshot; afterwards only the two golden/snapshot tests fail.

- [ ] **Step 1: Cherry-pick `ccb96c0`**

Run: `git cherry-pick -x ccb96c0`
Expected: CONFLICT in `backend/tests/simulation/test_signal_sync.py` and `backend/tests/simulation/golden/engine_events.json`.

- [ ] **Step 2: Resolve**

`test_signal_sync.py`: take the cherry-picked side — delete the HEAD lines
`# Explicit hold expiry can terminate before later route intersections.` and
`assert any(r.status == "EXPIRED" for r in engine.ledger.snapshots())` (they encode finding X1).
Golden: `git checkout HEAD -- backend/tests/simulation/golden/engine_events.json`, then
`cd backend && GREENWAVE_REGEN_GOLDEN=1 uv run pytest tests/simulation/test_engine_golden.py` (expect "skipped: golden regenerated"), then `uv run pytest tests/simulation tests/its -q` → all pass.
Review the golden diff: ENABLED scenarios must lose their 3-tick zero-distance dwells; DISABLED scenarios must be byte-identical.

- [ ] **Step 3: Finish the pick**

`git add backend/tests/simulation/test_signal_sync.py backend/tests/simulation/golden/engine_events.json && git cherry-pick --continue` (keeps the original message `fix: roll through green-corridor junctions instead of stopping`).

- [ ] **Step 4: Cherry-pick `6e138f9`**

Run: `git cherry-pick -x 6e138f9` → CONFLICT in `frontend/src/lib/__snapshots__/mock-stream.json`.
Resolve: `git checkout HEAD -- frontend/src/lib/__snapshots__/mock-stream.json`, then `cd frontend && npx vitest run -u src/lib/mock-simulation-adapter.golden.test.ts`, then `npx vitest run src/lib` → all pass. Stage the snapshot, `git cherry-pick --continue`.

- [ ] **Step 5: Cherry-pick `c272ce7`**

Run: `git cherry-pick -x c272ce7` → expected clean. If the mock snapshot or backend golden changes, regenerate as above and commit as `test: regenerate goldens after restoring D_min before arrival`.

- [ ] **Step 6: Verify**

Run the full backend and frontend checks (Global Constraints). Expected: all green.

---

### Task 2: Hold covers every D_min up to the farthest target's last stop line

**Files:**
- Modify: `backend/src/greenwave/simulation/dispatch.py:13-36` (`build_dispatch_payload`)
- Test: `backend/tests/simulation/test_dispatch.py`, `backend/tests/simulation/test_motion_modes.py`

**Interfaces:**
- Consumes: `time_to_intersection`, `route_runtimes` (`simulation/corridor.py`); `EngineState.v_avg_meters_per_second`.
- Produces: `release_seconds(route_model: RouteModel, state: EngineState, intersection_id: str, settings: SimulationSettings) -> float` in `dispatch.py` (spec D2 `release_i`).

- [ ] **Step 1: Write the failing tests** in `test_dispatch.py` (reuse the module's existing route-model/state builders):

```python
def test_hold_covers_every_d_min_up_to_the_farthest_target() -> None:
    # three unpassed junctions; group = (second, third); v_avg 10 m/s; distance 0
    # third: last line 400 m -> 40 s + 3 junctions x D_min 3 s = 49 s
    assert payload.hold_duration_sec == max(settings.its_min_hold_seconds, 49 + settings.its_hold_buffer_seconds)

def test_hold_reaches_the_last_stop_line_of_a_multi_line_target() -> None:
    # one junction, first line 100 m, last line 160 m, v_avg 10 m/s -> 16 s + 3 s
    assert release_seconds(model, state, "INT-1", settings) == pytest.approx(19.0)

def test_passed_junctions_add_no_d_min() -> None:
    # first junction passed: k for the second junction is 1, not 2
```
Update `test_payload_holds_until_last_member_plus_buffer` to the new formula.
In `test_motion_modes.py` add the engine-level regression:

```python
def test_a_tight_hold_still_outlasts_the_rolling_slowdowns() -> None:
    engine = _engine(GreenWaveMode.ENABLED, stop_lines=(90.0, 150.0), phase=GREEN,
                     settings={"its_min_hold_seconds": 0, "its_hold_buffer_seconds": 0})
    states, _ = _run(engine)
    assert states[-1].arrived
    assert not any(s.status == "EXPIRED" for s in engine.ledger.snapshots())
```

- [ ] **Step 2: Run** `cd backend && uv run pytest tests/simulation/test_dispatch.py tests/simulation/test_motion_modes.py -q` → the new tests FAIL (hold too short / EXPIRED).

- [ ] **Step 3: Implement** `release_seconds` per spec D2 and use `max(release_seconds(...) for id in intersection_ids)` in `hold_duration_sec` (`ceil(...) + its_hold_buffer_seconds`, floored by `its_min_hold_seconds`). `expected_arrival_utc` unchanged. Update the module docstring line.

- [ ] **Step 4: Run** the same tests → PASS; then `GREENWAVE_REGEN_GOLDEN=1` regenerate, review that only `hold_duration_sec` values (and any no-longer-expiring scenario tails) change; then the full backend checks.

- [ ] **Step 5: Commit**

```bash
git add backend/src/greenwave/simulation/dispatch.py backend/tests/simulation/test_dispatch.py backend/tests/simulation/test_motion_modes.py backend/tests/simulation/golden/engine_events.json
git commit -m "fix: hold priority until the vehicle can clear the farthest target"
```

---

### Task 3: Standard red crossing rolls above a floor with a capped, wait-based loss

**Files:**
- Modify: `backend/src/greenwave/simulation/phases.py` (new helper), `backend/src/greenwave/its/models.py:59-65` (protocol), `backend/src/greenwave/its/controller.py:214-223`, `backend/src/greenwave/simulation/motion.py`, `backend/src/greenwave/simulation/engine.py:123-132`, `backend/src/greenwave/simulation_settings.py`
- Modify: `frontend/src/lib/mock-simulation-config.ts`, `frontend/src/lib/mock-session.ts` (`mockTimeline` red branch), snapshot
- Test: `backend/tests/simulation/test_phases.py`, `backend/tests/simulation/test_motion_modes.py`, `frontend/src/lib/mock-session.test.ts`

**Interfaces:**
- Produces:
  - `ordinary_seconds_until_green(route_model: RouteModel, intersection_id: str, at_s: float, settings: SimulationSettings) -> float | None` in `phases.py` — 0.0 when the ordinary route movement is GREEN at `at_s`, `None` without a supported route vehicle signal; analytic from `movement_slots` / `_cycle_colors` (green of slot `g` starts at `g·slot + k·2·slot`).
  - `ItsController.ordinary_route_seconds_until_green(intersection_id: str, at_simulated_sec: float) -> float | None` (implemented in `SimulatedItsController` by delegating to the helper).
  - `standard_crossing(wait_s: float | None, delay_s: float, limit_mps: float, density: float, settings: SimulationSettings) -> tuple[float, float]` in `motion.py` returning `(length_m, extra_s)` per spec D3.
  - `move_one_second(..., route_seconds_until_green: Callable[[str, float], float | None] = lambda _id, _t: None)` — new keyword parameter after `may_leave_stop_line`; the engine passes the controller method.
  - Settings `standard_min_rolling_speed_kmh: float = Field(default=10, gt=0, allow_inf_nan=False)`, `standard_max_red_loss_seconds: float = Field(default=15, ge=0, allow_inf_nan=False)`.

- [ ] **Step 1: Write failing unit tests**

`test_phases.py`:
```python
def test_seconds_until_green_is_zero_while_green_and_counts_down_otherwise() -> None:
    # default programme: slot = 35 s, cycle 70 s; route group slot 0 -> green [0,30)
    assert ordinary_seconds_until_green(model, "INT-1", 10.0, settings) == 0.0
    assert ordinary_seconds_until_green(model, "INT-1", 31.0, settings) == pytest.approx(39.0)
    # route group slot 1 -> green [35,65)
    assert ordinary_seconds_until_green(model_slot1, "INT-1", 0.0, settings) == pytest.approx(35.0)

def test_seconds_until_green_is_none_without_route_signal() -> None: ...
```
`test_motion_modes.py`:
```python
_FLOOR_STD_MPS = 10 / 3.6

def test_standard_crossing_extends_to_respect_the_floor() -> None:
    length, extra = standard_crossing(100.0, 20.0, 10.0, 1.5, SimulationSettings())
    assert extra == 15.0                                   # min(1.0*100*1.5, 15)
    assert length == pytest.approx(15.0 / (1 / _FLOOR_STD_MPS - 1 / 10.0))
    assert cautious_speed_mps(10.0, length, extra) == pytest.approx(_FLOOR_STD_MPS)

def test_short_wait_scales_the_loss_below_the_cap() -> None:
    length, extra = standard_crossing(4.0, 20.0, 10.0, 1.5, SimulationSettings())
    assert extra == pytest.approx(6.0) and length == 30.0  # L_c dominates

def test_unknown_movement_uses_the_intersection_delay() -> None:
    _, extra = standard_crossing(None, 4.0, 10.0, 1.0, SimulationSettings())
    assert extra == pytest.approx(4.0)

def test_limit_at_or_below_floor_adds_no_extra_time() -> None:
    assert standard_crossing(100.0, 20.0, _FLOOR_STD_MPS, 1.0, SimulationSettings()) == (30.0, 0.0)

@pytest.mark.parametrize("phase", [None, YELLOW, RED])
def test_disabled_crossing_never_drops_below_the_floor(phase) -> None:
    states, _ = _run(_engine(GreenWaveMode.DISABLED, phase=phase))
    moved = [b.distance_travelled_m - a.distance_travelled_m for a, b in pairwise(states)]
    assert min(m for m, s in zip(moved, states[1:]) if not s.arrived) >= _FLOOR_STD_MPS - 1e-9
```
Update the module constants used by the existing disabled tests to the new model: with the fixture's programmes every red/yellow/unknown case hits the cap, so `_CAUTIOUS_S = 15.0` and the crossing length becomes `_STD_L = 15.0 / (1 / _FLOOR_STD_MPS - 1 / _LIMIT_MPS)`; replace `_CROSSING_M` with `_STD_L` wherever it denotes the rolled distance (keep `crossing_m=` as the configured `L_c` input). Add settings-validation cases for the two new fields to the existing parametrized invalid-values test.

`mock-session.test.ts`: `it("never drops below the standard floor in a disabled mock run")` asserting every non-arrival leg speed ≥ `MOCK_STANDARD_MIN_ROLLING_SPEED_MPS - 1e-9`.

- [ ] **Step 2: Run** `uv run pytest tests/simulation/test_phases.py tests/simulation/test_motion_modes.py -q` and `npx vitest run src/lib/mock-session.test.ts` → new tests FAIL (missing names / crawl below floor).

- [ ] **Step 3: Implement** in this order: settings → `ordinary_seconds_until_green` → controller method + protocol → `standard_crossing` → `move_one_second` (in the red branch: per facing item take `route_seconds_until_green(item.id, at_s)`, use the largest wait (None counts as that item's `delay_seconds`) and the max `delay_seconds`, call `standard_crossing` with the edge's ordinary limit `min(track.speed_mps(edge), track.speed_limit_mps(edge))`; set `crossing, cautious = length, extra`) → engine passes `self.controller.ordinary_route_seconds_until_green`. Update the `move_one_second` docstring paragraph for disabled mode. Mock: add `MOCK_STANDARD_MIN_ROLLING_SPEED_MPS = 10 / 3.6`, `MOCK_STANDARD_MAX_RED_LOSS_SECONDS = 15`; in the red branch `cautious = Math.min(MOCK_STANDARD_CLEARANCE_SECONDS * density, MOCK_STANDARD_MAX_RED_LOSS_SECONDS)` and `crossing = Math.max(MOCK_STANDARD_CROSSING_DISTANCE_M, cautious / (1 / floor - 1 / limit))` with `limit = Math.min(ambulanceMps, MOCK_ORDINARY_SPEED_LIMIT_MPS)` and `cautious = 0` when `limit <= floor`.

- [ ] **Step 4: Run** the tests → PASS. Regenerate the backend golden (DISABLED scenarios change, ENABLED must not) and the mock-stream snapshot; review both diffs. Full backend + frontend checks.

- [ ] **Step 5: Commit**

```bash
git add backend/src/greenwave/simulation/phases.py backend/src/greenwave/its/models.py backend/src/greenwave/its/controller.py backend/src/greenwave/simulation/motion.py backend/src/greenwave/simulation/engine.py backend/src/greenwave/simulation_settings.py backend/tests/simulation/test_phases.py backend/tests/simulation/test_motion_modes.py backend/tests/simulation/golden/engine_events.json frontend/src/lib/mock-simulation-config.ts frontend/src/lib/mock-session.ts frontend/src/lib/mock-session.test.ts frontend/src/lib/__snapshots__/mock-stream.json
git commit -m "feat: roll standard-traffic red crossings above a speed floor"
```

---

### Task 4: Real-data sampling script, docs and acceptance

**Files:**
- Create: `backend/scripts/sample_runs.py`
- Create: `docs/adr/0010-rolling-junctions-and-hold-coverage.md` (from `docs/adr/0001-template.md`; Status: Proposed)
- Modify: `GreenWave_ARCHITECTURE.md` §3 model 2 (line ~137: dwell → rolling slowdown + safety hold), model 3 (lines ~141-148: D3 crossing), ITS hold paragraph (~line 619); `backend/README.md` settings list if it enumerates settings
- Create: `docs/engineering/post-merge-regressions-verification.md` (same style as `post-merge-compatibility-verification.md`)

**Interfaces:**
- Produces: `uv run python scripts/sample_runs.py --routes N --seed S [--cascade] [--density D]` printing one row per (route, mode): `est_normal est_greenwave arrived_at terminal min_kmh zero_ticks_outside_hold intersections`, then a summary per mode: terminal-reason counts, overall min pre-arrival km/h (arrival tick excluded; ENABLED ticks with `dwelling_intersection_id` set are counted separately as safety holds), max `|arrived_at − estimated_greenwave|` for completed ENABLED runs. Picks the incident from `ds.addresses.sample(n=N, seed=S)` and the origin from `rank_stations(...).candidates[0]`; builds runs with `plan_simulation` and steps `engine.step` exactly like the session. Plan 2 extends it.

- [ ] **Step 1: Write the script**; keep it in `scripts/` style (module docstring, `argparse`, `main()`), ruff/mypy clean.

- [ ] **Step 2: Acceptance run**

Run: `cd backend && uv run python scripts/sample_runs.py --routes 40 --seed 11` and again with `--cascade`.
Expected, both: ENABLED terminal counts `completed: 40` (no `ITS_HOLD_EXPIRED`); ENABLED min pre-arrival speed ≥ 15 km/h outside safety holds; DISABLED min ≥ 10 km/h (any exception must be an edge whose ordinary limit is ≤ 10 km/h — report it); ENABLED `|arrived_at − estimate| < 1 s`. Paste the summary into the verification doc. (Baseline before this plan: 24/40 and 22/40 `ITS_HOLD_EXPIRED`, 0.0 km/h, 2.9 km/h.)

- [ ] **Step 3: Docs** — ADR 0010 records D1–D3 and that it amends ADR 0008's hold calculation (no renewal added). Architecture text matches the code; remove "dwells D_min".

- [ ] **Step 4: Browser check** with the `playwright-cli` skill (artifacts only under `.tmp/playwright/`): start backend + frontend, run `/simulation/green-wave` and `/simulation/standard` on one address; confirm the speed readout never shows 0 km/h at junctions in green wave and stays ≥ 10 km/h at red lights in standard. Record in the verification doc.

- [ ] **Step 5: Full checks, then commit**

```bash
git add backend/scripts/sample_runs.py docs/adr/0010-rolling-junctions-and-hold-coverage.md GreenWave_ARCHITECTURE.md docs/engineering/post-merge-regressions-verification.md
git commit -m "docs: record rolling junctions, hold coverage and sampled acceptance"
```
