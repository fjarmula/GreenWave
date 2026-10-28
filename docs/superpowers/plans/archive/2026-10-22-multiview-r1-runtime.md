# R1 — Persistent Runtime and Scenario Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development if chosen by the human). Steps use checkbox syntax. Master: [multi-view programme](2026-10-22-multiview-master.md). Requires none.

**Goal:** Keep one simulation subscription and the draft scenario alive across view changes while preserving explicit Stop behavior.

**Architecture:** Keep SimulationProvider/reducer as run state. Move the stream effect into a persistent SimulationRuntime and expose actions through context. Mount existing dispatch/station hooks once in a ScenarioProvider above route pages; retain separate draft settings and last-finished summary.

**Tech Stack:** Existing Next.js App Router, React, TypeScript, Tailwind/Base UI, MapLibre, Vitest and @playwright/cli; Node 22+.

**Spec:** [Multi-view workspace design](../specs/2026-10-22-multiview-design.md).

## Global Constraints

- Simulation only; never add real signal actuation. Keep simulated values visibly labelled; UI copy stays English.
- Node 22+, existing Next.js App Router, React, strict TypeScript, Tailwind, Base UI/shadcn, MapLibre and Vitest. No dependency or lockfile changes without explicit approval.
- Pydantic schemas are canonical; generated contracts are never hand-edited. This programme does not change backend lifecycle or public contracts.
- Simulation and comparison shells use `height: 100vh; height: 100dvh; overflow: hidden`; only bounded panels/lists may scroll. Preserve browser zoom and access to content at enlarged text sizes.
- HUD stays outside the map rendering boundary. Preserve light/dark themes, telemetry validation, explicit Stop and terminal summaries.
- Git follows AGENTS.md: explicit paths only; no branch operations, push or PR without explicit authorization. Notify the human before changing AGENTS.md or GreenWave_ARCHITECTURE.md.
- Browser work uses @playwright/cli through bash; read playwright-cli skill first. No DOM/a11y tree dumps. All browser output stays under `.tmp/playwright/multiview/`.

## Review Focus

- Late start after replacement/cancel must not overwrite the next run (Task 1).
- Stop failure leaves telemetry active and permits retry (Task 1).
- Repeated/Strict Mode mount cleanup must leave one subscriber (Task 1/browser).
- Draft edits must not relabel the active run (Task 2).
- Stopped/failed runs must not replace the previous finished summary (Task 2).

---

## File map and interfaces

- Modify `components/simulation-provider.tsx`, `lib/useSimulationStream.ts`, `lib/simulation-controller.ts`, `app/layout.tsx` and `components/dashboard.tsx` under `frontend/src/`.
- Create `frontend/src/components/simulation-runtime.tsx`: proposed `useSimulationActions()` returns `startSimulation(request): Promise<boolean>`, `stopRun(): void`, and `resetToSetup(): void`. Reset is allowed only after an ended run or explicit abandoned-start cleanup; navigation does not call it.
- Create `frontend/src/components/scenario-provider.tsx`: proposed `useScenario()` exposes existing `IncidentDispatch`, station loading result, `DispatchSettings`, `setSettings(next)` and immutable run labels captured at start. Reuse existing exported types; avoid competing models.
- Reuse audit `previous-run.ts` and `simulation-id.ts` if present; otherwise implement their focused helpers/tests as specified in audit M3/M7. Settings become controlled in `hud/DispatchForm.tsx`.
- Create `frontend/src/lib/scenario-state.ts` only for pure scenario/run-label capture decisions needed by tests; reuse the provider and existing dispatch types, without duplicating ranking state. Proposed `captureRunLabels(scenario)` returns the immutable station/incident labels and selected endpoints used by a run.
- Tests: `lib/simulation-controller.test.ts`, `lib/simulation-state.test.ts`, proposed `lib/scenario-state.test.ts`, existing form/summary tests. Internal helper names may change together with downstream references.

## Task 1: Persistent runtime and action ownership

- [ ] RED: extend controller tests for one active subscription after connect-cleanup-connect; late pending start after cancel is stopped and reports false; stopped terminal/HTTP confirmation are idempotent; failed stop keeps RUNNING and accepts subsequent ticks and retry. Preserve existing cases rather than duplicating them.
- [ ] Run `cd frontend && npm test -- src/lib/simulation-controller.test.ts src/lib/simulation-state.test.ts`; observe the intended failing assertions for newly extracted behavior.
- [ ] GREEN: move the subscription effect out of route-level consumers. Expose stable actions from the persistent runtime; inject adapter/time dependencies into pure helpers for testing. Consumers must not mount independent stream effects.
- [ ] Rerun the focused command; all tests pass. Browser later verifies actual React ownership, since node-only Vitest cannot prove hook mount behavior.

## Task 2: Shared scenario and retained result

- [ ] RED: scenario-state tests assert density/playback/cascade survive reset-to-setup, run labels remain the values captured at start after draft edits, only FINISHED replaces the prior summary, and mode-specific start overrides only the request mode. Test secure-context-safe ID generation when randomUUID is unavailable using audit M7's contract pattern.
- [ ] Run `cd frontend && npm test -- src/lib/scenario-state.test.ts src/lib/start-request.test.ts`; add the helper test paths selected above and observe RED.
- [ ] GREEN: make DispatchForm controlled; reuse dispatch cancellation/ranking logic and capture finished summaries before reset. Replace direct UUID call sites with the existing/new safe helper. No session recovery/persistence service.
- [ ] Rerun focused tests plus affected form/summary snapshots; inspect the changed markup.

## Browser acceptance

- [ ] Mock and backend: start → Stop → summary → back → settings retained; make Stop fail once and confirm telemetry/retry still work.
- [ ] Once R2 routes exist, navigate simulation → menu → diagnostics → same simulation; verify one SSE connection at a time and advancing ticks. Strict Mode cleanup must not duplicate subscriptions.
- [ ] Keep the initial runtime milestone independently verifiable by navigating/unmounting the view in a temporary browser test harness if routes are not yet available; do not ship a harness route. Evidence under `.tmp/playwright/multiview/r1/`.

## Milestone closeout

- [x] Run the full frontend gate listed in the master; require exit 0 or explicitly record any baseline blocker without claiming completion.
- [x] Run `git diff --check`; inspect snapshots and focused diff for unrelated changes.
- [x] Record acceptance evidence, actual file/interface choices and deviations in the master. Propose its listed Conventional Commit; do not perform branch/push/PR operations.


Implementation closeout: see the master completion record for the actual interfaces, tests, browser artifacts and verification limits. The original task checklist is preserved as the detailed planning baseline; programme status is maintained only in the master.
