# Disabled-Mode Explanation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ER Green Wave disabled-mode explanation agree with the implemented rolling crossing model.

**Architecture:** Change the setup explanation only. Keep the mode switch, request payload, backend motion, mock timeline, and generated contract untouched. Pin the new wording with a component test.

**Tech Stack:** React, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-disabled-mode-copy-design.md` and its referenced `docs/superpowers/specs/2026-10-21-er-green-wave-corrections-design.md`.

## Root cause

`GreenWaveToggle.tsx` says the disabled vehicle “waits for a life corridor and crosses at the speed limit.” The accepted correction design and `GreenWave_ARCHITECTURE.md` §3 say red/yellow crossings roll without stopping, spreading an extra cautious time over a modelled distance and staying at or below the ordinary speed limit. The browser showed positive low speed during a disabled crossing. The setup text predates that motion correction.

## Global Constraints

- English, concise, simulation-specific text; do not imply permission to cross physical signals or make safety claims.
- No behavior, public contract, dependency, or lockfile change.
- Keep enabled-mode copy and mode control behavior unchanged. Use TDD and update the master only after verification.
- After each task, report changed files, checks and results, decisions or blockers, and a proposed Conventional Commit subject; continue to the next task unless blocked.

## File map

- `frontend/src/components/hud/dispatch/GreenWaveToggle.tsx`: disabled-mode explanation.
- `frontend/src/components/hud/dispatch/GreenWaveToggle.test.tsx`: exact meaning assertion.
- `frontend/src/components/hud/__snapshots__/DispatchForm.mock.html` and `DispatchForm.backend.html`: update if affected by the copy change.

## Review Focus

- Disabled text says no signal priority; tested in Task 1.
- Red/yellow motion is described as rolling cautiously without stopping; tested in Task 1.
- The text does not promise that all crossings are at the speed limit; tested in Task 1.
- Enabled text remains unchanged; tested in Task 1.
- Mock and backend setup show the same disabled-mode explanation; tested in Task 1 snapshots.

---

### Task 1: Correct and pin the explanation

**Files:**
- Modify: `frontend/src/components/hud/dispatch/GreenWaveToggle.tsx`, `frontend/src/components/hud/dispatch/GreenWaveToggle.test.tsx`, `frontend/src/components/hud/__snapshots__/DispatchForm.mock.html`, `frontend/src/components/hud/__snapshots__/DispatchForm.backend.html`

**Interfaces:** None. Preserve `GreenWaveToggle({ mode, onChange })`.

- [ ] **Step 1: Write a failing disabled-copy assertion.** Render both modes. Require disabled copy to convey: simulated standard traffic, no signal priority, red/yellow controlled crossings roll cautiously without stopping. Assert the old “waits for a life corridor” claim is absent and enabled copy remains unchanged.
- [ ] **Step 2: Verify red.** Run `cd frontend && npm test -- components/hud/dispatch/GreenWaveToggle.test.tsx`; expect the new disabled assertion to fail.
- [ ] **Step 3: Replace only the disabled sentence.** Use one concise sentence or two short sentences; keep the mode's underlying request/value unchanged.
- [ ] **Step 4: Update affected snapshots and verify green.** Inspect the expected copy change, run `cd frontend && npm test -- -u components/hud/DispatchForm.snapshot.test.tsx`, then run `cd frontend && npm test -- components/hud/dispatch/GreenWaveToggle.test.tsx components/hud/DispatchForm.snapshot.test.tsx`; expect pass.

### Task 2: Verify and record completion

**Files:**
- Modify: `docs/superpowers/plans/2026-10-21-simulation-audit-master.md` status and evidence only after verification.

**Interfaces:** Consumes the corrected copy from Task 1; produces the item-4 completion record.

- [ ] **Step 1: Run the frontend gate.** `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`; expect exit 0.
- [ ] **Step 2: Review `git diff --check`, `git diff`, and `git status --short`.** Confirm the diff contains only copy, its tests/snapshots, and the master update. Mark item 4 `[Completed]` with commands and results. Propose `fix: describe rolling standard-traffic crossing`; stage explicit paths only if making a local commit.
