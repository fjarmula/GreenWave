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

Route names in the spec are recommendations. At R2, record the final route map here before implementation; routine renaming does not require a checkpoint. Execution was authorized on 2026-10-22. The focused architecture amendment records these six destinations and sequential capture/replay; historical audit records remain unchanged.

Execute R1 → R2 → R3 → R4 → R5 → R6 → R7, one milestone at a time. Continue automatically within an approved implementation package unless a material conflict arises. After each milestone report changed paths, decisions/deviations, fresh checks and a proposed Conventional Commit. Local commits are optional after staged-diff review; all Git restrictions in AGENTS.md apply.

## Status and update rule

Use `[Pending]`, `[In Progress]`, `[Completed]` with checkboxes. Mark complete only after acceptance and fresh checks. Add evidence to Completion records; leave a blocked or partial milestone open. The ordered list below is the only status ledger for this programme. Subplan checkboxes track individual actions.

- [x] **[Completed] R1 — Persistent runtime and scenario.** [Subplan](2026-10-22-multiview-r1-runtime.md). Requires none. Proposed commit: `refactor: persist simulation ownership across views`.
- [x] **[Completed] R2 — Routes and navigation.** [Subplan](2026-10-22-multiview-r2-routes.md). Requires R1. Proposed commit: `feat: add simulation routes and mode selection`.
- [x] **[Completed] R3 — Viewport shell and Focus Mode.** [Subplan](2026-10-22-multiview-r3-workspace.md). Requires R2. Proposed commit: `feat: add map-first workspace and focus mode`.
- [x] **[Completed] R4 — Camera policy.** [Subplan](2026-10-22-multiview-r4-camera.md). Requires R3. Proposed commit: `feat: follow the simulated vehicle at detail zoom`.
- [x] **[Completed] R5 — Recorded comparison.** [Subplan](2026-10-22-multiview-r5-comparison.md). Requires R1–R4. Proposed commit: `feat: compare recorded simulation modes`.
- [x] **[Completed] R6 — Endpoint diagnostics.** [Subplan](2026-10-22-multiview-r6-diagnostics.md). Requires R1/R2/R5. Proposed commit: `feat: visualize observed simulation data flow`.
- [x] **[Completed] R7 — Driver and acceptance.** [Subplan](2026-10-22-multiview-r7-driver-closeout.md). Requires R1–R6. Proposed commit: `feat: add mobile driver simulation view`.

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

Selected at R2: `/`, `/simulation/green-wave`, `/simulation/standard`, `/compare`, `/diagnostics`, `/driver`.

## Completion records

### Baseline — 2026-10-22

Clean branch `feature/multiview-simulation-workspace` at `f5f2f2f`; Node v24.18.1. Full frontend gate passed (488 tests; build exit 0), log `.tmp/multiview/baseline.log`. Audit M3–M8 implementation is already present and is reused; no backend work is needed.

### R1 — implementation in progress

Persistent `SimulationRuntime` owns the stream hook; consumers now read actions only. `ScenarioProvider` owns dispatch/stations/settings, immutable captured labels and retained results. Existing audit helpers remain canonical. Cleanup idempotency regression observed RED (two unsubscribe calls), then GREEN; focused scenario/controller/state/start/previous-result/id checks: 59 passed. Root snapshot tests use the production provider composition; existing markup remains unchanged. Navigation browser acceptance will run with R2 routes; R1 is not marked complete before that evidence.

## Definition of done

- All six destinations work via direct URL and client navigation.
- Runtime and scenario ownership survive navigation without implicit start/stop or mode relabelling.
- Fixed-height workspaces, accessible Focus Mode and correct detail-zoom follow pass browser acceptance.
- Same-scenario comparison is complete, synchronized and visibly recorded; gaps/failures cannot masquerade as results.
- Diagnostics are bounded, factual and privacy-preserving; driver is usable at phone widths with visible stale/Stop states.
- Relevant documentation, tests and graph navigation match the implementation; seven completion records contain fresh evidence.
- Final diff contains no unrelated edits, generated-contract drift, dependency/lockfile changes or unapproved Git operations.


### R2 — routes and navigation evidence

Six selected routes built successfully. New route/policy/navigation tests: 3 passed; full frontend gate exit 0 (`.tmp/multiview/r2-gate.log`); graphify refresh exit 0. Architecture §6.12 amendment announced before editing; no backend lifecycle or contract changes. Mock browser evidence `.tmp/playwright/multiview/r2/result.log`: navigation preserved run id and advancing telemetry, opposite mode required replacement, Stop and retained draft passed. Real-transport evidence remains open. Proposed commit: `feat: add simulation routes and mode selection`.

### R3 — viewport and Focus evidence

Shell/layout tests: 6 passed; fresh full gate recorded with integrated R4 (`.tmp/multiview/r4-gate.log`, 503 tests). Mock browser `.tmp/playwright/multiview/r3/result.log` verifies no document overflow at 1440×1000, 1280×720, 390×844, 320×720 and 844×390; Focus hides navigation, Escape restores trigger focus; one map instance survives setup/live/focus/inspector/terminal/setup. The phone inspector is a bounded nonmodal details region (keyboard access preserved); 200% and hardware checks remain open. Proposed commit: `feat: add map-first workspace and focus mode`.

### R4 — camera evidence

Policy/fake-map/marker/fit tests: 16 passed; full frontend gate exit 0 (`.tmp/multiview/r4-gate.log`). Context7 confirmed MapLibre originalEvent semantics. Follow enters above 16.5, exits below 16.0; pan suspends, programmatic events do not. Follow uses marker callbacks and immediate camera updates; fit is 200 ms, reduced motion 0. Mock browser manual pan/resume/show-route passed (`r3/result.log`, screenshot `r4/follow.png`). Real transport/stale acceptance remains open. Proposed commit: `feat: follow the simulated vehicle at detail zoom`.

### R5 — capture/replay evidence

Sequential controller, memory/integrity and replay tests added test first. Full frontend gate exit 0 (`.tmp/multiview/r5-gate.log`); graphify refreshed (`r5-graph.log`). Mock browser complete pair: enabled 19 ticks, disabled 8 ticks, each terminal matches final tick; 73,040 serialized bytes. Seek/play/pause/restart and phone mode toggle preserve common cursor (`.tmp/playwright/multiview/r5/result.log`). Coverage uses event.tick; KPI travel time freezes at arrival during recovery in current canonical code. Regression proved this RED→GREEN; UI distinguishes travel-time delta, observed arrival tick and recovery-completion tick. Limits remain 10,000 frames/mode and 32 MiB pair. Real recording and failure-stub evidence remain open. Proposed commit: `feat: compare recorded simulation modes`.

### R6 — diagnostics implementation evidence

Bounded ring, allowlisted observer, callback/abort/error preservation and factual static flow tests RED→GREEN (3). Composition wraps selected adapters without global interception or extra polling. Dataset quality remains on-demand. Mock is labelled synthetic; ITS is internal simulated activity. Full gate and browser evidence remain open. Proposed commit: `feat: visualize observed simulation data flow`.

### R7 — driver implementation evidence

Driver reuses enabled workspace, runtime and camera; static stale/vehicle/failed-Stop/mode tests plus ID tests: 6 passed. Safe-area viewport metadata, coarse-pointer input size and touch controls applied. Integrated gate `.tmp/multiview/r7-gate.log` passes; browser/acceptance and final review remain open. No physical device is connected: iOS/Android chrome, safe areas, software keyboard and touch behavior are explicitly unverified. Proposed commit: `feat: add mobile driver simulation view`.


### Final closeout — 2026-10-22

All R1–R7 software deliverables are implemented on the existing requested branch. No local commit, push, PR, dependency/lockfile, backend lifecycle or public-contract change was made. Implementation is left reviewable in the working tree.

Final frontend gate: `npm run lint && npm run typecheck && npm run format:check && npm test && npm run build` — **exit 0**, **67 files / 526 tests passed**, all six destinations generated. Evidence: `.tmp/multiview/final-gate.log`. `git diff --check` passes. `graphify update .` passes (`.tmp/multiview/final-graph.log`); graph artifacts remain local. Backend product code was unchanged; no backend test gate is represented as run.

R1/R2 acceptance: mock and backend navigation/Stop/draft checks passed (`r2/result.log`, `r2/backend-result.log`). Direct entry to all six destinations, Back/Forward and reload made zero lifecycle POSTs (`r7/matrix-result.log`). Route-selected request mode and immutable labels have deterministic coverage. Explicit replacement was exercised against the real API with enabled and disabled starts and corresponding Stops; the CLI pauses its transcript at native confirm dialogs (`r2/replacement-result.log`, backend request log), so this journey is also backed by policy/controller tests rather than claiming an uninterrupted script transcript.

R3/R4 acceptance: five viewports have no document overflow; Focus restores trigger focus; nested dialog Escape is respected; the Start action is reachable at 200% text. Mock and real map identity/follow/manual-pan/resume/show-route checks pass (`r3/result.log`, `r4/backend-result.log`, `r4/backend-1x-result.log`, `r7/matrix-result.log`). Real checks cover 1× and 10×. Stale/terminal callback freezing and listener/frame cleanup have deterministic coverage. UI transitions preserve reduced motion.

R5 acceptance: mock pair 19/8 ticks, real signal-bearing pair 249/499 ticks; every mode includes tick 1 through its terminal. Real pair retained 3,881,500 event bytes before the final conservative wrapper allowance. Observed capture wall time **75,632.5 ms**, with stream resource durations **25,106.1 / 50,489.3 ms** (`r5/timing.log`). This is browser timing, not server execution latency. Playback, pause, seek, restart and phone toggle checks pass (`r5/result.log`, `r5/backend-result.log`). Pending-start cancellation, no second start, exclusive operation ownership, dropped-tick rejection and cleared buffers pass in-browser (`r5/failures-result.log`). Exact frame/byte boundaries and serialized wrapper accounting pass in node tests. A browser start-response stub of 36,001,914 bytes was rejected at the 32 MiB cap with buffers cleared (`r5/overflow-result.log`). One pair is retained; replacing/rejecting a pair releases discarded data.

R6 acceptance: mock/synthetic provenance and untouched endpoint copy have static coverage; bounded history, privacy allowlist, callback/abort/error identity and diagnostic-listener isolation pass deterministic tests. Real browser observes station/ranking/start/SSE/Stop failure/retry and on-demand dataset quality (`r7/driver-result.log`, `r6/backend-diagnostics.png`). No global network monkey-patches or health polling were added. ITS remains an internal simulated gateway event.

R7 acceptance: mobile/coarse-pointer browser checks at 320×720, 390×844 and 844×390 passed, including safe fallback id, continuing ticks after a failed Stop, and successful Retry Stop (`r7/driver-result.log`). Manual dark-theme chrome mismatch was reproduced and fixed (`r7/theme-red.log` → `r7/theme-green.log`). Viewport metadata allows zoom; CSS applies safe-area padding, dynamic height, 16px coarse-pointer inputs and 44px primary controls. **Physical iOS/Android browser chrome, safe-area insets, keyboard resizing/input zoom and touch feel remain unverified because no device was available.** No claim of hardware verification is made.

Design review (author self-review; no independent reviewer):

| Before | After | Why |
| --- | --- | --- |
| Tall mobile panel stacks | Viewport grid with one bounded inspector | Keep map and actions reachable |
| Route-owned subscription | Root runtime and shared scenario | Navigation preserves ownership |
| Dense live overlays | One inspector and compact driver status | Reduce competing information |
| Tiny uppercase workspace labels | Readable sentence-case labels | Improve phone scanning |
| Browser chrome followed OS only | Chrome follows resolved manual theme | Keep theme presentation coherent |
| Ambiguous comparison totals | Final travel-time delta plus distinct arrival/recovery ticks | Avoid misleading result interpretation |

Rulings/deviations: use the requested branch in place and implement inline, as directly authorized; phone Details uses a bounded nonmodal inspector while retaining the map-first/single-inspector structure; coverage uses event ticks because canonical KPI travel time freezes at arrival; replay updates at 100 ms and camera follows the existing marker callback without a second frame loop; the byte cap includes a conservative 256-byte wrapper allowance per mode plus event separators. No dependency, backend or contract deviation was needed. Native-dialog browser transcript and physical-device limits are recorded above. There are no deferred material product defects from self-review.

### Follow-up requested from visual review — 2026-10-22

The telemetry card used viewport breakpoints inside a narrow inspector, allowing status and metric text to overlap. The comparison route also lacked its own incident-selection setup. This follow-up reopens the presentation acceptance for R3/R5: make telemetry respond to card width; reuse the dispatch form and map directly on `/compare`; prepare the same scenario sequentially under the existing single-run contract, then automatically play both recordings side by side using one clock and shared controls. The preparation/replay distinction remains explicit. No backend lifecycle, dependency or contract expansion is planned.

Plan: reproduce the narrow-card defect and add failing comparison-entry/playback tests; implement contained telemetry layout and comparison setup-to-replay flow; verify the screenshot case, direct comparison setup, preparation/cancel and paired replay on desktop and phone; rerun the complete frontend gate and record results. Existing changes are preserved.

Follow-up implementation: telemetry now uses a card-width grid with a full-width wrapping status row and two bounded metrics. The workspace retains one primary Stop action. Comparison reuses `DispatchForm` and incident map directly, including vehicle, ranked station, density, cascade and replay-speed preferences. Successful preparation automatically opens two equal replay panes with the results inspector closed. Shared pause/restart/seek/speed controls stay visible; phone pane changes and scenario editing preserve the replay cursor. Cancel remains available during preparation, including failed-Stop retry. Focus remains explicit. Per the user's follow-up, comparison no longer starts in Focus or sends users to another route for setup; the design and frontend README now reflect that choice.

Verification evidence under `.tmp/playwright/multiview/followup/`: `kpi-red.log` reproduces 208px content in a 101px telemetry cell; `kpi-green.log` and `kpi-responsive.log` verify contained fields at 1440×1000, 320×568, 390×844 and 844×390, plus one visible Stop. `comparison-replay.log` verifies automatic playback, two 720px desktop panes, pause/seek/speed/restart, retained scenario and phone cursor continuity against real backend recordings. `cancel.log` verifies one start, one Stop and no second recording after Cancel. `responsive-replay.log` verifies bounded document, maps, controls and non-overlapping provenance/timeline at five portrait/landscape/desktop sizes. Browser artifacts use `playwright-cli` through bash; isolated local services avoid disturbing existing development servers. No backend source or lifecycle was changed.

Author self-review:

| Before | After | Why |
| --- | --- | --- |
| Viewport-based telemetry columns overflow a 360px inspector | Wrapping status row and bounded card-width metric grid | Long status text cannot collide with values |
| Comparison starts with an empty Focus view and external setup link | Direct incident map and shared dispatch controls | Configure either mode pair in the comparison route |
| Manual replay lives behind the inspector | Automatic paired playback with shared visible transport | Both simulations move together immediately after preparation |
| Footer covers timeline; compact landscape crowds maps | Reserved footer space and compact responsive controls/header | Keep the clock and map usable on small screens |

No dependency/public-contract/backend deviation. Physical phone chrome, keyboard and touch behavior remain unverified without attached hardware. Proposed commit: `fix: repair telemetry layout and complete comparison setup and replay`.

Follow-up frontend gate: `npm run lint && npm run typecheck && npm run format:check && npm test && npm run build` — **exit 0**, **69 files / 531 tests passed** (`.tmp/multiview/followup-gate.log`). Added regression coverage for direct comparison entry, initial results-inspector collapse, replay speed, paired snapshots and comparison-specific shared settings. Existing controller cancellation, validation, resource-limit and Stop/error tests remain passing. Graph refresh passes (`.tmp/multiview/followup-graph.log`); `git diff --check` passes. R3/R5 follow-up software acceptance is complete; hardware caveat above remains. Changes remain uncommitted on `feature/multiview-simulation-workspace`; nothing pushed or published.

Final route-return regression: returning during recording originally left a ready pair in setup (`followup/navigation-red.log`). Comparison now initializes its presentation independently of recording availability, so preparation completion opens and plays the pair even after remount. A fresh real-backend capture verifies navigation away/back during preparation and automatic synchronized playback (`followup/navigation-start.log`, `followup/navigation-green.log`). Final screenshots include settled dark desktop and phone layouts with the timeline fully visible. The final frontend gate above was rerun after this fix and passes unchanged at 531 tests.

### Local commit closeout — 2026-10-22

The user subsequently authorized grouping and committing all workspace implementation changes. The work is organized into runtime/recording/diagnostics foundations, replay-aware maps and camera controls, integrated workspace routes/UI, and documentation/evidence. Fresh frontend verification passes all required checks, including 69 test files / 531 tests and production build (`.tmp/multiview/commit-gate.log`). Local commits remain on `feature/multiview-simulation-workspace`; no push or pull request was requested.
