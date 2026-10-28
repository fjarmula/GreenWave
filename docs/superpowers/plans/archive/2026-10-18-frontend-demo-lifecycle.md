# Frontend Demo Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple playback-speed domain values from the HUD and characterize stopped mock streams, while documenting the real-backend browser acceptance workflow.

**Architecture:** `src/lib/playback-speed.ts` becomes the single owner of the D9 speed tuple and its inferred TypeScript union. The mock adapter behavior stays unchanged; its existing stream golden test gains one deterministic STOPPED scenario and an explicit post-terminal silence assertion. The manual browser check exercises the existing Compose backend path rather than adding browser-test infrastructure.

**Tech Stack:** Next.js 16 / React 19 / TypeScript strict / Vitest 5 / Prettier / Docker Compose / `@playwright/cli` through bash.

**Spec:** `docs/superpowers/specs/2026-10-18-frontend-demo-lifecycle-design.md`

## Global Constraints

- Read `frontend/AGENTS.md` and the relevant Next.js 16 guide under `frontend/node_modules/next/dist/docs/` before modifying frontend code.
- Preserve ADR 0003 D9 values `1 | 2 | 5 | 10`, D22 mock-default behavior, and the v1 generated contract unchanged.
- Keep mock transport synthetic and visibly simulated; do not add traffic-controller behavior.
- Add no dependency or lockfile change; never edit `contracts/openapi.json` or `frontend/src/types/api.generated.ts` by hand.
- Use `@playwright/cli` through bash for browser acceptance only; never use Playwright MCP or write its output outside `.tmp/playwright/`.
- Own only the files listed below. Do not edit backend code, root docs, Compose files, schemas, or generated artifacts.

## Review Focus

1. A component-to-library import regression — `src/lib/start-request.ts` must not import a domain type from `src/components/`; Task 1 adds the direct library import and typecheck proves it.
2. A changed allowed-speed tuple — imports must preserve `[1, 2, 5, 10]` and the selector's four options; Task 1 pins the tuple with a unit test and existing dashboard snapshot remains green.
3. A stopped stream that continues emitting telemetry — the golden scenario advances extra fake time after `stop()` and Task 2 asserts no callback records are appended.
4. Terminal event ordering or reason drift — the snapshot must show one `onTerminal` `SIMULATION_CANCELLED` envelope with `reason: "STOPPED"` after recorded ticks; Task 2 pins it.
5. A backend demo mistaken for mock behavior — Task 3 documents the existing Compose backend mode and requires real-stack verification without changing `DEFAULT_TRANSPORT`.

## File structure

- Create: `frontend/src/lib/playback-speed.ts` — reusable D9 allowed values and inferred union.
- Create: `frontend/src/lib/playback-speed.test.ts` — tuple characterization.
- Modify: `frontend/src/components/hud/dispatch/PlaybackSpeedSelector.tsx` — import library values/types only.
- Modify: `frontend/src/components/hud/DispatchForm.tsx` — import the state type from the library module.
- Modify: `frontend/src/lib/start-request.ts` — import the request-setting type from the library module, not a component.
- Modify: `frontend/src/lib/mock-simulation-adapter.golden.test.ts` — add deterministic stopped-stream scenario.
- Modify: `frontend/src/lib/__snapshots__/mock-stream.json` — approved golden output update only.
- Modify: `frontend/README.md` — real-backend browser acceptance procedure and prerequisites.

### Task 1: Extract playback-speed domain values

**Files:**
- Create: `frontend/src/lib/playback-speed.ts`
- Create: `frontend/src/lib/playback-speed.test.ts`
- Modify: `frontend/src/components/hud/dispatch/PlaybackSpeedSelector.tsx`
- Modify: `frontend/src/components/hud/DispatchForm.tsx`
- Modify: `frontend/src/lib/start-request.ts`

**Interfaces:**
- Produces: `PLAYBACK_SPEEDS: readonly [1, 2, 5, 10]` and `PlaybackSpeed`, inferred from that tuple.
- Consumes: existing `DispatchSettings.playbackSpeed` and `PlaybackSpeedSelectorProps` without changing their public shapes.

- [ ] **Step 1: Write the failing playback-speed module test**

```ts
import { expect, it } from "vitest";
import { PLAYBACK_SPEEDS } from "@/lib/playback-speed";

it("exports the D9 playback-speed options in selector order", () => {
  expect(PLAYBACK_SPEEDS).toEqual([1, 2, 5, 10]);
});
```

- [ ] **Step 2: Run the focused test to verify it fails because the module is absent**

Run: `cd frontend && npm test -- src/lib/playback-speed.test.ts`

Expected: FAIL with module-not-found for `@/lib/playback-speed`.

- [ ] **Step 3: Add `playback-speed.ts` and redirect every listed consumer to it**

Export exactly the tuple and inferred union from the spec. Remove their definitions from `PlaybackSpeedSelector.tsx`; leave selector markup, labels, role, classes, and callbacks unchanged. Make `DispatchForm.tsx` and `start-request.ts` import `PlaybackSpeed` from `@/lib/playback-speed`, using `import type` where only the type is needed.

- [ ] **Step 4: Run focused frontend tests and typecheck**

Run: `cd frontend && npm test -- src/lib/playback-speed.test.ts src/lib/start-request.test.ts && npm run typecheck`

Expected: PASS. `start-request.ts` has no import from `@/components/hud/dispatch/PlaybackSpeedSelector`.

- [ ] **Step 5: Commit the focused relocation**

```bash
git add frontend/src/lib/playback-speed.ts frontend/src/lib/playback-speed.test.ts frontend/src/components/hud/dispatch/PlaybackSpeedSelector.tsx frontend/src/components/hud/DispatchForm.tsx frontend/src/lib/start-request.ts
git commit -m "refactor: move playback speed to frontend lib"
```

### Task 2: Characterize a stopped mock-stream scenario

**Files:**
- Modify: `frontend/src/lib/mock-simulation-adapter.golden.test.ts`
- Modify: `frontend/src/lib/__snapshots__/mock-stream.json`

**Interfaces:**
- Consumes: `SimulationAdapter.stop(simulationId)` and existing recorder callbacks.
- Produces: a golden scenario whose terminal event is `SIMULATION_CANCELLED` with `reason: "STOPPED"` and whose post-stop callback count is stable.

- [ ] **Step 1: Extend the test scenario data with a stopped-run case**

Add a scenario identified as stopped that starts and subscribes as today, advances exactly two `MOCK_STREAM_INTERVAL_MILLISECONDS` intervals, calls `await adapter.stop(request.simulation_id)`, then advances five more intervals. Record the existing callback payloads with the scenario label/index. Do not change the existing completion scenario inputs.

- [ ] **Step 2: Add the explicit post-terminal silence assertion and run the test before updating its golden file**

Capture the callback record length immediately after `stop()`. After the extra five intervals, assert the length is unchanged; also assert that the scenario recorded exactly one terminal callback matching `{ event_type: "SIMULATION_CANCELLED", reason: "STOPPED" }`.

Run: `cd frontend && npm test -- src/lib/mock-simulation-adapter.golden.test.ts`

Expected: FAIL only because the file snapshot lacks the new stopped-run records; the semantic assertions pass.

- [ ] **Step 3: Regenerate and inspect the approved snapshot**

Run: `cd frontend && npm test -- src/lib/mock-simulation-adapter.golden.test.ts -u`

Expected: PASS and only `src/lib/__snapshots__/mock-stream.json` changes. Inspect the stopped scenario to confirm its final callback is one STOPPED cancellation and that no callback follows it.

- [ ] **Step 4: Run all mock lifecycle and snapshot coverage**

Run: `cd frontend && npm test -- src/lib/mock-simulation-adapter.test.ts src/lib/mock-simulation-adapter.golden.test.ts src/components/dashboard-parts.snapshot.test.tsx`

Expected: PASS; existing completion, cascade, supersede, and selector markup behavior remain unchanged.

- [ ] **Step 5: Commit the golden characterization**

```bash
git add frontend/src/lib/mock-simulation-adapter.golden.test.ts frontend/src/lib/__snapshots__/mock-stream.json
git commit -m "test: cover stopped mock stream in golden snapshot"
```

### Task 3: Document and execute real-backend browser acceptance

**Files:**
- Modify: `frontend/README.md`

**Interfaces:**
- Consumes: the existing `compose.yaml` backend transport environment and endpoint lifecycle.
- Produces: a concise manual acceptance procedure; no committed automation script or browser artifact.

- [ ] **Step 1: Add a frontend README subsection for backend-mode browser verification**

State the prerequisite that raw and processed GIS data have already been prepared per the root README. Document `docker compose up --build`, the dashboard/API URLs, and that Compose selects `NEXT_PUBLIC_SIMULATION_TRANSPORT=backend` while the native default remains mock. List these observed acceptance actions: initialize a route, receive live telemetry, stop mid-run and see cancellation, then start in a second tab and see the first run superseded.

- [ ] **Step 2: Run the documented browser check with the approved CLI when prepared data are available**

Use the `playwright-cli` skill and `@playwright/cli` through bash. Keep all browser output under `.tmp/playwright/`; do not commit it. If the local GIS bundle is unavailable, record this manual check as skipped in the handoff, while still completing automated verification.

- [ ] **Step 3: Run the full frontend verification suite**

Run: `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`

Expected: every command exits 0.

- [ ] **Step 4: Review the focused diff and commit**

Confirm the diff contains no generated contract, package-lock, Compose, or backend change.

```bash
git add frontend/README.md
git commit -m "docs: record backend dashboard smoke procedure"
```

## Final verification

- [ ] Run `git diff --check` and inspect `git diff --name-only <base>...HEAD`; only the ownership-boundary files may appear.
- [ ] Run the full frontend verification suite from Task 3 again after the final commit.
- [ ] Report the manual browser check separately from automated checks, including its prepared-data prerequisite or reason skipped.
