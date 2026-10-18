# Refactor close-out: M5 frontend, M4b ETL analysis modules, M6 benchmark script

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (human chose native/inline execution for this refactor) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the clean-code/SOLID refactor: split the multi-concern frontend files, the long ETL analysis functions and the 740-line benchmark script into single-responsibility units with no visible, numeric or artifact change.

**Architecture:** Same method as the finished rounds: characterise first (golden/snapshot), then move code into focused units behind unchanged public entry points, then prove equivalence. Frontend: pure helpers get unit tests, components get markup snapshots via `react-dom/server` (already installed). ETL analysis: the committed `backend/scripts/etl_equivalence.py` gate. Benchmark: same CLI and JSON key structure.

**Tech Stack:** Next.js 16 / React 19 / TypeScript strict / vitest 5 (node env) / Tailwind; Python 3.12 / polars / networkx / shapely / pytest / ruff / mypy strict (mypy covers `greenwave` only, not `scripts/`).

**Spec:** `docs/superpowers/specs/2026-10-17-clean-code-solid-refactor-design.md` (M5, M4b = the "later plan" of `docs/superpowers/plans/2026-10-17-refactor-etl.md`, M6).

**Done so far (branch `refactor/clean-code`, not pushed):** M1 engine `b7f9fe1`, M2 session `30dde35`, golden fix `eed9534`, M3 intersections `71f7637`, M4 ETL builders `c886de5`, close-out tooling + this plan (next commit).

## Global Constraints

- No behaviour, timing, or numeric change; no UI visual change (class names, markup semantics, a11y roles stay equal); no Pydantic schema change, `contracts/openapi.json` and `frontend/src/types/api.generated.ts` unchanged.
- No new dependencies or lockfile changes (frontend-dashboard.md: needs explicit approval). No new config knobs, frameworks, DI containers, abstract classes "for the future", re-export-only wrapper files.
- Existing tests are the behaviour spec: no assertion changes without the human's approval; import/setup-only edits are allowed and listed in the milestone summary.
- Frontend: read `frontend/AGENTS.md` (Next.js 16 differs from training data: check `frontend/node_modules/next/dist/docs/` before touching Next APIs) and `docs/engineering/frontend-dashboard.md`; keep HUD separate from `src/components/map/`; keep transport-agnostic components; all UI text English; synthetic values stay labelled simulated/mock.
- Browser checks only via `playwright-cli` skill through bash; output only under `.tmp/playwright/`; never dump DOM/a11y trees.
- Never write into `backend/data/`, except `benchmark.py`'s own designed output `backend/data/processed/benchmarks/` (gitignored).
- Performance claims need before/after numbers; drop a change whose gain is negligible (ledger a ruling).
- One commit per milestone after its checks are green; message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `graphify update .` after each milestone. No push/PR without explicit authorisation.
- Checks — backend (from `backend/`, prefix `VIRTUAL_ENV=`): `uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`. Frontend (from `frontend/`): `npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`.

## Review Focus

- Mock stream timing: tick numbering, `elapsedSeconds` per playback step, dispatch emitted before the tick, completion after it, `expected_arrival_utc` from `Date.now()`. → mock stream golden (Task 1).
- Transport-dependent copy (mock vs backend) in DispatchForm and VehicleTelemetry. → markup snapshots in both transports (Task 2).
- Start request built from the selected endpoints (lng/lat order, `crypto.randomUUID()`). → `test_build_start_request_uses_lng_lat_of_endpoints` (Task 4).
- ETL analysis HTML maps (`roundabout_override_check.html`, `signal_cluster_map.html`) must stay byte-identical. → ETL gate (Task 10).
- Benchmark worker subprocess re-invokes the script by path: moved helpers must stay importable when run as `python scripts/benchmark.py --worker ...`. → quick run with `etl` section (Task 13).

---

## Milestone M5: Frontend

### Task 1: Mock stream golden

**Files:** Create `frontend/src/lib/mock-simulation-adapter.golden.test.ts`, `frontend/src/lib/__snapshots__/mock-stream.json` (written by `toMatchFileSnapshot`).

- [ ] **Step 1:** Test `mock stream matches the recorded event sequence`: `vi.useFakeTimers()`, `vi.setSystemTime(new Date("2026-10-17T00:00:00Z"))`; for scenarios `{cascade: true, playback: 1}`, `{cascade: false, playback: 1}`, `{cascade: true, playback: 5}`: `start()` with a fixed request (ids `SIM-golden-<n>`, origin/destination = first ORIGIN/DESTINATION endpoint coordinates, density 1.5), `subscribe` a recorder of every callback (`onTick`, `onItsDispatch`, `onTerminal`, `onConnectionChange`, `onError`) in call order, `vi.advanceTimersByTime(MOCK_STREAM_INTERVAL_MILLISECONDS)` until terminal (cap 10_000 → fail). `await expect(JSON.stringify(records, null, 1)).toMatchFileSnapshot("./__snapshots__/mock-stream.json")`.
- [ ] **Step 2:** `npx vitest run src/lib/mock-simulation-adapter.golden.test.ts -u` on the unmodified adapter, then without `-u` → PASS. Check the snapshot contains an `ITS_DISPATCH` and a `SIMULATION_COMPLETED` per scenario.

### Task 2: Markup snapshots of the setup UI

**Files:** Create `frontend/src/components/hud/DispatchForm.snapshot.test.tsx`, `frontend/src/components/dashboard-parts.snapshot.test.tsx`.

- [ ] **Step 1:** `renderToStaticMarkup` (`react-dom/server`) of `<DispatchForm …/>` with fixed props, once per transport (stub `getFrontendConfig` with `vi.mock("@/lib/config")` returning `transport: "mock"` / `"backend"`) → `toMatchFileSnapshot`. For the dashboard: snapshot `DashboardHeader` and `VehicleTelemetry` markup only if they render without MapLibre (they need the simulation context: wrap them in the provider from `src/components/simulation-provider.tsx`). `RoutePreview`/`MapContainer` are excluded (MapLibre needs a browser) and covered by Task 7's browser check.
- [ ] **Step 2:** Generate with `-u` on unmodified code, rerun → PASS. If vitest cannot transform TSX in the node environment, ledger a ruling; the browser baseline of Step 3 then becomes the only UI gate.
- [ ] **Step 3: Browser baseline (before any M5 change):** playwright-cli skill, mock transport, `npm run dev`, viewport 1440×900: screenshot the setup view, click "Initialize green corridor", screenshot the live view after ~5 s. Save under `.tmp/playwright/pre-m5/`.

### Task 3: Mock adapter — pure session functions

**Files:** Create `frontend/src/lib/mock-session.ts`, `frontend/src/lib/mock-session.test.ts`; Modify `frontend/src/lib/mock-simulation-adapter.ts`.

**Interfaces (mock-session.ts):**
- `export type MockSession` (moved), `createMockSession(request: SimulationStartRequest): MockSession` (route from today's `createMockRoute` + initial signals).
- `stepMockSignals(session: MockSession, enteredClearing: Set<number>): void` (today's `stepSignals`, unchanged semantics incl. D16 one-hop cascade).
- `buildMockTick(session: MockSession, timestamp: string): SimulationTickEvent`; `buildMockDispatch(session: MockSession, enteredClearing: Set<number>, timestamp: string, nowMs: number): ItsDispatchEvent | null` (increments `dispatchCount` only when it returns an event).
- `advanceMockSession(session: MockSession): { tick; dispatch; completed }` composes them in today's order (signals → tick → dispatch → completion).
- Adapter keeps `createMockSimulationAdapter` (timer, subscribers, start/subscribe/stop) plus `cancelledEvent(session, reason)` / `completedEvent(tick)` builders.
- **Test (RED first):** `stepMockSignals enters cascade targets within 250 m only when cascade is enabled` — session with the sample intersections, elapsed seconds set so the first signal's TTI ≤ `MOCK_CLEARING_TTI_SECONDS`; with `enable_cascade_mode` true the next signal within 250 m is `CLEARING` + `isCascade`, with false it stays `NORMAL`.
- [ ] Steps: RED → implement → `npm test` (golden Task 1 PASS) → lint/typecheck.

### Task 4: Start request and duration formatting helpers

**Files:** Create `frontend/src/lib/start-request.ts` + test, `frontend/src/lib/format-duration.ts` + test; Modify `dashboard.tsx`, `DispatchForm.tsx`.

**Interfaces:** `buildStartRequest(origin: OriginEndpoint, destination: DestinationEndpoint, settings: DispatchSettings, simulationId: string): SimulationStartRequest` (endpoint types from `@/components/map/dispatch-endpoints`; `DispatchSettings` stays exported from DispatchForm or moves to `start-request.ts` — move it, it is request data); `formatMinutesSeconds(seconds: number): string` (today's `formatEstimate`: `"MMm SSs"`, zero-padded).
- **Tests (RED first):** `test_build_start_request_uses_lng_lat_of_endpoints` (coordinates `[lng, lat]` → `{lng, lat}`; all three settings copied; id passed through). `formatMinutesSeconds`: `0 → "00m 00s"`, `65 → "01m 05s"`, `600 → "10m 00s"`.

### Task 5: DispatchForm sections

**Files:** Create under `frontend/src/components/hud/dispatch/`: `NodeSelect.tsx`, `TrafficDensityControl.tsx`, `CascadeToggle.tsx`, `PlaybackSpeedSelector.tsx`, `PreflightEstimate.tsx` (includes today's `Estimate`); Modify `DispatchForm.tsx` (state + composition only; `PLAYBACK_SPEEDS`/`PlaybackSpeed` move to `PlaybackSpeedSelector.tsx` and are re-imported).
- Markup moved verbatim (same classes, ids, roles, aria attributes, text). Gate: Task 2 snapshot unchanged; full frontend checks.

### Task 6: Dashboard parts

**Files:** Create under `frontend/src/components/dashboard/`: `DashboardHeader.tsx` (with `ModeButton`, `PHASE_LABELS`), `RoutePreview.tsx`, `VehicleTelemetry.tsx`; Modify `frontend/src/components/dashboard.tsx` (keeps `Dashboard` + mode/endpoint state, uses `buildStartRequest`). Check every importer of `@/components/dashboard` still resolves (`grep -rn "components/dashboard" src`).
- Gate: Task 2 snapshots unchanged; full frontend checks.

### Task 7: Triage the remaining frontend files; browser check; M5 commit

- [ ] Triage `MapContainer.tsx`, `transport/backend-simulation-adapter.ts`, `transport/validate.ts`, `simulation-state.ts`, `simulation-controller.ts`: split only a function > ~50 lines or a file with two reasons to change; otherwise ledger "cohesive, untouched" with the reason. Existing tests (backend adapter 460 lines, controller 398, state 379, validate 140) are the gate.
- [ ] Browser check: repeat Task 2 Step 3 into `.tmp/playwright/post-m5/` and compare with `pre-m5/` by viewing both (map tiles and live values may differ; layout, text, controls and colours must not).
- [ ] Full frontend checks green; `git diff --stat -- ../contracts src/types/api.generated.ts` empty; commit `refactor(frontend): split mock session, dispatch form and dashboard into focused units`.

---

## Milestone M4b: ETL analysis modules

### Task 8: Baseline with the committed harness

- [ ] From `backend/`: `uv run python scripts/etl_equivalence.py run <scratch>/base1 <scratch>/base1.json` and the same for `base2` on the M5 commit (backend unchanged since `c886de5`). `compare base1.json base2.json` → expected only `etl_report.json` differs; that list is the `--allow` list. (`<scratch>` = the session scratchpad; never inside the repo — the script refuses.) Record per-step seconds.

### Task 9: Split the long analysis functions

Targets (lines today): `street_comparison.compare_streets` 107, `profile_signals.analyse_signals` 103 and `_probe` (7 params), `cluster_map._panel_svg` 90 (8 params) and `render_cluster_map` 66, `roundabouts.analyse_roundabouts` 87, `overrides.draft_override_entries` 77, `profile._claims` 74 (6 params), `override_map._panel` 57, `profile_krakow.profile_krakow` 56, `profile_osm.scan_osm` 52, `profile_roads.analyse_roads` 46.
- Method per function: named phase functions in the same module, called in the original order; parameter bundles as frozen dataclasses where ≥ 6 values travel together; keep float accumulation order, dict insertion order and every emitted string/attribute order (the HTML maps are hashed). Exact helper names are the builder's call (spec "Left to the builder").
- One function at a time: edit → `uv run pytest tests/etl -q` green. A function whose module test does not exercise it gets one public-behaviour test first (RED → GREEN) or a ledgered ruling naming the ETL gate as its only guard.
- Skip a function that is already one cohesive step (ledger the reason).

### Task 10: M4b gate and commit

- [ ] Full backend checks; `etl_equivalence.py run` → `m4b.json`; `compare base1.json m4b.json --allow etl_report.json` → exit 0.
- [ ] `graphify update .`; commit `refactor(etl): split long analysis and profiling functions into named phases`.

---

## Milestone M6: Benchmark script

### Task 11: Benchmark baseline

- [ ] From `backend/`: `uv run python scripts/benchmark.py --scratch <scratch>/bench-base --quick --only load,serve,routing,etl --etl-steps neighbours` → note the written `data/processed/benchmarks/benchmark_*_quick.json`. Write a scratch `json_shape.py` that maps a JSON document to its recursive key/type structure (lists → shape of first element); save the baseline shape.

### Task 12: Split benchmark.py into cohesive modules

**Files:** Create `backend/scripts/bench/__init__.py` (empty), `bench/machine.py` (`now_iso`, `read_text`, `proc_status`, `machine_state`, `environment`, `hash_tree`), `bench/stats.py` (`stats_ms`, `spread`), `bench/workers.py` (`worker_etl`, `worker_load`, `run_worker`), `bench/sections.py` (`section_load`, `section_serve`, `section_routing`, `section_etl`, `free_port`, `best_edge`), `bench/results.py` (`save`, `timed_section`, `LIMITATIONS`). `scripts/benchmark.py` keeps the docstring, constants, argparse `main()`.
- `section_routing` (~190 lines): split into pair sampling, the two timed search variants, and the per-intersection lookup, called in the same order with the same seed and RNG calls (RNG call order decides the sampled pairs).
- Imports: `scripts/` is `sys.path[0]` when run as a script, so `from bench.machine import …` works for both the main process and `--worker` subprocesses (they run `SCRIPT` by path). Shared constants (`SEED`, `STRATA_KM`, …) move to `bench/constants.py` and `benchmark.py` imports them back for `main()`.
- [ ] `uv run ruff check . && uv run ruff format --check .` (mypy does not cover scripts).

### Task 13: M6 gate and commit

- [ ] Rerun Task 11's command → shape equal to the baseline shape (values differ: timings); `data_processed_unchanged.unchanged` is true in both.
- [ ] `graphify update .`; commit `refactor(scripts): split benchmark into measurement modules`.

---

## Final

### Task 14: Whole-branch review and close-out

- [ ] `review-package <this plan> c886de5 HEAD` (earlier commits were reviewed in their own rounds); dispatch a fresh reviewer on the most capable model with `requesting-code-review/code-reviewer.md`, this plan, the spec, this Review Focus and the ledger rulings.
- [ ] Fix Critical/Important in one pass, each RED→GREEN; ledger minors.
- [ ] Update the spec's Status line to `implemented 2026-10-…` with the commit list (docs only).
- [ ] Load `finishing-a-development-branch` and present the human the merge/PR options. Do not push or open a PR without explicit authorisation.
