# R5 — Sequential Capture and Synchronized Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development if chosen by the human). Steps use checkbox syntax. Master: [multi-view programme](2026-10-22-multiview-master.md). Requires R1–R4.

**Goal:** Compare complete same-scenario enabled/disabled recordings honestly, with Focus Mode default.

**Architecture:** A persistent comparison controller acquires the single runtime operation slot, records enabled then disabled through existing adapters, and releases it on completion/cancel/error. A pure replay selector supplies explicit map render snapshots; replay never writes into live run state.

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

- Missing initial/intermediate ticks or mismatched route geometry must reject completeness (Task 1).
- Cancel during pending start must stop that late run and never start the second mode (Task 1).
- Frame/byte caps and abandoned buffers must bound retained recording memory (Task 1).
- Different arrival/completion times must not corrupt deltas or synchronized positions (Task 2).
- Mobile mode toggling/scrubbing must not restart replay or subscribe to live streams (Task 2).

---

## File map and interfaces

- Create `frontend/src/lib/comparison/recording.ts`, `comparison-controller.ts`, `replay.ts` with corresponding `.test.ts` files.
- Create `frontend/src/components/comparison/ComparisonWorkspace.tsx`, `ComparisonControls.tsx` and `ComparisonProvider.tsx`; wire its persistent owner beneath the root providers.
- Modify `frontend/src/components/map/MapContainer.tsx` and context-reading map layers to consume a typed render snapshot. Keep a live-context wrapper for existing views. Snapshot reuses generated route/tick types and carries explicit stale, vehicle, playback and endpoints; comparison panes supply their own snapshot without global-provider swapping.
- Proposed `RecordedRun`: frozen request, validated route, tick/dispatch arrays and completion. `ComparisonPair`: enabled/disabled recordings plus frozen scenario. Proposed controller interface: `startComparison(request): Promise<void>`, `cancelComparison(): void`, `getState()`, `subscribe(listener)`; internal operation generation rejects abandoned callbacks.
- Proposed `selectReplayFrame(run: RecordedRun, elapsedSeconds: number)` returns the actual bracketing frames/terminal state needed by existing interpolation. A separate replay clock supports play/pause/seek/restart and is never a simulation engine.

## Task 1: Exclusive sequential recording and integrity

- [ ] RED: fake-adapter controller tests assert no second start before first successful terminal; only mode/id differ; new standalone starts cannot silently race comparison; cancellation during STARTING stops late success and blocks mode two; failed start/terminal/gaps produce an incomplete pair and useful retry state.
- [ ] RED: recording tests assert coverage tick 1..terminal.tick, duplicate dispatch/tick handling, wrong run id rejection, exact route/settings match, cancellation rejection, reconnect with no gap accepted, missing initial/intermediate tick rejected. Test limits at/below/above 10,000 frames/mode and 32 MiB pair; overflow cancels and clears discarded data.
- [ ] Run `cd frontend && npm test -- src/lib/comparison/recording.test.ts src/lib/comparison/comparison-controller.test.ts`; observe RED.
- [ ] GREEN: reuse R1 lifecycle/controller logic rather than creating a second uncoordinated subscription. A user confirms active-run replacement through the explicit action; cancel/retry cannot publish an abandoned pair. Bound memory while appending, not only after retaining an unbounded pair.
- [ ] Rerun focused tests. Real backend capture must prove complete tick coverage; expose limitations of latest-only reconnect rather than fabricating history or silently switching to mock.

## Task 2: Honest common-clock replay and map presentation

- [ ] RED: replay tests assert equal elapsed seconds select matching simulated ticks despite different wall timestamps/speeds; fractional cursor uses existing route interpolation; arrived vehicle holds destination; completion differs from arrival; actual pair delta uses completed results; seek clamps; pause/hidden tab freezes cursor; toggling pane retains cursor.
- [ ] Run `cd frontend && npm test -- src/lib/comparison/replay.test.ts`; observe RED.
- [ ] GREEN: refactor map render inputs, add equal desktop panes and one narrow-screen map with toggle. Default Focus Mode on each route entry. Reveal setup/recording progress and replay controls deliberately; controls remain reachable through Exit Focus before recordings exist. Pane labels/provenance persist in focus.
- [ ] Support play/pause/restart/scrub and unequal run lengths. Linked overview cameras are optional; independent follow centers each vehicle. If linking is implemented, fake-map tests must prove event guards prevent recursion.
- [ ] Browser mock/backend: freeze a signal-bearing scenario, record 10x, verify complete coverage and terminals, then play/seek/pause/restart/toggle at desktop and phone widths. Stub a dropped tick, pending-start cancel and recording overflow; each yields an explicit incomplete/cancelled state, never results.
- [ ] Record preparation time, peak retained frames/bytes and scenario under `.tmp/playwright/multiview/r5/`; run `graphify update .`.

## Milestone closeout

- [x] Run the full frontend gate listed in the master; require exit 0 or explicitly record any baseline blocker without claiming completion.
- [x] Run `git diff --check`; inspect snapshots and focused diff for unrelated changes.
- [x] Record acceptance evidence, actual file/interface choices and deviations in the master. Propose its listed Conventional Commit; do not perform branch/push/PR operations.


Implementation closeout: see the master completion record for the actual interfaces, tests, browser artifacts and verification limits. The original task checklist is preserved as the detailed planning baseline; programme status is maintained only in the master.
