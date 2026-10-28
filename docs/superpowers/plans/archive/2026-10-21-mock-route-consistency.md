# Mock Route Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every offline mock route's geometry, distance, estimates, tick speed, and displayed junction identities describe the same explicitly synthetic trip.

**Architecture:** Keep the existing frontend-only adapter and straight-line demo, but derive route metrics from selected endpoints with one pure estimator. Project two synthetic junctions at fixed fractions of the measured line and drive both mode timelines from the resulting distance. Keep backend routing, contracts, and signal state logic unchanged.

**Tech Stack:** TypeScript, React, Vitest, MapLibre, `playwright-cli`.

**Spec:** `docs/superpowers/specs/2026-10-21-mock-route-consistency-design.md`.

## Root cause

`createMockRoute()` draws the selected origin/destination but returns `MOCK_ROUTE_DISTANCE_METERS` and fixed travel times for every request. It moves the named `INT-0360`/`INT-0366` junctions to fractions of any selected line. `buildMockTick()` uses a sinusoidal speed on open-road legs, independent of position change. `PreflightEstimate` also shows the fixed numbers before endpoints are known. A coincident incident and nearest station currently rank as a zero-distance trip, which needs an explicit decision before distance-derived motion is introduced.

## Global Constraints

- Simulation only. Preserve the 1 Hz tick and existing enabled/disabled signal and cascade semantics.
- Backend Pydantic schemas and generated frontend contracts remain untouched; no new dependency or lockfile change.
- Mock station ranking remains straight-line and visibly labelled `Approximate (mock)`; mock lines are not drivable routes.
- Preserve deterministic output for fixed request and clock. Keep route IDs, names, and labels visibly synthetic.
- Read `frontend/AGENTS.md` and the relevant local Next.js guide before editing Next components. Apply TDD; update the master record only after all checks pass.
- After each task, report changed files, checks and results, decisions or blockers, and a proposed Conventional Commit subject; continue to the next task unless blocked.

## File map

- `frontend/src/lib/mock-simulation-config.ts`: reference rates and synthetic junction fractions/identities.
- `frontend/src/lib/mock-route-metrics.ts` (new): pure haversine distance and endpoint-to-estimate computation. Move `haversineMeters` here; `mock-dispatch.ts` may re-export it to preserve its current tested interface.
- `frontend/src/lib/mock-session.ts`: construct endpoint-specific route and ticks from those metrics.
- `frontend/src/lib/mock-dispatch.ts`: exclude an exactly coincident station, populate `station_at_incident`, and choose the next distinct candidate or return `NO_STATION_REACHABLE`.
- `frontend/src/components/hud/dispatch/PreflightEstimate.tsx` and `frontend/src/components/hud/DispatchForm.tsx`: show no fixed estimate without two endpoints; with endpoints show values from the same estimator as the run.
- Matching `*.test.ts(x)` and `frontend/src/lib/__snapshots__/mock-stream.json`: regression and recorded stream.

## Review Focus

- A map click near a station produces a short trip rather than the same 5.4 km trip; tested in Task 1.
- A station exactly at the incident never produces zero-distance motion or `NaN`; tested in Task 2.
- Enabled and disabled runs use identical open-road motion for the same endpoints; tested in Task 3.
- Two junctions remain ordered and their cascade targets reflect actual scaled separation; tested in Task 3.
- Changing incident, station type, or density updates preflight estimates without showing stale values; tested in Task 4.

---

### Task 1: Establish endpoint-specific mock metrics

**Files:**
- Create: `frontend/src/lib/mock-route-metrics.ts`, `frontend/src/lib/mock-route-metrics.test.ts`
- Modify: `frontend/src/lib/mock-simulation-config.ts`, `frontend/src/lib/mock-dispatch.ts`

**Interfaces:**
- Produce: `haversineMeters(a: Position, b: Position): number` and `estimateMockRoute(origin: Position, destination: Position, trafficDensityMultiplier: number): MockRouteMetrics`, where `MockRouteMetrics` contains finite `distanceMeters`, `normalSeconds`, and `greenwaveSeconds`.
- Preserve the current 5,400 m / 780 s / 380 s scenario as the reference rates at density 1.5; scale travel seconds by measured distance. The two sample junction offsets are fractions `1480 / 5400` and `1632 / 5400` of each positive route distance.

- [ ] **Step 1: Write failing estimator tests.** Assert two endpoint pairs with different haversine separation yield different distances and times, the 5,400 m reference yields the reference times at density 1.5, density changes normal time only, and all outputs are finite and nonnegative for valid distinct endpoints.
- [ ] **Step 2: Verify the red test.** Run `cd frontend && npm test -- lib/mock-route-metrics.test.ts`; expect failure because the estimator is absent.
- [ ] **Step 3: Implement the pure distance and estimator functions and rename fixed values as reference values.** Move the existing haversine calculation without changing its result, re-export it from `mock-dispatch.ts` for its current tests, and keep the reference rates in one place without a second formula in the UI.
- [ ] **Step 4: Verify green and preserve mock dispatch distance.** Run `cd frontend && npm test -- lib/mock-route-metrics.test.ts lib/mock-dispatch.test.ts`; expect pass.

### Task 2: Resolve coincident mock dispatch explicitly

**Files:**
- Modify: `frontend/src/lib/mock-dispatch.ts`, `frontend/src/lib/mock-dispatch.test.ts`, `frontend/src/lib/mock-session.ts`, `frontend/src/lib/mock-session.test.ts`

**Interfaces:**
- `rank()` returns the nearest **distinct** station of the requested type; if an exact station match exists, set `station_at_incident` to it. If no distinct station exists, return `NO_STATION_REACHABLE`.
- `createMockSession()` rejects a direct zero-distance request with the existing `NO_ROUTE` adapter error rather than building an undefined timeline.

- [ ] **Step 1: Write failing boundary tests.** Inject a station at the incident and another farther away; assert the second wins and the first is reported in `station_at_incident`. Assert the one-station case reports `NO_STATION_REACHABLE`. Assert direct same-coordinate mock start rejects rather than emitting `NaN` or running forever.
- [ ] **Step 2: Verify red.** Run `cd frontend && npm test -- lib/mock-dispatch.test.ts lib/mock-session.test.ts`; expect the new boundary assertions to fail.
- [ ] **Step 3: Implement the ranking and session guard.** Use exact zero haversine distance for the coincident rule; preserve existing station-ID tie breaking for distinct candidates.
- [ ] **Step 4: Verify green.** Run the same focused command; expect pass.

### Task 3: Align route, junctions, motion, and telemetry

**Files:**
- Modify: `frontend/src/lib/mock-session.ts`, `frontend/src/lib/mock-simulation-config.ts`, `frontend/src/lib/mock-session.test.ts`, `frontend/src/lib/mock-simulation-adapter.golden.test.ts`, `frontend/src/lib/__snapshots__/mock-stream.json`

**Interfaces:**
- `createMockRoute()` consumes `estimateMockRoute()` and returns its distance and estimates.
- Synthetic junctions use contract-valid IDs `INT-9001`/`INT-9002` and names `Mock junction A`/`Mock junction B`; their `distance_along_route_m` is the reference fraction of the current distance.
- Every nonterminal tick reports `speed_kmh = 3.6 × (metersAt(t) − metersAt(t−1))`, rounded as the current UI expects; no sinusoidal speed. Existing disabled crossing decisions and signal phases stay deterministic.

- [ ] **Step 1: Write failing route and stream tests.** Assert geometry endpoints match request, total distance matches haversine within rounding tolerance, junction positions lie in order on the route, IDs/names are synthetic, each tick's speed equals its interval distance, and enabled/disabled open-road positions agree until the first controlled crossing.
- [ ] **Step 2: Verify red.** Run `cd frontend && npm test -- lib/mock-session.test.ts lib/mock-simulation-adapter.golden.test.ts`; expect the new assertions and existing golden file to fail.
- [ ] **Step 3: Implement one metric source and scaled junction positions.** Remove hard-coded route metrics and the sinusoidal telemetry branch. Recalculate mock TTI, cascade targets, and cautious crossing from the new distances through the existing timeline.
- [ ] **Step 4: Regenerate and inspect the golden recording.** Run `cd frontend && npm test -- -u lib/mock-simulation-adapter.golden.test.ts`; update only `frontend/src/lib/__snapshots__/mock-stream.json` and inspect that all scenarios terminate and disabled runs still emit no ITS dispatch.
- [ ] **Step 5: Verify green.** Run the focused command again; expect pass.

### Task 4: Make mock preflight reflect selected endpoints

**Files:**
- Modify: `frontend/src/components/hud/DispatchForm.tsx`, `frontend/src/components/hud/dispatch/PreflightEstimate.tsx`, `frontend/src/components/hud/DispatchForm.snapshot.test.tsx`, `frontend/src/components/hud/__snapshots__/DispatchForm.mock.html`, `frontend/src/components/hud/__snapshots__/DispatchForm.backend.html`
- Test: add focused assertions to `frontend/src/components/hud/DispatchForm.snapshot.test.tsx`

**Interfaces:**
- `PreflightEstimate` receives the selected origin and incident positions, or `null`; it uses `estimateMockRoute()` when both exist. With either missing, show an explicit select-incident message and no percentage/time claim. Backend preflight stays `AFTER START`.

- [ ] **Step 1: Write failing component assertions.** Render absent, near, and far incidents plus changed density; assert no fixed values before selection and distinct synthetic estimates after selection. Assert backend markup still makes no mock estimate claim.
- [ ] **Step 2: Verify red.** Run `cd frontend && npm test -- components/hud/DispatchForm.snapshot.test.tsx`; expect new assertions to fail.
- [ ] **Step 3: Pass endpoint positions from the selected ranking and incident into the preflight panel.** Use the shared estimator and label values approximate/mock. Inspect the expected markup change, then run `cd frontend && npm test -- -u components/hud/DispatchForm.snapshot.test.tsx` to update only its affected snapshots.
- [ ] **Step 4: Verify green.** Run the focused command; expect pass.

### Task 5: Browser and full frontend verification

**Files:**
- Modify: `docs/superpowers/plans/2026-10-21-simulation-audit-master.md` status and evidence only after verification.

**Interfaces:** Consumes the estimator, mock session, and preflight UI from Tasks 1–4; produces the verified item-1 completion record.

- [ ] **Step 1: Run the full frontend gate.** `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`; expect every command to exit 0.
- [ ] **Step 2: Check two mock map incidents with `playwright-cli` through bash.** Keep screenshots under `.tmp/playwright/`; confirm the route line changes, reported distance and estimated time change with separation, marker labels say mock, and the speed follows distance between successive ticks. Confirm disabled mode has no corridor/dispatch.
- [ ] **Step 3: Review `git diff --check`, `git diff`, and `git status --short`.** Confirm only focused frontend changes and the master status update are present; do not edit contracts or backend files.
- [ ] **Step 4: Mark item 1 `[Completed]` in the master with the actual test/browser evidence and date.** Propose `fix: make mock simulation metrics route-specific`; if committing locally, stage explicit paths and review the staged diff first.
