# Pre-Start Route Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop showing a fictitious route ID or claiming a planned corridor before a simulation has initialized a route.

**Architecture:** Keep the setup map as a station/incident selection view. Replace the hard-coded badge with endpoint-aware setup copy; continue rendering actual route geometry only from `routeData` in live mode. No map or backend routing change.

**Tech Stack:** React, TypeScript, Vitest, MapLibre, `playwright-cli`.

**Spec:** `docs/superpowers/specs/2026-10-21-prestart-route-badge-design.md`.

## Root cause

The setup branch of `RoutePreview.tsx` always renders `Planned response corridor` and `KRK-ROUTE-0942`, even with no incident. In backend mode, the actual route and estimates exist only after `POST /api/v1/simulation/start`; the preflight panel correctly says `AFTER START`. The badge therefore presents an invented route identity and conflicts with the rest of the screen. The route ID is a literal in the component, not route data.

## Global Constraints

- Do not compute or fabricate a backend route before start. Preserve selected station and incident markers.
- Keep mock and backend setup copy accurate; keep route geometry authority in the adapter/backend.
- No API, generated contract, dependency, or lockfile change. English copy and accessible status text.
- Use TDD and update the master only after fresh verification.
- After each task, report changed files, checks and results, decisions or blockers, and a proposed Conventional Commit subject; continue to the next task unless blocked.

## File map

- `frontend/src/components/dashboard/RoutePreview.tsx`: endpoint-aware setup badge.
- `frontend/src/components/dashboard/RoutePreview.test.tsx` (new): no-incident and selected-endpoint markup.
- `frontend/src/components/__snapshots__/Dashboard.setup.mock.html` and `Dashboard.setup.backend.html`: update initial setup snapshots if markup changes.

## Review Focus

- Initial setup has no route ID or planned-route claim; Task 1 test.
- Selecting an incident still does not imply a computed route; Task 1 test and Task 2 browser check.
- Changing incident updates selection text without a stale route label; Task 1 test and Task 2 browser check.
- Live mode continues to show the real route and leaves setup badge absent; Task 1 test.
- Both mock and backend modes use the same truthful setup status; Task 2 snapshot check.

---

### Task 1: Replace the static route claim

**Files:**
- Modify: `frontend/src/components/dashboard/RoutePreview.tsx`, `frontend/src/components/__snapshots__/Dashboard.setup.mock.html`, `frontend/src/components/__snapshots__/Dashboard.setup.backend.html`
- Create: `frontend/src/components/dashboard/RoutePreview.test.tsx`

**Interfaces:** Preserve `RoutePreview` props. In setup, `origin` and `destination` alone select badge copy; `routeData` remains the only source of actual route geometry in live mode.

- [ ] **Step 1: Write failing component tests.** Render with neither endpoint, then both endpoints, then a changed destination. Assert absence of `KRK-ROUTE-0942` and `Planned response corridor`; assert `Choose an incident` before selection and `Route computed when simulation starts` after selection. Assert the badge is absent in live mode.
- [ ] **Step 2: Verify red.** Run `cd frontend && npm test -- components/dashboard/RoutePreview.test.tsx`; expect the new assertions to fail.
- [ ] **Step 3: Replace the badge literal.** Use the existing `origin`/`destination` props for truthful setup status. Avoid a fabricated ID, estimate, or route line.
- [ ] **Step 4: Refresh the two setup snapshots and verify green.** Inspect the expected badge change, run `cd frontend && npm test -- -u components/dashboard-parts.snapshot.test.tsx`, then run `cd frontend && npm test -- components/dashboard/RoutePreview.test.tsx components/dashboard-parts.snapshot.test.tsx`; expect pass.

### Task 2: Browser verification and closeout

**Files:**
- Modify: `docs/superpowers/plans/2026-10-21-simulation-audit-master.md` status and evidence only after verification.

**Interfaces:** Consumes endpoint-aware badge copy from Task 1; produces browser evidence and the item-5 completion record.

- [ ] **Step 1: Use `playwright-cli` through bash in mock and backend setup.** Capture only under `.tmp/playwright/`; confirm no route ID before selecting an incident, selection status after choosing one, and actual route geometry after start.
- [ ] **Step 2: Run the frontend gate.** `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`; expect exit 0.
- [ ] **Step 3: Review `git diff --check`, `git diff`, and `git status --short`.** Mark item 5 `[Completed]` only with evidence. Propose `fix: label route preview before initialization`; stage explicit paths only if making a local commit.
