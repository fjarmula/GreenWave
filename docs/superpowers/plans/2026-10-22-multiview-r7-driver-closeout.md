# R7 — Driver Presentation and Programme Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development if chosen by the human). Steps use checkbox syntax. Master: [multi-view programme](2026-10-22-multiview-master.md). Requires R1–R6.

**Goal:** Deliver a phone-oriented enabled simulation view and verify the entire multi-route experience.

**Architecture:** Driver reuses R1 state/actions and R4 map/camera; it only changes presentation. Finish with cross-route acceptance, focused documentation updates and one evidence-led design review.

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

- LAN HTTP without randomUUID must still start a contract-valid simulation (Task 1).
- Phone chrome, safe areas, landscape and keyboard must not hide primary actions (Task 1).
- Disabled active runs must not be presented as enabled in driver (Task 1).
- Reconnect/failed Stop/terminal summaries must remain intelligible in compact UI (Task 1).
- Full keyboard/zoom/reduced-motion journeys must pass across all routes, not only individual components (Task 2).

---

## File map and interfaces

- Create `frontend/src/components/driver/DriverWorkspace.tsx` and `DriverStatus.tsx`; modify the selected driver route, `app/layout.tsx` viewport metadata and `app/globals.css` as needed.
- Consume R1 scenario/run/actions, R3 Focus control/details primitives and R4 camera. Reuse telemetry formatting and vehicle-type copy; add no driver-specific simulation engine or transport.
- Tests: `frontend/src/components/driver/driver-status.test.tsx`, existing vehicle-speed/summary/copy tests and simulation-id tests.
- Documentation: targeted `frontend/README.md` and root `README.md` route/demo guidance where present; architecture amendment is coordinated with R2. Update this programme's master/spec to actual route/interface choices, preserving decision history.

## Task 1: Driver workspace and phone platform behavior

- [ ] RED: static driver tests assert enabled provenance, vehicle-specific status, stale/error text, running Stop, failed-stop retry and terminal summary. Mode policy tests assert driver never relabels an active disabled run and requires explicit replacement.
- [ ] Run `cd frontend && npm test -- src/components/driver/driver-status.test.tsx`; include the R1 ID helper test and affected copy tests; observe RED for new behavior.
- [ ] GREEN: map-first driver with compact readable status and Details; keep secondary lists in an accessible sheet. Use 100dvh with fallback, safe-area insets, coarse-pointer form font >=16px, primary touch targets >=44px and capability-gated hover. Preserve map pinch/pan and browser zoom.
- [ ] Rerun focused tests. Browser at 320x720, 390x844 and 844x390, light/dark and reduced motion: setup/start/detail-follow/manual override/Stop/failed Stop/retry/completion. Simulate unavailable randomUUID with an init script and verify Start works.
- [ ] Test with the software keyboard on physical iOS/Android if available. Report browser-emulated checks separately; if hardware is unavailable, record the exact outstanding safe-area/chrome/keyboard/touch checks without claiming they passed. Evidence under `.tmp/playwright/multiview/r7/`.

## Task 2: Cross-route acceptance and design review

- [ ] Run complete journeys with mock and real backend at 1440x1000, 1280x720, 390x844 and 320x720: menu → enabled → start → diagnostics → same run → driver → Stop → retained summary → standard setup → explicit start → finish → comparison capture/replay. Verify no unexpected network starts/stops or duplicate subscriptions.
- [ ] Direct-load each final route; Back/Forward/reload, missing scenario, stale/lost stream, invalid start response, cancelled/superseded run, rejected recording and unequal arrival all have useful UI and correct mode/provenance. Use targeted request stubs only for failures that cannot be produced reliably otherwise.
- [ ] Check viewport document overflow, Focus enter/exit/nested Escape and focus return, all action tab stops, 200% text/zoom, contrast in both themes, status without color, and reduced-motion camera/panel behavior. Preserve attribution in every map pane.
- [ ] Review with emil-design-eng; present actionable Before/After/Why findings in its required table format. Adjust routine craft choices autonomously; raise material structural changes before implementing them. No unrelated visual rewrite.
- [ ] Update demo/route documentation and master completion evidence; do not mark older audit milestones complete unless their full original criteria were independently verified and the human authorized updating that record.
- [ ] Run the full frontend gate once after the final changes, `git diff --check`, final focused diff review and `graphify update .`. Backend tests are not represented as run unless actually executed; backend product code remains unchanged.
- [ ] Confirm every spec acceptance item maps to evidence; report any hardware-only verification outstanding explicitly. No deployment, branch, push or PR operations.

## Milestone closeout

- [x] Run the full frontend gate listed in the master; require exit 0 or explicitly record any baseline blocker without claiming completion.
- [x] Run `git diff --check`; inspect snapshots and focused diff for unrelated changes.
- [x] Record acceptance evidence, actual file/interface choices and deviations in the master. Propose its listed Conventional Commit; do not perform branch/push/PR operations.


Implementation closeout: see the master completion record for the actual interfaces, tests, browser artifacts and verification limits. The original task checklist is preserved as the detailed planning baseline; programme status is maintained only in the master.
