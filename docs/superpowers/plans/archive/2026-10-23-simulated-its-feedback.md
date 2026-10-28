# Simulated ITS Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or, if chosen by the human, superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Demonstrate priority request -> simulated controller decision -> reported traffic state -> dashboard, including delayed, rejected and missing feedback.

**Architecture:** A per-run deterministic simulated ITS controller owns reported signals and request decisions. The simulation engine submits requests, consumes controller snapshots, and streams correlated feedback plus self-contained ticks. Backend and browser mock transports preserve the same causal behavior.

**Tech Stack:** Existing Python/FastAPI/Pydantic, pytest, Next.js/React/TypeScript, Vitest and MapLibre; no new dependencies.

**Spec:** [Simulated ITS feedback loop design](../specs/2026-10-23-simulated-its-feedback-design.md).

Status: proposed for human review. This branch contains planning documents only; implementation is a separate action.

## Global Constraints

- Read complete spec, AGENTS.md, docs/superpowers/README.md, relevant engineering docs, architecture and ADRs 0003/0007 before execution. Reconcile existing historical comments against current code.
- Simulation only; all new envelopes retain `is_simulated: true` and `schema_version: "1.0"`.
- No network controller integration, real signal actuation, external services, new dependencies, database, authentication, multi-mission scheduling, or deployment changes.
- Preserve HTTP routes, SSE transport, route choice, station ranking, geographic dataset, English UI, existing simulation modes, and the four intersection states.
- Defaults: normal acknowledgement 1 s, delayed 5 s, timeout 8 s; use simulated seconds. Preserve 40/25/250/15 trigger, eligibility, cascade and recovery values.
- Pydantic is canonical; generated OpenAPI and TypeScript are never hand-edited. New fields have compatible defaults; update strict validators and fixtures together.
- Browser/E2E: load playwright-cli skill, use @playwright/cli through bash; all outputs under .tmp/playwright/its-feedback/; no DOM/a11y dumps. Read bundled Next.js docs before frontend implementation.
- Before editing GreenWave_ARCHITECTURE.md, tell the human. Do not edit AGENTS.md or managed skills.
- Preserve unrelated changes. No branch/push/PR actions beyond authorization; propose milestone commits, use explicit staging paths, and never use git add -A.

## Review Focus

- Acceptance received but route signal still red: no confirmed priority-green label or premature enabled crossing (Tasks 2–4).
- Pending request target passes, or only part of a cascade group passes: no late activation or premature group release (Tasks 2–3).
- Feedback shares a tick with another event or the SSE queue drops it: monotonic deduplication and latest-snapshot recovery (Tasks 3–4).
- Run ends while feedback is delayed: no controller leakage into the next session or duplicate terminal (Tasks 2–3).
- Unsupported signal movements and increased recording size: no fabricated green or silently truncated successful comparison (Tasks 3–5).

## File map

| Area | Create | Modify / inspect |
| --- | --- | --- |
| Contracts | backend/src/greenwave/schemas/its.py | schemas/simulation.py, schemas/__init__.py, simulation/events.py, scripts/export_openapi.py; generated contracts/openapi.json and frontend/src/types/api.generated.ts |
| Controller | backend/src/greenwave/its/models.py, controller.py | its/gateway.py, its/__init__.py, simulation_settings.py; retire record-only gateway use without retaining two authorities |
| Domain integration | backend/src/greenwave/simulation/priority_requests.py | simulation/{assembly,engine,state,corridor,state_machine,phases,motion,telemetry,session}.py, main.py |
| Frontend data | frontend/src/lib/mock-its-controller.ts | lib/{simulation-adapter,simulation-controller,simulation-state,mock-session,mock-simulation-adapter}.ts, lib/transport/{validate,backend-simulation-adapter}.ts, types/telemetry.ts |
| Presentation | frontend/src/components/hud/dispatch/ItsScenarioControl.tsx | components/hud/{DispatchForm,ItsConsole,IntersectionList,RunSummary}.tsx, components/scenario-provider.tsx, lib/diagnostics/{store,observe-adapters}.ts, components/diagnostics/{DataFlowView,EndpointActivity}.tsx; inspect simulation runtime, driver and inspector consumers |
| Comparison | — | lib/comparison/{recording,comparison-controller,replay}.ts and affected fixtures |
| Tests / docs | controller, feedback, UI tests and proposed ADR | Existing backend/tests/{its,simulation,schemas,api}/ tests; adjacent frontend tests; architecture and subsystem READMEs |

Paths in the table are rooted at the repository; brace notation identifies existing related
files, not a request to rewrite every file. Confirm exact consumers with graphify and targeted
rg before each task; keep changes cohesive.

## Milestone 1: Contracts and deterministic controller

### Task 1: Define correlated request and feedback schemas

**Files:** Create `backend/src/greenwave/schemas/its.py`,
`backend/tests/schemas/test_its_feedback_schemas.py`; modify schema exports, simulation schemas,
`backend/src/greenwave/simulation/events.py`, and generated contract outputs.

**Interfaces:** Public `ItsRequestSnapshot`, `ItsFeedbackEvent`, request-status and reason enums;
`SimulationTickEvent.its_requests` / `.its_observed_at_simulated_sec`; `its_scenario` on start
request/response; `ITS_FEEDBACK` in stream union; specific ITS cancellation reasons. Field
names, timing semantics and status/reason combinations are exactly those in the spec.

- [ ] Add schema tests asserting legacy start defaults NOMINAL, legacy ticks default to []/null,
  negative simulated seconds and zero feedback sequence are rejected, `is_simulated: false`
  is rejected, all feedback variants round-trip, wrong status/reason combinations fail, and
  no fifth intersection state is introduced.
- [ ] Run `cd backend && uv run pytest tests/schemas/test_its_feedback_schemas.py -q`; confirm
  failure for missing models/fields before implementation.
- [ ] Implement models and exports, avoiding circular imports; register new non-route models
  in OpenAPI via the existing exporter. Do not alter the outgoing payload contract.
- [ ] Run focused schema and OpenAPI tests, then regenerate with
  `cd backend && uv run python scripts/export_openapi.py` and
  `cd frontend && npm run generate:types`. Inspect generated union/defaults and use them in
  later tasks. Temporary unused new event support is not a completed release.

### Task 2: Implement the separate controller and its lifecycle

**Files:** Create `backend/src/greenwave/its/{models,controller}.py`,
`backend/tests/its/test_controller.py`; modify `its/{gateway,__init__}.py`,
`simulation_settings.py`, and pure phase/state helpers only where needed.

**Interfaces:** Define `ItsRequest`, `ItsObservation`, `ItsControllerUpdate` from the spec.
`SimulatedItsController.submit(request: ItsRequest) -> None`,
`.advance(observation: ItsObservation) -> ItsControllerUpdate`, `.close() -> None`.
Also expose pure `.ordinary_route_color_at(intersection_id: str,
at_simulated_sec: float) -> SignalPhaseColor | None` for exact-time disabled-mode motion.
Expose a typed controller factory accepting route model, settings and scenario, producing
a fresh controller for every run. Controller reports full state and indications, not just ack.

- [ ] Write controller tests with a tiny existing synthetic route: submission at second 10
  stays pending at 10; NOMINAL accepts at 11, DELAYED at 15, REJECTED rejects at 11, and
  NO_FEEDBACK never acknowledges. Acceptance while conflicting lights clear is not yet green.
- [ ] Add tests for duplicate submit, conflicting duplicate contents, phase sequence/yellow
  duration, supported route lights all green before confirmation, missing movements, partial
  group passage, pending passage before ack, expiry at submission+hold, passage exactly at
  expiry, recovery to NORMAL at +15, idempotent close, and no output after close.
- [ ] Run `cd backend && uv run pytest tests/its/test_controller.py -q` and observe missing
  behavior; implement the smallest deterministic controller using existing phase helpers.
  Keep controller targets distinct from reported states and remove competing phase ownership.
- [ ] Add settings boundary tests, including acknowledgement delay >=1 and both delays <8
  at defaults. Run `uv run pytest tests/its tests/simulation/test_phases.py -q` from backend;
  diagnose regressions rather than weakening old invariants.

**Milestone gate:** schema/controller checks pass; summarize affected files and decisions.
Proposed commit: `feat: define simulated ITS feedback contracts and controller`.

## Milestone 2: Feedback drives backend simulation

### Task 3: Integrate requests, controller observations and failure handling

**Files:** Create `backend/src/greenwave/simulation/priority_requests.py` and
`backend/tests/simulation/test_its_feedback.py`; modify engine integration files in the map,
session lifecycle and targeted existing tests/golden fixtures.

**Interfaces:** Introduce `PriorityRequestLedger` with route-bounded state and typed operations
`select(route_model, state, settings) -> tuple[str, ...]`,
`record(request: ItsRequest) -> None`, `apply(feedback: ItsFeedbackEvent) -> bool`, and
`snapshots() -> tuple[ItsRequestSnapshot, ...]`. Selection reuses own-TTI/one-hop cascade rules
without mutating reported intersection state. Persist the ledger/controller per engine;
include immutable controller snapshots in engine state where motion/telemetry consume them.

- [ ] Write an integration regression test with a scripted controller: requesting at TTI<=40
  emits dispatch while intersection remains NORMAL; accepted feedback enters CLEARING;
  withholding green beyond TTI<=25 does not produce reported PRIORITY_GREEN or an enabled
  red-light crossing; a later reported green is projected exactly into the tick.
- [ ] Add tests for same-tick own/cascade tie, one dispatch per tick, one request per target,
  stable message IDs, duplicate/older/wrong-run/unknown-target/invalid-transition feedback,
  exact-deadline ack-before-timeout, rejection/timeout/expiry cancellation reasons, final
  diagnostic tick before terminal, and no completion on fault. Invalid feedback cannot
  refresh deadline. Test partial pending passage and active group release independently.
- [ ] Run `cd backend && uv run pytest tests/simulation/test_its_feedback.py -q`; observe
  failing causal assertions. Implement the step order in the spec and session-owned cleanup.
  Replace application-wide record-only gateway injection with the per-run factory.
- [ ] Extend session/API tests: stop/supersede/server-error closes controller once, no delayed
  event touches a new run, zero-subscriber execution continues, one terminal only, and latest
  tick after reconnect includes all request statuses even when feedback frames were dropped.
- [ ] Compare 1x/10x domain traces with wall-clock fields removed. Disabled-mode motion and
  routes retain regression coverage and emit no ITS requests. Add a phase-boundary regression
  proving disabled motion queries the ordinary programme at the fractional stop-line arrival
  time, while enabled motion uses the previous confirmed snapshot. Verify standalone disabled
  scenario normalization and nominal comparison policy. Golden changes require explained
  timing differences; estimates stay clearly labelled model estimates.
- [ ] Run `cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`.

**Milestone gate:** full backend checks pass and causal behavior is evidenced.
Proposed commit: `feat: drive simulated traffic state from ITS feedback`.

## Milestone 3: Feedback survives transport and is visible

### Task 4: Wire validated feedback, offline mock and comparison recordings

**Files:** Create `frontend/src/lib/mock-its-controller.ts` and its test; modify frontend data
and comparison files in the map with their adjacent tests and transport fixtures.

**Interfaces:** Add `SimulationStreamSubscriber.onItsFeedback(event: ItsFeedbackEvent): void`
and reducer action `{type: "ITS_FEEDBACK", event}`. Thin generated aliases only. Reducer
request state is reconciled from every valid tick's full snapshot. Feedback deduplication is
independent of `lastTick` and `seenMessageIds`.

- [ ] Test validators against valid feedback and malformed envelopes/status-reason pairs,
  unknown targets, wrong simulation IDs, duplicate/older feedback sequence, and feedback
  sharing a tick with dispatch/telemetry. A snapshot supersedes stale request UI without
  requiring replay; a later old feedback cannot regress the snapshot's `last_feedback_sequence`.
  Legacy []/null means unavailable, never accepted.
- [ ] Run `cd frontend && npm test -- src/lib/transport/validate.test.ts src/lib/transport/backend-simulation-adapter.test.ts src/lib/simulation-state.test.ts`; verify new tests fail.
- [ ] Implement typed subscriber/controller/reducer handling, actual JSON diagnostics capture,
  and separate request/feedback observation types within existing history/body budgets.
- [ ] Build a small pure mock controller using simulated seconds; test matching scenario
  lifecycle and rejection/timeout cancellation. Refactor mock-session so desired priority
  cannot directly set confirmed green. Update mock subscribers/fixtures and synthetic labels.
- [ ] Extend recordings with `feedbacks: ItsFeedbackEvent[]` and
  `feedback(event: ItsFeedbackEvent): void`; count bytes, deduplicate sequences, and preserve
  controller snapshots during seek/replay. Failed scenarios produce incomplete comparison,
  never a successful pair. Test enlarged payloads still enforce 32 MiB/10,000 ticks.
- [ ] Run targeted transport, simulation-controller/state, mock and comparison tests; then
  `npm run typecheck`. Fix all subscriber consumers; do not hide new event cases with casts.

### Task 5: Show request status separately from reported signals

**Files:** Create scenario control and tests; modify HUD, scenario provider, diagnostics,
relevant driver/inspector consumers and snapshot tests listed in the map.

**Interfaces:** Scenario control reads/writes generated `its_scenario` via the existing shared
scenario provider. ITS console and inspector read reconciled request snapshots plus reported
intersection/signal state; they do not infer feedback from dispatch rows.

- [ ] Read relevant bundled Next.js guidance and UI skill before implementation. Add failing
  render/interaction tests for REQUESTED+NORMAL, ACCEPTED+CLEARING, reported green, rejection,
  timeout, expiry, missing phases and legacy unavailable state. Assert textual distinctions
  and retained last-report wording after termination.
- [ ] Test the scenario selector persists through navigation, disabled mode normalizes it,
  comparison pins NOMINAL, and phone dispatch can reach it. Existing driver view receives
  the same report and failure cause without creating another session/subscription.
- [ ] Implement the selector, console/inspector labels and failure copy; preserve theme,
  accessible names, focus and bounded inspector layout. Show model-estimate wording where
  changed controller timing makes equality with measured run duration misleading.
- [ ] Update DataFlowView to show request -> simulated controller -> acknowledgement/report
  -> validated state -> map. JSON inspection uses captured backend bodies or explicitly
  synthetic mock values; never describe in-process events as observed HTTP calls.
- [ ] Run `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`.

**Milestone gate:** full frontend checks pass; verify both transports and recording limits.
Proposed commit: `feat: expose simulated ITS acknowledgements and reported traffic state`.

## Milestone 4: Acceptance evidence and architecture documentation

### Task 6: Validate the complete flow and document the boundary

**Files:** Add browser evidence under `.tmp/playwright/its-feedback/` (ignored), a proposed
ADR using the next available number, and update architecture/backend/frontend READMEs.

- [ ] Tell the human before editing GreenWave_ARCHITECTURE.md. Document request identity,
  timing, controller ownership, feedback ordering/snapshot semantics, fault policy and
  explicit departures from ADR 0003. Do not mark the new ADR Accepted without human review.
- [ ] Use playwright-cli against backend transport with prepared matching processed data:
  NOMINAL, DELAYED, REJECTED, NO_FEEDBACK; confirm pending then acceptance then reported
  state, explanatory failures, and no fabricated green. Use deterministic test fixtures for
  difficult phase/expiry boundaries rather than adding production debug endpoints.
- [ ] Verify start near a stop line, stop while pending, supersede, SSE disconnect/reconnect,
  latest-snapshot restoration, all six routes, successful nominal comparison/seek, driver
  presentation, and phone viewport controls. Repeat causal scenarios in mock transport.
  Physical-phone confirmation remains distinct from browser emulation.
- [ ] Run complete backend/frontend checks above and contract regeneration; second generation
  must leave generated files unchanged. Refresh graph after structural changes, then inspect
  final diff for unrelated work, new dependencies, outbound ITS calls and safety claims.
- [ ] Review acceptance criteria 1–8 individually, link test/browser evidence, and record any
  blocker. Do not claim production ITS compatibility or guaranteed travel-time savings.

**Milestone gate:** summarize changes, verification and deviations; propose
`docs: document simulated ITS request and feedback lifecycle`.

## Execution handoff

Review the proposed spec and plan before implementation. Recommended execution: native,
milestone by milestone, because controller ownership and shared contracts are tightly coupled.
The planning branch intentionally contains no application changes or real ITS integration.
