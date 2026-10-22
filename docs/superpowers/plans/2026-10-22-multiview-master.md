# Multi-view Simulation Workspace Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans; use subagent-driven-development only if that execution approach is explicitly chosen. Steps use checkbox syntax. Do not start product implementation until the human approves execution of this package.

**Goal:** Deliver a polished, accessible multi-route simulation app with persistent state, Focus Mode, smart camera, recorded comparison, diagnostics and driver presentation.

**Architecture:** Keep Next.js App Router and the existing reducer/controllers/adapters. Extract a persistent runtime and scenario owner; views consume typed snapshots. Comparison records sequential runs and replays them with a common simulated clock, preserving the single-active-run backend.

**Tech Stack:** Existing Next.js 16.4, React 19, TypeScript, Tailwind, Base UI/shadcn, MapLibre, Vitest and @playwright/cli; Node 22+.

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

- Navigation during STARTING/stop failure must preserve ownership and ignore stale responses (R1/R2).
- Short screens, browser zoom and focus changes must not clip essential actions or reset the map (R3/R7).
- Detail zoom, manual pan and stale telemetry must not create competing camera writers (R4).
- Missing SSE ticks, cancellation and unequal arrival times must not produce a misleading complete comparison (R5).
- Diagnostics must preserve stream behavior and exclude sensitive or fabricated observations (R6).

---

## Authority and execution order

Read AGENTS.md, frontend/AGENTS.md, relevant engineering docs, architecture, accepted ADRs, this spec and the complete selected subplan. Read installed Next guides before code; use Context7/project documentation skills for other library APIs. Load TDD, verification-before-completion and relevant design skills. Browser work requires playwright-cli; unexpected failures require systematic-debugging.

Route names in the spec are recommendations. At R2, record the final route map here before implementation; routine renaming does not require a checkpoint. Product implementation remains pending. This documentation task does not change existing architecture or audit records.

Execute R1 → R2 → R3 → R4 → R5 → R6 → R7, one milestone at a time. Continue automatically within an approved implementation package unless a material conflict arises. After each milestone report changed paths, decisions/deviations, fresh checks and a proposed Conventional Commit. Local commits are optional after staged-diff review; all Git restrictions in AGENTS.md apply.

## Status and update rule

Use `[Pending]`, `[In Progress]`, `[Completed]` with checkboxes. Mark complete only after acceptance and fresh checks. Add evidence to Completion records; leave a blocked or partial milestone open. The ordered list below is the only status ledger for this programme. Subplan checkboxes track individual actions.

- [ ] **[Pending] R1 — Persistent runtime and scenario.** [Subplan](2026-10-22-multiview-r1-runtime.md). Requires none. Proposed commit: `refactor: persist simulation ownership across views`.
- [ ] **[Pending] R2 — Routes and navigation.** [Subplan](2026-10-22-multiview-r2-routes.md). Requires R1. Proposed commit: `feat: add simulation routes and mode selection`.
- [ ] **[Pending] R3 — Viewport shell and Focus Mode.** [Subplan](2026-10-22-multiview-r3-workspace.md). Requires R2. Proposed commit: `feat: add map-first workspace and focus mode`.
- [ ] **[Pending] R4 — Camera policy.** [Subplan](2026-10-22-multiview-r4-camera.md). Requires R3. Proposed commit: `feat: follow the simulated vehicle at detail zoom`.
- [ ] **[Pending] R5 — Recorded comparison.** [Subplan](2026-10-22-multiview-r5-comparison.md). Requires R1–R4. Proposed commit: `feat: compare recorded simulation modes`.
- [ ] **[Pending] R6 — Endpoint diagnostics.** [Subplan](2026-10-22-multiview-r6-diagnostics.md). Requires R1/R2/R5. Proposed commit: `feat: visualize observed simulation data flow`.
- [ ] **[Pending] R7 — Driver and acceptance.** [Subplan](2026-10-22-multiview-r7-driver-closeout.md). Requires R1–R6. Proposed commit: `feat: add mobile driver simulation view`.

## File and responsibility map

- `frontend/src/app/`: thin pages, shared provider composition, shell styling and viewport metadata.
- `frontend/src/components/simulation-provider.tsx`, proposed `simulation-runtime.tsx` and `scenario-provider.tsx`: shared lifecycle/actions and draft scenario.
- `frontend/src/components/workspace/`: shared simulation layout, menu/navigation and focus/inspector presentation.
- `frontend/src/components/map/`: explicit render inputs, map lifecycle and one coordinated camera policy.
- `frontend/src/lib/comparison/`, `frontend/src/components/comparison/`: recording integrity, replay clock and comparison presentation.
- `frontend/src/lib/diagnostics/`, `frontend/src/components/diagnostics/`: bounded allowlisted observations and endpoint flow.
- `frontend/src/components/driver/`: phone presentation of the same enabled runtime.
- Existing `hud/`, reducer/controllers/adapters and tests are reused, not copied into route-specific forks.

## Existing audit overlap and conflicts

The 2026-10-22 repository audit has M1/M2 completed in its ledger. Preserve the implemented Stop/summary semantics. Its M3 settings/previous-result and M6 map stability overlap R1/R3/R4: inspect current code at execution time, reuse completed work and add missing coverage only. M7's secure-context-safe simulation-id helper is needed for R7 LAN acceptance; reuse it if present, otherwise implement that narrowly scoped helper under R1. M8 HUD correctness requirements remain regressions to preserve where implemented, not blanket scope for unrelated fixes.

Backend M4 server errors and M5 retention/idempotency remain owned by their audit subplans. Do not implement them here or assume they exist. Treat currently supported terminal reasons as canonical and retain forward changes if already merged. Failed recording receives the existing timeout/error behavior; this programme adds no cancel-reason schema values.

Architecture §6.12 currently excludes side-by-side comparison. After implementation approval and before editing that file, notify the human, then make a focused documentation amendment describing sequential capture/replay and six destinations. Do not rewrite the old accepted ADR or silently introduce concurrent sessions. Reconcile any newly merged audit changes before edits; never switch branches or modify another worker's files implicitly.

## Verification protocol

Each behavior task: write deterministic failing tests → run focused command and observe RED → implement minimal change → rerun GREEN. Existing node-only Vitest is sufficient for pure controllers, map fakes and static markup; use browser checks for actual focus/click/lifecycle behavior rather than adding a DOM dependency. Never accept snapshot changes without inspection.

After each milestone run the frontend gate with Node 22+: `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`. Run `git diff --check` and review focused changes. Backend gates are required if backend code changes are separately authorized; no backend modification is planned here. Baseline failures are recorded, not concealed or fixed by unrelated churn.

Use mock and real backend for route/start/stop/navigation/focus/camera/comparison checks. Prefer deterministic existing signal-bearing fixtures; record actual chosen scenario, viewport, transport, ticks and terminal evidence. Browser scripts/screenshots/traces all stay under `.tmp/playwright/multiview/rN/`; no DOM/a11y dumps. Distinguish browser API measurements from hardware verification. Run `graphify update .` after structural milestones R2, R5 and final closeout; generated graph artifacts stay local per ADR 0004.

## Final route map

Pending R2 selection. Suggested: `/`, `/simulation/green-wave`, `/simulation/standard`, `/compare`, `/diagnostics`, `/driver`.

## Completion records

No product implementation or runtime checks performed as part of planning. Add dated R1–R7 evidence here: commands, exit/results, browser artifacts, affected files, design choices, deviations and unresolved hardware checks.

## Definition of done

- All six destinations work via direct URL and client navigation.
- Runtime and scenario ownership survive navigation without implicit start/stop or mode relabelling.
- Fixed-height workspaces, accessible Focus Mode and correct detail-zoom follow pass browser acceptance.
- Same-scenario comparison is complete, synchronized and visibly recorded; gaps/failures cannot masquerade as results.
- Diagnostics are bounded, factual and privacy-preserving; driver is usable at phone widths with visible stale/Stop states.
- Relevant documentation, tests and graph navigation match the implementation; seven completion records contain fresh evidence.
- Final diff contains no unrelated edits, generated-contract drift, dependency/lockfile changes or unapproved Git operations.
