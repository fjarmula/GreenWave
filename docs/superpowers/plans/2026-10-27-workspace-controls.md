# Workspace Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make workspace controls immediately usable, simplify navigation and preserve complete signal diagnostics.
**Architecture:** Keep camera ownership in the map controller, persistent actions in the workspace shell, settings in existing forms and signal projection in the canonical simulation layer.
**Tech Stack:** Next.js, React, TypeScript, MapLibre, Python/Pydantic, Vitest, pytest.
**Spec:** docs/superpowers/specs/2026-10-27-workspace-controls-design.md

## Global Constraints

Simulation only; no physical actuation. No new dependencies. Generated contracts are never hand-edited. Preserve existing dirty files. Publish only the requested feature branch and PR.

## Review Focus

- Follow after an interrupted zoom or repeated route/follow toggles must respond once.
- Start stays visible with inspector hidden, phone sheet minimized and short landscape viewports.
- Pending and invalid ranking cannot dispatch; on-site dispatch still creates no simulation.
- Pedestrian-only phase data cannot suppress the coarse intersection marker or create a vehicle light.
- Diagnostic colors must remain available after map filtering, with no invented lane geometry.

### Task 1: Navigation and persistent start action

**Files:** shared workspace header/shell and navigation, dashboard, comparison workspace, dispatch form, driver setup card and related tests.
- [x] Add failing tests for concise navigation, shared branding and persistent shell action.
- [x] Extract a shared dispatch start button; wire it once outside scrolling settings for all setup workspaces.
- [x] Preserve error, pending, replacement and on-site behavior; verify targeted tests and responsive layout.
- [x] Propose commit: `feat: keep dispatch actions and branding accessible across workspaces`.

### Task 2: Single-click Follow

**Files:** camera policy/hook and map-camera tests.
- [x] Reproduce the failure and trace camera/interaction events.
- [x] Add a failing regression at the owning boundary and fix the cause.
- [x] Verify follow, manual pan/zoom, stale telemetry, route fit and cleanup.
- [x] Propose commit: `fix: resume vehicle following on the first click`.

### Task 3: Signal UI and diagnostic protocol

**Files:** signal-phase-layer and tests; canonical phase schemas/projection, mock projection, validation, generated contracts and diagnostics tests as required.
- [x] Test vehicle-only map layout, pedestrian-only coarse fallback and diagnostic phase retention.
- [x] Remove pedestrian presentation while retaining protocol data; expose supported approach identity in phase JSON.
- [x] Verify priority conflicts and legal transitions; regenerate canonical artifacts and affected fixtures.
- [x] Propose commit: `feat: expose movement-aware signal diagnostics without pedestrian map lights`.

### Closeout

- [x] Run full frontend and backend checks and browser acceptance through playwright-cli; keep artifacts in `.tmp/playwright/`.
- [x] Refresh graph after structural changes; review the complete diff with a fresh reviewer.
- [x] Commit explicit paths, push the feature branch and open/attach a PR using the repository template.

## Execution record — 2026-10-27

- Navigation/start milestone: extracted DispatchStartButton; the shell owns the persistent action in every setup workspace. Logo and concise page labels use shared chrome. Existing pending, replacement and on-site semantics remain. Targeted regressions passed; all 24 route/viewport browser cases passed.
- Follow milestone: regression reproduced synchronous trailing user zoomend from map.stop resetting Follow to overview. Apply the new Follow intent after stopping the old gesture. Regression RED→GREEN; actual map button and settings switch verified.
- Signal milestone: vehicle-only map layouts and pedestrian-only coarse fallback tested RED→GREEN. Canonical phases add controlled_edge_ids and is_route_movement; regenerated OpenAPI/types. Colors and priority logic remain unchanged, with pedestrian colors preserved in captured JSON. Approach IDs reflect the available data; individual lanes are not modeled.
- Full checks: backend Ruff/format/mypy and 1309 pytest tests passed. Frontend lint/typecheck/format, 1047 Vitest tests and production build passed. Generated contract examples synchronized; graph refreshed.
- Fresh review found one Important issue: errors and on-site results could be hidden after starting from Focus/minimized/hidden details. Standalone failure regression and on-site browser reproduction failed before the correction and passed afterward. Outcomes now share the persistent action area, and on-site results replace the concealed panels. No deferred minors.
- Browser acceptance: six routes at 1280×720, 390×844, 320×720 and 844×390; additional 1440/768 layouts; real Follow and switch interactions; minimized sheets and Focus; high-zoom vehicle-only markers; diagnostic JSON with both movement kinds and context. No application console errors observed. Artifacts remain under .tmp/playwright/workspace-controls/.
- Base branch decision: origin/main now contains the previous responsive-map branch via PR #49, with the same starting tree. Synchronize main before publication so this PR contains only these changes.
- Proposed Conventional Commit: feat: improve workspace controls and signal diagnostics.

Publication: PR #50 (https://github.com/fjarmula/GreenWave/pull/50), branch `codex/workspace-controls-signal-diagnostics`, base `main`. Synchronization with main preserved the exact verified implementation tree. Pre-push mypy, frontend typecheck and generated-contract drift checks passed.
