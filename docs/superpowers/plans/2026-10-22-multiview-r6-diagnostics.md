# R6 — Endpoint Flow and Observed Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development if chosen by the human). Steps use checkbox syntax. Master: [multi-view programme](2026-10-22-multiview-master.md). Requires R1/R2/R5.

**Goal:** Explain endpoint/state flow using bounded, factual observations without altering simulation behavior.

**Architecture:** An in-memory external diagnostic store receives allowlisted adapter-boundary observations and nonblocking stream summaries. The diagnostic view separates a static accessible flow diagram from activity observed in this browser session.

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

- Raw address queries, coordinates, body contents and uncontrolled errors must not enter the store (Task 1).
- High-frequency ticks must not grow memory or delay subscribers (Task 1).
- An unused endpoint must remain Not observed rather than appearing healthy (Task 2).
- Mock execution must never appear as a successful real HTTP request (Task 2).
- ITS dispatch must be represented as internal simulated activity, not actuation (Task 2).

---

## File map and interfaces

- Create `frontend/src/lib/diagnostics/store.ts`, `observe-adapters.ts` and tests. Proposed entry fields: operation enum, transport enum, phase/outcome enum, monotonic timestamp/duration where available, optional tick and bounded count. No arbitrary string payload/error fields.
- Wrap existing simulation and dispatch adapter interfaces at composition points; include dataset-quality observation without global network interception. Preserve cancellation signals, returned promises, callback ordering and unsubscribe semantics.
- Create `frontend/src/components/diagnostics/DataFlowView.tsx`, `EndpointActivity.tsx` and markup tests. Reuse `hud/DataQualityPanel.tsx`; wire the R2 diagnostic route.
- Proposed store API: `record(entry): void`, `getSnapshot()`, `subscribe(listener)`, `clear(): void`; ring limit 200. The agent may use a discriminated union for operation-specific fields while retaining the allowlist.

## Task 1: Bounded observer without semantic changes

- [ ] RED: store tests append 201 entries and assert length 200 and oldest eviction; input sentinels for address/query/body/coordinate/error text never appear in serialized snapshots; monotonic duration uses injected time. Coalesced ticks preserve newest tick/count and terminal/failure visibility.
- [ ] RED: observer tests prove start/stop/list/rank/geocode values and errors propagate unchanged, abort reaches the wrapped adapter, callback order is unchanged, unsubscribe invokes cleanup once and diagnostic listener errors cannot break delivery.
- [ ] Run `cd frontend && npm test -- src/lib/diagnostics/store.test.ts src/lib/diagnostics/observe-adapters.test.ts`; observe RED.
- [ ] GREEN: implement explicit allowlisted constructors and bounded recording. Reuse the selected adapters; do not add health polling, global monkey-patches or requests solely for visualization.
- [ ] Rerun focused tests plus existing adapter/controller tests to guard behavior.

## Task 2: Accessible flow and factual activity

- [ ] RED: static markup tests assert all flow stages are named in readable text; untouched endpoints say Not observed; mock operations say synthetic; internal ITS dispatch is labelled simulated; failed outcomes include text/icon cues and no invented backend latency.
- [ ] Run `cd frontend && npm test -- src/components/diagnostics/data-flow.test.tsx`; observe RED, implement the view and rerun GREEN.
- [ ] Render a compact diagram with CSS/SVG and a readable ordered explanation, not a new graph library. Agent chooses responsive arrangement. Only actual browser duration is displayed; dataset quality keeps existing mock/backend provenance.
- [ ] Browser: inspect before requests, then station/rank/start/SSE/stop/quality activity and mock limitations; perform a failed request and reconnect. Navigate away/back and verify bounded history remains and the live run/subscription continues. Check desktop/phone themes and keyboard access.
- [ ] Evidence under `.tmp/playwright/multiview/r6/`; inspect diagnostic snapshots for forbidden sensitive fields.

## Milestone closeout

- [ ] Run the full frontend gate listed in the master; require exit 0 or explicitly record any baseline blocker without claiming completion.
- [ ] Run `git diff --check`; inspect snapshots and focused diff for unrelated changes.
- [ ] Record acceptance evidence, actual file/interface choices and deviations in the master. Propose its listed Conventional Commit; do not perform branch/push/PR operations.
