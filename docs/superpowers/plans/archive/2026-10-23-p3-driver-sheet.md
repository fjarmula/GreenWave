# P3 Driver Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: emil-design-eng, apple-design, mobile-native, subagent-driven-development or executing-plans, test-driven-development, verification-before-completion, playwright-cli. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Driver screen the map takes over once a run starts: setup collapses into a compact card (speed, ETA, saved, one Stop), a "next signal" card sits on top, dispatch settings open only from a chip, and the card can be dragged up for route signals.

**Architecture:** A reusable, dependency-free `BottomSheet` (pointer-driven drag with snap points, velocity dismissal, keyboard toggle) owns phone presentation; on desktop the same content renders in the P2 floating glass panel, which shrinks to a compact card. Pure helpers derive the next-signal card and ETA from the existing tick. `Dashboard`'s driver branch composes these; Green Wave/Standard workspaces adopt the sheet on phone in the last task.

**Tech Stack:** React 19.3, Tailwind v4, Vitest, `@playwright/cli`. CSS transforms + Pointer Events; no gesture library.

**Spec:** `docs/superpowers/specs/2026-10-23-soft-glass-live-comparison-design.md` (section P3). Approved mockup (local): `.superpowers/brainstorm/19135-1792746801/content/driver-soft-glass.html`. Depends on P2 (`surface-glass`, tokens, map-first `WorkspaceShell`).

## Global Constraints

- No new dependencies. No backend or contract changes.
- Exactly one Stop control in any state (today `DriverStatus` and `RunSummary` both render one).
- Sheet motion: `transform: translateY()` only, `--ease-drawer` `cubic-bezier(0.32, 0.72, 0, 1)` 350ms for settle; follow the finger 1:1 while dragging; flick velocity > 0.11 px/ms changes snap regardless of distance; damping past the top/bottom bounds; pointer capture on drag; ignore extra touch points. Reduced motion: snaps instantly (no translate animation).
- Accessible: grabber is a `<button aria-expanded aria-controls>` toggling expanded/collapsed; Escape collapses when expanded; content behind a collapsed sheet is `inert`.
- Copy (exact): setup title "Where's the incident?"; settings summary `Traffic {density}× · Cascade {on|off} · {speed}× speed`; next signal `Green in {distance}` / `Clearing in {distance}` / `Red in {distance}`; pill `{n} s faster · simulated` (or `{n} s slower · simulated`, or `On estimate · simulated` when 0); chip "Dispatch settings".
- Running dispatch settings are read-only (show the active run's settings, no start control) — design's builder call, decided here.
- 44px targets on coarse pointers, safe-area bottom inset inside the sheet, `100dvh`.
- Browser artefacts under `.tmp/playwright/p3/`.
- Checks: `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`.

## Review Focus

1. Drag started on a scrollable list inside the expanded sheet: list scrolls, sheet does not move until the list is at scrollTop 0 and the drag is downward. Task 1 test `defers to inner scroll`.
2. Run ends (ARRIVED/cancelled) while the sheet is expanded or the settings chip is open: sheet shows the terminal card, settings close, no Stop button remains. Task 3 test `terminal replaces stop`.
3. Telemetry stale/lost: compact card shows "Last received speed" and the stale note; next-signal card hides rather than showing a wrong distance. Task 2 test `no next signal without fresh telemetry`.
4. Orientation/resize while dragging (phone rotate): snap heights recompute from the container; sheet never ends off-screen. Task 1 test `recomputes snaps on resize`.
5. Starting a run from the Green Wave route while Driver is open in another view: Driver shows the replacement alert, never auto-starts. Existing `viewRunPolicy` tests stay green; Task 3 Playwright step.

---

### Task 1: `BottomSheet` primitive

**Files:**
- Create: `frontend/src/components/workspace/BottomSheet.tsx`
- Create: `frontend/src/lib/sheet-physics.ts`, `frontend/src/lib/sheet-physics.test.ts`
- Test: `frontend/src/components/workspace/bottom-sheet.test.tsx`
- Modify: `frontend/src/app/globals.css` (`.bottom-sheet*`)

**Interfaces — Produces:**
- `type SheetSnap = "collapsed" | "expanded"`
- `nextSnap(current: SheetSnap, offsetPx: number, velocityPxPerMs: number, travelPx: number): SheetSnap` — offset is the drag delta (negative = up). Flick `|velocity| > 0.11` decides by direction; else past half of `travelPx` switches.
- `dampedOffset(offsetPx: number, minPx: number, maxPx: number): number` — inside bounds returns offset; beyond, `bound + overshoot * 0.25`.
- `<BottomSheet snap={SheetSnap} onSnapChange={(s: SheetSnap) => void} collapsed={ReactNode} expanded={ReactNode} label={string} />` — collapsed content always visible at the top of the sheet; expanded content below it, `inert` when collapsed. Collapsed height = measured height of the collapsed slot + grabber; expanded = min(85% of container, content height).

- [ ] **Step 1: Failing tests** (`sheet-physics.test.ts`): `nextSnap("collapsed", -10, -0.2, 300) === "expanded"` (flick); `nextSnap("collapsed", -100, 0, 300) === "collapsed"`; `nextSnap("collapsed", -160, 0, 300) === "expanded"`; `nextSnap("expanded", 20, 0.3, 300) === "collapsed"`; `dampedOffset(-400, -300, 0) === -325`; `dampedOffset(-100, -300, 0) === -100`. Component (`bottom-sheet.test.tsx`, static markup): grabber `aria-expanded="false"` when collapsed; expanded region has `inert`; `aria-controls` points at the expanded region id.
- [ ] **Step 2:** `npx vitest run src/lib/sheet-physics.test.ts src/components/workspace/bottom-sheet.test.tsx` → FAIL.
- [ ] **Step 3:** Implement. Drag: `pointerdown` on the sheet header/grabber → `setPointerCapture`, track `pointerId` (ignore others), write `transform` directly on the element during the drag (no React state per frame), on `pointerup` compute velocity from the last 100ms of samples, call `nextSnap`, set state; settle with a CSS transition. Inner scroll: drags beginning inside the expanded content only move the sheet when `scrollTop === 0` and moving down (`defers to inner scroll`). `ResizeObserver` on the container recomputes snap heights (`recomputes snaps on resize`) — cover both with a small exported pure function `shouldDragSheet(scrollTop: number, deltaY: number, fromContent: boolean): boolean` tested in `sheet-physics.test.ts`.
- [ ] **Step 4:** PASS; full checks. Commit `feat: add draggable glass bottom sheet`.

### Task 2: Driver presentation helpers

**Files:**
- Create: `frontend/src/lib/driver-presentation.ts`, `frontend/src/lib/driver-presentation.test.ts`

**Interfaces — Produces:**
- `type NextSignal = { intersectionId: string; name: string | null; state: IntersectionState; distanceM: number }`
- `nextSignal(route: SimulationStartResponse, tick: SimulationTickEvent | null, stale: boolean): NextSignal | null` — first `tick.intersections` entry with `tti_seconds !== null`; distance = its `route_intersections[].distance_along_route_m` minus `distanceAlongRoute(route.route_geometry, [lng, lat])` of `tick.ambulance.position` (`src/lib/route-position.ts`); null when stale, no tick, or distance < 0.
- `formatSignalDistance(m: number): string` — `< 1000` → `"180 m"` (rounded to 10 m), else `"1.2 km"`.
- `nextSignalCopy(signal: NextSignal): string` — `PRIORITY_GREEN` → `Green in …`, `CLEARING` → `Clearing in …`, `NORMAL`/`RECOVERY` → `Red in …`.
- `etaSeconds(route: SimulationStartResponse, tick: SimulationTickEvent | null): number` — `max(0, estimated_greenwave_time_sec - (tick?.kpi_metrics.total_time_elapsed_sec ?? 0))` (ENABLED; for DISABLED use `estimated_normal_time_sec`).
- `savedPill(seconds: number): string` — exact copy from Global Constraints.
- `settingsSummary(settings: DispatchSettings): string` — exact copy.

- [ ] **Step 1: Failing tests** for each function with fixture route/tick (reuse `src/lib/comparison/fixtures.test-support.ts` shapes or build minimal ones): includes `no next signal without fresh telemetry` (stale → null), passed intersections skipped, `formatSignalDistance(184) === "180 m"`, `formatSignalDistance(1234) === "1.2 km"`, `savedPill(41) === "41 s faster · simulated"`, `savedPill(-5) === "5 s slower · simulated"`, `savedPill(0) === "On estimate · simulated"`, `settingsSummary({...density 1.5, cascade true, playbackSpeed 1}) === "Traffic 1.5× · Cascade on · 1× speed"`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat: derive driver next-signal and ETA presentation`.

### Task 3: Driver workspace states

**Files:**
- Modify: `frontend/src/components/dashboard.tsx` (driver branch), `frontend/src/components/driver/DriverStatus.tsx` (becomes the compact card), `frontend/src/components/workspace/WorkspaceShell.tsx` (accept `sheet` slot for phone and a `compact` flag for the desktop panel)
- Create: `frontend/src/components/driver/NextSignalCard.tsx`, `frontend/src/components/driver/DriverSetupSheet.tsx`, `frontend/src/components/driver/DispatchSettingsChip.tsx`
- Test: `frontend/src/components/driver/driver-status.test.tsx`, new `frontend/src/components/driver/driver-workspace.test.tsx`

**Interfaces:**
- Consumes: `BottomSheet`, `SheetSnap` (Task 1); `nextSignal`, `nextSignalCopy`, `etaSeconds`, `savedPill`, `settingsSummary` (Task 2).
- `WorkspaceShell` gains `sheet?: { snap: SheetSnap; onSnapChange: (s: SheetSnap) => void; collapsed: ReactNode; expanded: ReactNode }`; when present, phone renders `BottomSheet` instead of the inspector, desktop renders `collapsed` in the floating panel and `expanded` below it when `snap === "expanded"`.

States:
- Setup: `collapsed` = `DriverSetupSheet` (title, `IncidentInput`, `VehicleTypeControl`, settings summary button that sets snap expanded, primary "Initialize green corridor"); `expanded` = full `DispatchForm` parameter controls. Snap starts `collapsed`; the collapsed slot is the visible setup card.
- On successful start: snap forced to `collapsed`; `collapsed` = compact `DriverStatus` (speed big, ETA, `savedPill`, round Stop button `data-testid="driver-stop"`); `expanded` = `IntersectionList` + `ItsConsole` (no `KpiHeader`, no `RunSummary` stop). `NextSignalCard` floats top (glass). `DispatchSettingsChip` floats bottom-right above the sheet; opens a read-only glass popover of the run's settings.
- Terminal: compact card shows the run summary line and "Back to setup"; no Stop.

- [ ] **Step 1: Failing tests** (`driver-workspace.test.tsx`, static render with a provided `SimulationState`): `it("shows exactly one stop control while running")` (count `data-testid="driver-stop"` + `data-testid="stop-simulation"` === 1); `it("collapses setup and hides dispatch controls once running")` (no "Initialize green corridor", chip "Dispatch settings" present); `it("terminal replaces stop")` (FINISHED state → 0 stop controls, "Back to setup" present); `it("shows the next signal card with friendly copy")`.
- [ ] **Step 2:** FAIL → implement → PASS; snapshots reviewed; full checks.
- [ ] **Step 3:** Playwright (mock): `open --mobile /driver`, set incident, start, screenshot setup/running/expanded/settings/terminal → `.tmp/playwright/p3/driver-*.png`; drag sheet with `mousedown/mousemove/mouseup` and verify expanded state attribute; desktop 1440×900 same states. Compare to `driver-soft-glass.html`.
- [ ] **Step 4:** Commit `feat: map-first driver sheet`.

### Task 4: Sheet on phone for Green Wave and Standard

**Files:** `frontend/src/components/dashboard.tsx` (non-driver branch), tests `frontend/src/components/dashboard-parts.snapshot.test.tsx`.

- Phone: setup → `collapsed` = incident + primary action, `expanded` = full `DispatchForm`; live → `collapsed` = `KpiHeader` compact + single Stop, `expanded` = `RunSummary` (without its stop button) + `IntersectionList` + `ItsConsole`. Desktop keeps the floating inspector from P2.
- [ ] **Step 1:** Failing test: `it("renders one stop control in the live green wave workspace")`.
- [ ] **Step 2:** FAIL → implement → PASS; snapshots; full checks; Playwright phone pass for `/simulation/green-wave` and `/simulation/standard`.
- [ ] **Step 3:** Commit `feat: use the glass sheet on phone simulation workspaces`.
