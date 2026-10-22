# R3 — Viewport Workspace and Focus Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development if chosen by the human). Steps use checkbox syntax. Master: [multi-view programme](2026-10-22-multiview-master.md). Requires R2.

**Goal:** Keep the map and essential actions in the viewport with a reversible, accessible Focus Mode.

**Architecture:** Refactor RoutePreview into stable map composition plus sibling workspace HUD. Use a compact header and one collapsible inspector; narrow screens use an accessible details sheet. Focus affects presentation only.

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

- 320px widths and short landscape screens must not produce document overflow (Task 1).
- Inspector/focus/setup changes must not reconstruct the map (Task 1).
- Large text and software keyboard must leave actions reachable (Task 1/browser).
- Focus must hide tab stops and restore focus on exit (Task 2).
- Nested dialogs must consume Escape before Focus Mode (Task 2).

---

## File map and interfaces

- Modify `frontend/src/components/dashboard/RoutePreview.tsx`, `DashboardHeader.tsx`, HUD composition, `components/workspace/SimulationWorkspace.tsx`, `app/globals.css` and `components/map/useMaplibreMap.ts`.
- Create `components/workspace/WorkspaceShell.tsx`, `WorkspaceInspector.tsx`, `FocusControl.tsx` under `frontend/src/`; reuse existing Base UI primitives rather than adding a sheet dependency.
- Proposed shell contract: `{focusMode: boolean, onFocusModeChange(next: boolean): void, map: ReactNode, inspector: ReactNode, header: ReactNode}`. Keep focus state independent from SimulationState.
- Map resizing consumes container size changes through ResizeObserver with proper cleanup. Expose visible-area padding to R4; no direct camera fit from inspector components.
- Tests: proposed `lib/workspace-layout.test.ts`, `components/workspace/workspace-shell.test.tsx`; existing Dashboard/form/summary snapshots.

## Task 1: Stable fixed-height layout

- [ ] RED: shell markup tests assert stable map slot between setup/live and focus states, labelled inspector and explicit Stop in running non-focus presentation. Pure layout tests cover zero/tiny containers without negative map dimensions. Actual map construction counts belong in browser acceptance.
- [ ] Run `cd frontend && npm test -- src/lib/workspace-layout.test.ts src/components/workspace/workspace-shell.test.tsx`; observe RED.
- [ ] GREEN: replace large min-heights and mobile below-map panel stacks with a shrinkable viewport grid. Use vh fallback/dvh override, min-h-0/min-w-0 and bounded internal lists. Reuse audit M6 size guards and map-stability work if available.
- [ ] Keep one inspector; agent chooses side, width, breakpoint and tab/disclosure arrangement. Dataset detail moves to diagnostics; advanced dispatch controls remain reachable.
- [ ] Rerun focused tests and affected snapshots; review word diff. ResizeObserver must call map.resize without recreating the map or fitting on every callback.

## Task 2: Accessible Focus Mode

- [ ] RED: shell markup test asserts focused output excludes HUD controls and retains a named Exit Focus control, attribution/provenance and map content. Focus default is false for single simulation; R5 explicitly supplies true.
- [ ] Run the shell test, observe RED, implement presentation toggling and rerun GREEN. Do not hide interactive content with opacity alone.
- [ ] Browser at 1440x1000, 1280x720, 390x844, 320x720 and 844x390: assert document scroll dimensions do not exceed the viewport for simulation; only bounded panels scroll. At 200% text/zoom, actions remain reachable.
- [ ] Browser: Tab into Focus, activate it, verify hidden controls cannot receive focus, exit by button/Escape, restore trigger focus; nested dialog Escape closes the dialog first. Repeat at reduced motion and both themes.
- [ ] Instrument map construction in a browser test: setup → live → focus → inspector → terminal → setup constructs one map in the mounted workspace. Output under `.tmp/playwright/multiview/r3/`.

## Milestone closeout

- [x] Run the full frontend gate listed in the master; require exit 0 or explicitly record any baseline blocker without claiming completion.
- [x] Run `git diff --check`; inspect snapshots and focused diff for unrelated changes.
- [x] Record acceptance evidence, actual file/interface choices and deviations in the master. Propose its listed Conventional Commit; do not perform branch/push/PR operations.


Implementation closeout: see the master completion record for the actual interfaces, tests, browser artifacts and verification limits. The original task checklist is preserved as the detailed planning baseline; programme status is maintained only in the master.
