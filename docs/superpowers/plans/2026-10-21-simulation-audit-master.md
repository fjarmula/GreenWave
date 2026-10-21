# Simulation Audit Improvements: Master Execution Plan

This is the single status record for the five findings from the 2026-10-21 browser audit. Execute the linked plans **one at a time**, in the order below. Do not start the next item until the current item's acceptance checks pass and this file is updated. No implementation is authorized by creating these plans.

## Status legend and update rule

- `[Pending]`: no product change has started.
- `[In Progress]`: the named plan is being implemented or verified.
- `[Completed]`: its acceptance criteria and required checks passed; record evidence below.

For each item, change its single checkbox/status pair from `- [ ] [Pending]` to `- [ ] [In Progress]`, then to `- [x] [Completed]` only after fresh verification. Add the date, commands, results, and any deviation to the completion record. Preserve prior records across sessions. If blocked, leave the checkbox open and record the blocker; never mark a partial fix complete. Review the diff and stage explicit paths only if making a local commit. No branch, push, or PR operation is part of this plan.

## Ordered work

- [ ] **[Pending] 1. High — Make mock route and telemetry internally consistent.** [Sub-plan](2026-10-21-mock-route-consistency.md). Dependency: none. Completion record: _pending_. Suggested commit: `fix: make mock simulation metrics route-specific`.
- [ ] **[Pending] 2. High — Restore phone-width dispatch access.** [Sub-plan](2026-10-21-mobile-dispatch-layout.md). Dependency: none; run after item 1 so the mobile check also covers its updated estimates. Completion record: _pending_. Suggested commit: `fix: keep dispatch controls within mobile viewport`.
- [ ] **[Pending] 3. Medium — Present terminal vehicle speed accurately.** [Sub-plan](2026-10-21-terminal-speed-presentation.md). Dependency: item 1's mock regression fixtures, so both transports share the same display rule. Completion record: _pending_. Suggested commit: `fix: distinguish terminal state from last interval speed`.
- [ ] **[Pending] 4. Medium — Correct disabled-mode explanation.** [Sub-plan](2026-10-21-disabled-mode-copy.md). Dependency: none; execute after simulation presentation work. Completion record: _pending_. Suggested commit: `fix: describe rolling standard-traffic crossing`.
- [ ] **[Pending] 5. Low — Remove the fictitious pre-start route ID.** [Sub-plan](2026-10-21-prestart-route-badge.md). Dependency: none; execute last. Completion record: _pending_. Suggested commit: `fix: label route preview before initialization`.

## Shared design and acceptance contract

**Intent:** A dispatcher should be able to select every vehicle type on a phone and understand exactly which simulation data are synthetic, current, historical, or not yet computed. The backend remains the authority for backend-mode route geometry and timing.

**Scope:** The five findings above only. Preserve dispatch, routing, 1 Hz simulated ticks, cascade and signal semantics, stop, supersession, light/dark themes, and the backend's documented arrival-tick speed contract. No live traffic actuation, new dependency, lockfile change, schema change, or generated-contract edit is planned.

**Mock decision:** Keep arbitrary map-click incidents. Derive the mock's straight-line distance and both estimates from the chosen endpoints and existing synthetic reference rates; scale its two demonstration junction offsets with that distance. Give those junctions clearly synthetic names and IDs. Make reported speed equal distance moved during the tick. Handle coincident station and incident explicitly in mock dispatch/session logic. Do not imply that the straight line is a drivable route or that mock estimates predict real response time.

**Terminal display decision:** Preserve backend telemetry: the arrival tick reports distance traveled in that simulated second, which can be positive. The UI should show `0.0 km/h` after completion as the vehicle's current state; on cancellation/error show no current speed and label the retained sample as historical if displayed elsewhere. No backend engine or API change.

**Responsive decision:** The 320 px and 390 px layouts must keep all three vehicle choices and the start control inside the viewport, including long real station names. Do not hide overflow as a substitute for fixing intrinsic width.

**Source of truth:** `GreenWave_ARCHITECTURE.md` §§3–4, `docs/engineering/domain-invariants.md`, `docs/engineering/frontend-dashboard.md`, the five design specs linked by the sub-plans, and `docs/superpowers/specs/2026-10-21-er-green-wave-corrections-design.md` for existing rolling-motion behavior. User-facing UI copy stays English. The plans follow `AGENTS.md` and `frontend/AGENTS.md`.

**Skill selection:** Read the task-relevant skills under `.agent/skills/` when executing each item. The mock and simulation presentation fixes need `systematic-debugging`, `test-driven-development`, and `verification-before-completion`; browser checks need `playwright-cli`. The phone-width fix also calls for `mobile-native`, `break-ui`, and an `emil-design-eng` UI review. These are focused checks, not permission to expand the five-item scope.

## Audit evidence and limits

- Browser audit used `playwright-cli` in both mock and backend modes; screenshots are ignored under `.tmp/playwright/`. At 390 px, setup width was 518 px and the Police button ended at x=493. A backend enabled run finished in 2m 20s and disabled in 4m 06s for Aleja 29 Listopada 32; stop returned 200 and two-tab supersession displayed its cancellation reason.
- `backend/tests/simulation/test_motion_modes.py::test_arrival_tick_reports_the_distance_actually_driven` establishes why positive speed may accompany `ARRIVED` on the final moving tick. The focused motion suite passed 30 tests during the audit.
- The audit covered selected incidents, modes, and viewports; each sub-plan adds its own regression checks. These observations are not proof that all GIS routes or devices are free of other defects.

## Final closeout

After item 5: reread this table, confirm five `[Completed]` entries and their evidence, run the full frontend gate from `AGENTS.md`, check `git status --short` and the final diff, then report remaining limitations. Keep any new finding outside this scope in a separate record rather than silently expanding these plans.
