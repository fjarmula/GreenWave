# Responsive Map Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Consistent desktop/phone presentation across the app, wider content, saturated home signals and smooth vehicle follow.

**Architecture:** Reuse shared WorkspaceNavigation, WorkspaceShell and BottomSheet. Keep camera animation inside createMapCamera; the displayed marker remains its sole tracking input. Preserve shared scenario and simulation providers.

**Tech Stack:** Existing React 19, Next.js 16, CSS/Tailwind, MapLibre, Vitest and playwright-cli.

**Spec:** `docs/superpowers/specs/2026-10-26-responsive-map-workspace-design.md`

## Global Constraints

- Simulation only; no backend, contracts, actuation, dependencies or lockfile changes.
- The responsive boundary is 768px across all modes; do not infer input capabilities from width.
- All UI text remains English. Preserve light/dark themes, reduced motion and simulation state.
- Work on `codex/responsive-map-workspace-current`; no push, merge or PR.

## Review Focus

- Crossing 767/768px during a run keeps state and the map instance; browser resize check.
- 320px phones and 768px desktop prevent overflow/control collisions; browser geometry checks.
- Follow transition does not get cancelled by marker frames; camera unit tests.
- Manual drag, zoom-out, stale telemetry and disposal cannot reactivate follow; camera unit tests.
- Sheet content scroll and controls stay usable when expanded or hidden; browser scroll/focus checks.

## Milestone 1 — Responsive navigation, layout and color

**Files:** `frontend/src/components/workspace/{WorkspaceNavigation,WorkspaceShell,HomeMenu}.tsx`,
`frontend/src/components/dashboard.tsx`, `frontend/src/components/diagnostics/DiagnosticsWorkspace.tsx`,
`frontend/src/components/comparison/ComparisonWorkspace.tsx`, `frontend/src/app/globals.css`,
related workspace/driver tests.

**Interfaces:** WorkspaceShell consumes WorkspaceSheet only on phones; desktop always consumes inspector.
WorkspaceNavigation keeps `current: string` and supplies both breakpoint presentations.

- [x] Add regression tests for desktop full Driver inspector, labelled mobile navigation, and phone-only sheets in all simulation modes.
- [x] Run focused Vitest tests and observe the new assertions fail.
- [x] Implement shared responsive navigation, full desktop inspector, phone comparison sheet and handle-only sheet dragging. Keep map focus/restore and camera controls available.
- [x] Widen Home/Diagnostics using shared content CSS; use simulation phase swatches for home artwork and legend.
- [x] Run focused tests and inspect browser desktop/phone renders.
- [x] Record milestone result and propose `feat: adapt workspace navigation and panels to screen size`.

## Milestone 2 — Smooth follow camera

**Files:** `frontend/src/lib/camera-policy.ts`, `frontend/src/components/map/{useMapCamera,MapContainer}.tsx` (hook is `.ts`), `frontend/src/components/map/map-camera.test.ts`.

**Interfaces:** createMapCamera retains display/resume/showRoute/reframe/dispose. CameraMap additionally supplies easeTo/stop and transition/gesture events. Hook passes reduced-motion preference.

- [x] Add tests for resume from overview using zoom >=17, closer zoom preservation, no tracking writes during transition, transition completion, user interruption, stale/ended updates and cleanup.
- [x] Run camera tests and observe new assertions fail.
- [x] Implement a single interruptible MapLibre transition followed by displayed-marker tracking; label the control Follow vehicle and disable it for unavailable tracking.
- [x] Run camera and map lifecycle tests; record result and propose `feat: smoothly zoom into vehicle following`.

## Milestone 3 — Verification and review

- [x] Run frontend lint, typecheck, format:check, tests and production build.
- [x] Use playwright-cli through bash with all outputs in `.tmp/playwright/`: desktop 1440/1920px, phone 390/320px, 767/768px boundary, both themes, every route, follow/overview/pan, Focus restore, sheet scrolling and navigation.
- [x] Refresh graph after structural changes, inspect final diff and obtain independent review.
- [x] Fix significant findings with regression coverage and repeat affected checks.
- [x] Record verification and limitations; leave work on the requested branch with no remote side effects.

## Execution record

User explicitly requested planning followed by full autonomous implementation; no additional plan checkpoint.
Initial worktree clean on main; created requested branch in place. Existing dependencies reused.


## Updated baseline after user correction

Restarted from current main `4dfc1fcd` (2026-10-26), which supersedes the stale initial
baseline. Preserve HomeBackdrop (live and static), PageMenu, WorkspaceHeader, FollowProvider,
DispatchSettingsChip and the new minimized phone-sheet snap. Adapt those components instead
of restoring stale files. Add ResponsiveNavigation to select PageMenu on phones and the
standard tab menu on desktop across all destinations. Retain the new backdrop composition;
widen home-content rather than introducing the old separate illustration. Smooth camera
transitions must identify their own moveend events so a preceding user zoomend/moveend pair
or interrupted route fit cannot cancel the new transition.


## Verification and closeout

- Current-main baseline: 103 files, 1,024 tests passed.
- Responsive navigation/desktop inspector tests and camera transition tests observed RED,
  then GREEN. Camera completion is tagged; interrupted eases never snap back before dragstart.
- All frontend checks pass: lint, typecheck, format:check, 104 files / 1,035 tests, production build.
- Browser: 30 light route/width cases (1920,768,767,390,320px) and 18 dark cases
  (1440,390,320px), no page overflow. Current home backdrop, rather than stale illustration, retained.
- Live driver: follow, overview, Focus restore, Details restore, ended follow disabled,
  desktop-to-phone map canvas persistence and scrolling pass.
- Live comparison: two desktop panes / one selectable phone pane, global follow affects both,
  and Focus hides comparison status pass.
- Touch emulation: 320x568 start remains reachable; synthesized native scroll moves details
  181px while the expanded sheet stays put. Physical-phone touch feel and Safari safe areas
  remain a manual device check.
- Independent review: no remaining Critical/Important issues. Comparison summary parity finding
  fixed with a regression test (REJECTED stays visible after visiting Standard).
- Graph refreshed after structural changes. No backend, contracts or dependency changes.
- Milestone commit proposals: `feat: adapt workspace navigation and panels to screen size`;
  `feat: smoothly zoom into vehicle following`. Deliver together as one cohesive local commit.

Ruling: the review's comparison summary finding was treated as a correctness issue because
it displayed a different simulated scenario from the one submitted. Fixed rather than deferred.
Ruling: existing touch-drag code was restricted to the handle so browser content scrolling
remains native; minimized peek/tap and keyboard alternatives are preserved.

Final browser wheel check: repeated wheel steps enter follow; a manual pan suspends it;
reduced-motion resume works. Final full quality gate repeated after all source changes: green.


### Final wheel-event regression

Final console inspection exposed MapLibre `_onEaseFrame is not a function` when a wheel
completion listener synchronously started another ease. Added a test proving no ease starts
until that handler returns; observed RED then GREEN. Wheel-entry transitions now queue one
microtask and reject superseded/disposed requests. Fresh browser wheel/pan/reduced-motion
checks explicitly captured zero page errors. Full quality gate repeated: 1,035 tests pass.
