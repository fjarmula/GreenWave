# Mobile Dispatch Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep all setup controls, including Police and Start, reachable within 320 px and 390 px phone viewports.

**Architecture:** Fix intrinsic sizing in the existing dashboard grid and dispatch panel, then allow long station text to shrink within its row. Keep the current map-first mobile layout, component boundaries, and visual system.

**Tech Stack:** Next.js, React, Tailwind CSS, Vitest, `playwright-cli`.

**Spec:** `docs/superpowers/specs/2026-10-21-mobile-dispatch-layout-design.md`.

## Root cause

At 390 px with a real station ranking, the setup `aside` measured 518 px wide. Its three-column vehicle control measured 478 px, placing Police's right edge at x=493. The grid item's default intrinsic minimum width lets content widen the column; `overflow-x-hidden` on the dashboard then clips the excess. Static markup tests verify that Police exists but cannot detect whether it is reachable. Long station names and ranking rows are the trigger to keep in the reproduction.

## Global Constraints

- Keep all three vehicle types available without horizontal scrolling at 320 px and 390 px.
- Do not solve this by hiding overflow or reducing accessible tap targets below the current `min-h-9`/`min-h-12` values.
- Preserve desktop width, map behavior, light/dark themes, English copy, and existing contracts. No dependency or lockfile change.
- Use `.agent/skills/playwright-cli` through bash, save output under `.tmp/playwright/`, and do not dump DOM or accessibility trees. Apply `.agent/skills/mobile-native` and `.agent/skills/break-ui` to the focused browser review. Use `.agent/skills/emil-design-eng` for a final UI craft review; keep any unrelated polish outside this fix.
- Read `frontend/AGENTS.md` and relevant local Next.js documentation before changing components. Update the master only after fresh verification.
- After each task, report changed files, checks and results, decisions or blockers, and a proposed Conventional Commit subject; continue to the next task unless blocked.

## File map

- `frontend/src/components/dashboard.tsx`: permit the setup grid item to shrink.
- `frontend/src/components/hud/DispatchForm.tsx`: permit the `aside` to shrink to its allocated width.
- `frontend/src/components/hud/dispatch/StationRanking.tsx`: ensure winner and runner-up labels can truncate/wrap without imposing their intrinsic width.
- `frontend/src/components/hud/dispatch/VehicleTypeControl.tsx`: retain three equal reachable buttons at narrow width.
- `frontend/src/components/hud/__snapshots__/DispatchForm.mock.html`, `DispatchForm.backend.html`, and `frontend/src/components/__snapshots__/Dashboard.setup.mock.html`, `Dashboard.setup.backend.html`: update only if affected by focused class changes.

## Review Focus

- A long hospital name with two runners-up leaves Police visible and clickable at 320 px; browser check in Task 1.
- A long unbreakable station label does not widen the page; browser check in Task 1.
- The incident input, slider, mode and cascade controls, speed selector, and Start remain inside the viewport; browser check in Task 2.
- The selected vehicle changes ranking and the start request still uses that type; browser check in Task 2.
- Desktop at 1280 px keeps the existing sidebar/map proportions and no new overflow; browser check in Task 2.

---

### Task 1: Reproduce and remove intrinsic width overflow

**Files:**
- Modify: `frontend/src/components/dashboard.tsx`, `frontend/src/components/hud/DispatchForm.tsx`, `frontend/src/components/hud/dispatch/StationRanking.tsx`, `frontend/src/components/hud/dispatch/VehicleTypeControl.tsx` only where measured width requires it.
- Test: `frontend/src/components/hud/DispatchForm.snapshot.test.tsx`, `frontend/src/components/dashboard-parts.snapshot.test.tsx` and their existing snapshots only if markup changes.

**Interfaces:** None; layout-only changes. Preserve `DispatchForm` and `VehicleTypeControl` props.

- [ ] **Step 1: Record the failing browser condition.** Start backend mode with prepared GIS artifacts, select a long-name station ranking, resize to 390 × 844 and 320 × 720 with `playwright-cli`, and evaluate `aside.getBoundingClientRect().right`, `document.documentElement.scrollWidth`, and the three vehicle button bounds. Expect at least one button or the aside outside the viewport before the fix. Save screenshots only under `.tmp/playwright/`.
- [ ] **Step 2: Add the smallest CSS sizing change.** Set `min-w-0` on the dashboard's setup grid item and dispatch `aside`; adjust only the ranking row's shrinking/truncation if the browser measurements still overflow. Retain visible focus rings and current minimum button heights.
- [ ] **Step 3: Re-run the measured browser condition.** At both phone widths, expect `aside.right <= innerWidth`, each vehicle button's left/right bounds within the viewport, `document.documentElement.scrollWidth <= innerWidth`, and no clipped station ranking controls.
- [ ] **Step 4: Update affected markup snapshots after inspection.** If the class changes alter recorded markup, run `cd frontend && npm test -- -u components/hud/DispatchForm.snapshot.test.tsx components/dashboard-parts.snapshot.test.tsx`, inspect the snapshot diff, then run `cd frontend && npm test -- components/hud/DispatchForm.snapshot.test.tsx components/dashboard-parts.snapshot.test.tsx`; expect pass with only intended class changes.

### Task 2: Verify interaction and responsive regression

**Files:**
- Modify: `docs/superpowers/plans/2026-10-21-simulation-audit-master.md` status and evidence only after verification.

**Interfaces:** Consumes the layout from Task 1; produces measured browser evidence and the item-2 completion record.

- [ ] **Step 1: Exercise the phone setup with `playwright-cli`.** At 320 px and 390 px, select Ambulance, Fire, and Police; confirm each changes the winner, enter/select an incident, adjust traffic density and playback speed, and check Start remains visible and usable. Include a long unbreakable test label using browser-only test data or the `break-ui` workflow; do not alter production data.
- [ ] **Step 2: Inspect 1280 px desktop and light/dark modes.** Confirm the map and sidebar retain their intended proportions, controls do not overlap, and focus remains visible.
- [ ] **Step 3: Run the frontend gate.** `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`; expect exit 0 throughout.
- [ ] **Step 4: Review `git diff --check`, `git diff`, and `git status --short`.** Confirm only focused layout/snapshot changes and master status. Mark item 2 `[Completed]` with measured viewport evidence and commands. Propose `fix: keep dispatch controls within mobile viewport`; stage explicit paths only if making a local commit.
