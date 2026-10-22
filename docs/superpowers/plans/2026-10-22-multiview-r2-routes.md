# R2 — Routes and Mode Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development if chosen by the human). Steps use checkbox syntax. Master: [multi-view programme](2026-10-22-multiview-master.md). Requires R1.

**Goal:** Expose six coherent destinations with mode-correct start behavior and useful direct-entry states.

**Architecture:** Use thin Next App Router pages and a shared SimulationWorkspace accepting a GreenWaveMode. Menu/diagnostic/driver destinations consume persistent runtime state; navigation never owns the stream.

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

- Direct entry without a scenario must show setup rather than an empty live view (Task 1).
- Opposite-mode navigation must not mislabel or replace the active run (Task 2).
- Browser Back/Forward must preserve draft and run state (Task 2).
- Driver entry during a disabled run must offer enabled setup, not display disabled as enabled (Task 2).
- Reload must not implicitly create or stop server sessions (Task 2).

---

## File map and interfaces

- Modify `frontend/src/app/page.tsx`, `app/layout.tsx`, `components/dashboard.tsx` and dashboard header composition.
- Suggested new pages: `frontend/src/app/simulation/green-wave/page.tsx`, `simulation/standard/page.tsx`, `compare/page.tsx`, `diagnostics/page.tsx`, `driver/page.tsx`.
- Create `frontend/src/components/workspace/HomeMenu.tsx`, `WorkspaceNavigation.tsx`, `SimulationWorkspace.tsx`; proposed `SimulationWorkspace({ mode: GreenWaveMode })` consumes R1 hooks. Compare/diagnostic/driver pages initially provide labelled empty/setup views, replaced in their milestones.
- Create `frontend/src/lib/workspace-routes.ts` with one typed destination mapping and mode-to-route lookup; all links consume it. Tests: `workspace-routes.test.ts` and `components/workspace/navigation.test.tsx` using static markup.

## Task 1: Destination map and direct-entry UI

- [ ] Read installed Next layouts/pages/linking guidance; choose final route names and record them in the master. No route-name approval checkpoint is needed.
- [ ] RED: route-map tests assert six distinct destinations, root home, exactly one enabled and disabled lookup, and the driver lookup maps to ENABLED. Static markup tests assert named links and accessible current-page navigation.
- [ ] Run `cd frontend && npm test -- src/lib/workspace-routes.test.ts src/components/workspace/navigation.test.tsx`; observe RED.
- [ ] GREEN: implement pages and menu using Next Link; leave server pages thin and map code client-side. Reuse mode workspace instead of copying Dashboard twice. R1 providers remain above page boundaries.
- [ ] Rerun focused tests and `npm run typecheck`; inspect generated route typing through the project command.

## Task 2: Explicit mode replacement and lifecycle

- [ ] RED: extend `start-request.test.ts`/controller helpers so route-selected mode determines new requests; navigating to another mode performs zero starts/stops; a draft cannot change active request/response mode. Replacement starts only on the explicit user action and honors pending/failed starts.
- [ ] Run the affected tests and observe RED; implement the minimal mode-selection policy and rerun GREEN.
- [ ] Browser: direct-load every route, reload setup, Back/Forward, enabled → disabled → driver with an active enabled/disabled run, and return from menu/diagnostics. No hidden start, stop, reset, duplicate SSE or incorrect mode label.
- [ ] Amend architecture only after notifying the human: replace obsolete single-view/comparison exclusion with this design's six destinations and sequential replay scope. Do not edit accepted ADR history.
- [ ] Run `graphify update .`; keep graph artifacts local. Evidence under `.tmp/playwright/multiview/r2/`.

## Milestone closeout

- [x] Run the full frontend gate listed in the master; require exit 0 or explicitly record any baseline blocker without claiming completion.
- [x] Run `git diff --check`; inspect snapshots and focused diff for unrelated changes.
- [x] Record acceptance evidence, actual file/interface choices and deviations in the master. Propose its listed Conventional Commit; do not perform branch/push/PR operations.


Implementation closeout: see the master completion record for the actual interfaces, tests, browser artifacts and verification limits. The original task checklist is preserved as the detailed planning baseline; programme status is maintained only in the master.
