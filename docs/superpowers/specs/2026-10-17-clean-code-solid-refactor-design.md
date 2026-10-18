# Clean-code / SOLID refactor: design

Date: 2026-10-17 · Status: approved 2026-10-17; implemented 2026-10-18 (M1 b7f9fe1, M2 30dde35, golden fix eed9534, M3 71f7637, M4 c886de5, ETL harness 972ac78, M5 587ad64, M4b 854f082, M6 bfca50b)

## Intent

The repo grew fast through Phase 2 (ETL, simulation engine, frontend integration, Compose). Several
modules now carry many responsibilities each. The human asked for a repo-wide refactor following
clean-code rules, SOLID and especially the single-responsibility principle, "optimizing every
possible aspect". Goal: code that is easier to read, test and change, with no change in what the
system does.

## Interpretation (builder's call, flagged to the human)

- "Optimize" = (a) structure/readability per SRP and SOLID, and (b) safe algorithmic wins that do
  not change outputs (e.g. linear scans in the 1 Hz loop → bisect / precomputed indexes).
  Performance claims require before/after numbers from `backend/scripts/benchmark.py` or a focused
  micro-benchmark, per `docs/engineering/contributor-workflow.md`.
- The human's explicit request overrides the workflow doc's "no broad refactors" default, but the
  doc's other rules still apply: no new dependencies, no new layers without a concrete
  responsibility, no formatting churn, no new config knobs.

## Goals

1. Each module/class/function has one reason to change.
2. Side effects separated from pure computation (notably ITS dispatch out of the "pure" engine).
3. No duplicated logic within a module (e.g. engine's own-vs-cascade intersection advance).
4. Long functions and long positional parameter lists broken up (target: functions ≲ 50 lines,
   ≤ ~5 params; use a small dataclass where data travels together).
5. Frontend components one-per-concern; hooks/pure helpers extracted from JSX-heavy files.
6. Measured, output-preserving performance improvements in hot paths.

## Non-goals

- No behaviour, timing, or numeric change in simulation output, REST/SSE payloads, or ETL artifacts.
- No Pydantic schema changes → `contracts/openapi.json` and `api.generated.ts` must not change.
- No new dependencies, frameworks, DI containers, or abstract base classes "for the future".
- No edits to vendored `.agent/skills/` code, generated files, `AGENTS.md`, or
  `GreenWave_ARCHITECTURE.md` (the latter two only after telling the human).
- No UI visual change (class names, markup semantics, a11y roles stay equal).

## Anti-goals (failure even if it "works")

- Abstraction for its own sake: interfaces with one implementation and no test seam, managers of
  managers, wrapper files that only re-export.
- Tests weakened, deleted, or rewritten to fit the new code instead of the code fitting the tests.
- A big-bang diff: every milestone must be independently green and reviewable.
- Any added path toward real signal actuation.

## Constraints

- All checks green after every milestone (AGENTS.md "Checks"). Baseline 2026-10-17: backend 367
  tests pass, ruff/format/mypy clean; frontend 137 tests pass, lint/typecheck/format clean.
- Existing tests are the behaviour spec. Moving a test to follow a moved module is allowed; changing
  an assertion is not, without the human's approval.
- **ETL equivalence gate:** before ETL milestones, run the full ETL from `backend/data/raw` into a
  scratch processed dir to capture baseline `artifact_sha256`; after each ETL milestone rerun and
  require identical artifact hashes and identical `etl_report.json` modulo `generated_at_utc`. Never
  write into `backend/data/processed` or `backend/data/raw`.
  *Builder's call:* hash **every** file in the scratch processed dir (the report records hashes for
  only some outputs). Run the baseline twice first; any file that differs between two identical
  runs (e.g. HTML maps or a report with timestamps) is compared by parsed content with the volatile
  fields masked, and listed in the milestone summary. Redirect output the way
  `benchmark.py`'s `worker_etl` already does; no new CLI flag.
- **Simulation equivalence gate:** a characterization test (added first, kept) that runs a fixed
  scenario on the tiny test dataset and snapshots the full event stream (ticks, dispatches,
  completion) must be unchanged by engine/session milestones.
- Public import paths used by other packages/tests stay valid (re-export from the old module only if
  a caller outside the package needs it; otherwise update the callers).
- Git (human decision 2026-10-17): work on branch `refactor/clean-code`; commit once per milestone
  with a Conventional Commit message, after that milestone's checks are green. No push or PR
  without further authorization.
- Run `graphify update .` after structural milestones.

## Scope, in order (one milestone each)

### M1 Simulation engine (`backend/src/greenwave/simulation/engine.py`)
Problems: one class moves the vehicle, advances signal states (own + cascade, duplicated), performs
the ITS side effect while documented as pure, projects telemetry, and computes KPIs. `_edge_at` and
`_next_stop` are linear scans per call inside the per-second loop.
Direction: split into focused collaborators within `simulation/`, e.g. motion (D13 move), corridor
(intersection advance incl. cascade, one shared helper), dispatch (payload building; the gateway
call made by the orchestrator, not the computation), telemetry/KPI projection. `SimulationEngine`
remains the façade with the same public API (`initial_state`, `step`, `run_tick`). Named fields in
`EngineState(...)` construction. Replace linear lookups with `bisect` / a precomputed index.
*Builder's call:* the `SimulationEngine` façade stays the orchestrator and keeps its constructor
signature; it asks a pure dispatch planner for the payload, then calls `gateway.dispatch()` itself,
inline per step as today. So dispatch timing within `run_tick` is unchanged and no test setup edits
are needed. (Moving the side effect to `SessionManager` was rejected: it would change dispatch
timing under playback speed > 1.)

### M2 Session manager (`simulation/session.py`)
Problems: `start()` mixes route planning + engine assembly with lifecycle/supersede rules;
subscriber queue drop policy lives in the manager.
Direction: extract engine assembly (plan → route model → estimates → engine) into a factory
function; extract the bounded "drop oldest non-terminal" queue policy into its own small unit with
its own tests (existing `_put` test migrates). Locking, supersede and cancel semantics unchanged.

### M3 Intersection building (`etl/intersections.py`, `etl/intersections_pipeline.py`)
Problems: 890-line module; `build_intersections` partitions approaches, groups rings, merges
junctions, merges crossings, orders, numbers and names; `_grouping_report` takes 15 positional
args; `run_intersections` does compute and writes artifacts and builds the report.
Direction: split into cohesive modules (assignment, grouping/merge, naming, reports, frames); pass
intermediate results as a dataclass instead of 15 args; separate "compute" from "write artifacts"
in the pipeline runner. Gate: ETL equivalence.

### M4 Remaining ETL modules
`etl/signals.py`, `etl/neighbours.py`, `etl/network.py`, `etl/cluster_map.py`, `etl/weld.py`,
`etl/junctions.py`, `dataset/helpers.py` (validation vs. IO split): same treatment where a function
or module carries several responsibilities. Builder triages; skip modules that are already
cohesive. Gate: ETL equivalence.

### M5 Frontend
- `lib/mock-simulation-adapter.ts`: split `advanceMockSession` (signal stepping, tick event,
  dispatch event) into pure functions; keep adapter object as orchestration only.
- `components/dashboard.tsx`, `components/hud/DispatchForm.tsx`: one component per file where a
  file hosts several; extract the start-request builder and estimate formatting into pure helpers
  with unit tests; extract form sections (traffic, cascade toggle, playback speed, estimate card).
- Others (`MapContainer.tsx`, `transport/backend-simulation-adapter.ts`, `transport/validate.ts`,
  `simulation-state.ts`) triaged the same way. Respect `frontend/AGENTS.md` and
  `docs/engineering/frontend-dashboard.md`.
Gate: frontend checks + Playwright smoke of setup → live in mock mode (via `playwright-cli`,
output under `.tmp/playwright/`).

### M6 Scripts and tooling
`backend/scripts/benchmark.py` (740 lines): separate measurement sections into modules or at least
cohesive functions; keep CLI and JSON output identical. Shell scripts in `scripts/` only if a clear
SRP issue exists.

## Left to the builder

- Exact module/file names and boundaries inside each milestone.
- Whether a split yields new files or stays in one file as smaller functions — choose by cohesion,
  not line count alone.
- Which candidate in M4/M5/M6 is not worth touching (state why in the milestone summary).
- Whether a performance change earns its complexity; drop it if the benchmark gain is negligible.
