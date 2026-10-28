# P6 Map Chrome, Route Framing and Driver Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Also: test-driven-development, emil-design-eng and apple-design (label styling, refit motion), mobile-native (driver phone layout), playwright-cli, verification-before-completion. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The attribution line stops repeating the simulation disclaimer. Every route fit keeps the whole route clear of the floating overlays (nav, inspector, bottom sheet, driver card, chip). The driver map labels only the next two junctions, with a short street name.

**Architecture:**
- Overlays declare themselves with `data-map-occluder`.
- A pure `occluderPadding(mapRect, rects)` in `workspace-layout.ts` turns measured rectangles into fit padding. A small DOM helper (`measureMapPadding`) collects the rectangles.
- Route fit and endpoint fit both use it. `createMapCamera` gains a "user moved" flag and `reframe()`, which an occluder observer calls.
- Driver labels are pure helpers in `driver-signal-labels.ts`, used by `SignalMarkers` behind a `labels: "full" | "driver"` prop.

**Tech Stack:** React 19, Next.js (read `frontend/node_modules/next/dist/docs/` before touching Next APIs), MapLibre GL 6.14, Tailwind v4, Vitest (node environment), `@playwright/cli`.

**Spec:** `docs/superpowers/specs/2026-10-24-dispatch-access-and-map-framing-design.md` (section B).

## Global Constraints

- Frontend only; no new dependencies.
- The provenance chip `Simulated · all signal states` stays visible in every workspace (domain invariant: simulated values are clearly labelled). Data and basemap attribution remain reachable.
- `ROUTE_FIT_MARGIN_PX = 32`. Max combined padding per axis: 60 % of that axis. Edge tie order: top, bottom, left, right.
- Refit only while the camera mode is `overview` and the user has not panned or zoomed since the last fit. Use the `prefers-reduced-motion` duration 0, as in today's fits.
- Driver labels: the next 2 upcoming intersections only. Sans 11 px, `font-medium`, one line, `max-width: 11rem`, ellipsis. No ID, no state word. The ARIA label is unchanged.
- The driver tab bar is unchanged.
- Browser artefacts only under `.tmp/playwright/p6/`.
- Checks: `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`.

## Review Focus

1. The phone bottom sheet is dragged to `expanded` during a run: the reserved bottom padding would exceed the 60 % clamp, so the route still fits in the remaining 40 % and never inverts (negative or NaN padding). Task 1 test `clamps an oversized occluder`.
2. The user zooms into the vehicle, then toggles Details: no refit steals the camera. Task 3 test `reframe is ignored after a user move`.
3. A hidden occluder (`hidden`, Focus mode) still in the DOM: a zero-size rect is ignored, so Focus mode fits edge to edge. Task 1 test `ignores empty and off-map rects`.
4. Driver intersection names that are null, coordinate-shaped, or share every part with their neighbours: no blank pill, and never an empty string. Task 4 tests `no label for coordinate names` and `falls back to the first part`.
5. The last upcoming intersection has fewer than two ahead (near arrival): one label, then none after it is passed. Task 4 test `labels at most the remaining upcoming`.

---

### Task 1: Quiet attribution and pure occluder padding

**Files:**
- Modify: `frontend/src/components/map/useMaplibreMap.ts:20-26` (remove the disclaimer entry from `DATA_ATTRIBUTION`; export the array for the test)
- Modify: `frontend/src/lib/workspace-layout.ts` (add `occluderPadding` beside `mapPadding`)
- Test: `frontend/src/lib/workspace-layout.test.ts`, `frontend/src/components/map/attribution.test.ts`

**Interfaces:**
- Produces:
  - `export type Rect = { left: number; top: number; right: number; bottom: number }`
  - `export type Padding = { top: number; bottom: number; left: number; right: number }`
  - `export const ROUTE_FIT_MARGIN_PX = 32`
  - `export function occluderPadding(map: Rect, occluders: readonly Rect[], margin = ROUTE_FIT_MARGIN_PX): Padding`

- [ ] **Step 1: Write the failing tests** (map rect `{0,0,1440,900}` unless stated):
  - `margin only without occluders`: all four sides `32`.
  - `top nav reserves the top`: occluder `{16,16,560,110}` → `top === 110 + 32`, `left === 32`.
  - `right inspector reserves the right`: `{1048,76,1428,888}` → `right === 1440 - 1048 + 32`.
  - `phone sheet reserves the bottom`: map `{0,0,390,844}`, sheet `{0,690,390,844}` → `bottom === 154 + 32`.
  - `takes the largest reservation per edge`: nav `{16,16,560,110}` plus actions `{1200,16,1428,70}` → `top === 142`.
  - `ignores empty and off-map rects`: `{10,10,10,10}` and `{2000,0,2100,50}` → all 32.
  - `compares intrusion relative to the axis`: map `{0,0,390,844}`, full-width sheet `{0,300,390,844}` (544 px from the bottom, 390 px from the left) → reserved at the bottom (`left === 32`).
  - `clamps an oversized occluder`: map `{0,0,390,844}`, sheet `{0,100,390,844}` → `left === 32`, `top + bottom <= 0.6 * 844`, all values finite and ≥ 0.
  - Attribution: `DATA_ATTRIBUTION.join(" ")` does not contain `simulated`.
- [ ] **Step 2: Run, expect FAIL.** `npx vitest run src/lib/workspace-layout.test.ts src/components/map/attribution.test.ts`.
- [ ] **Step 3: Implement** `occluderPadding` per spec B: clip each rect to the map, skip zero area, compute the four intrusions, reserve the one with the smallest intrusion relative to its axis (vertical ÷ height, horizontal ÷ width; tie order top, bottom, left, right), take the max per edge, add the margin, then scale the axis pair down proportionally if it exceeds 60 %. Remove the disclaimer string.
- [ ] **Step 4: Run, expect PASS;** `npm run typecheck` passes (`mapPadding` and its tests stay until Task 2 removes them).
- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/lib/workspace-layout.ts frontend/src/lib/workspace-layout.test.ts frontend/src/components/map/useMaplibreMap.ts frontend/src/components/map/attribution.test.ts
  git commit -m "feat: derive map fit padding from measured overlays"
  ```

### Task 2: Mark occluders and fit with measured padding

**Files:**
- Create: `frontend/src/components/map/occluders.ts`
- Modify: `frontend/src/components/workspace/WorkspaceShell.tsx` (add `data-map-occluder` to `<header>`, `#workspace-inspector` aside, `.workspace-provenance`, `.workspace-driver-status`, `.workspace-exit`), `frontend/src/components/workspace/BottomSheet.tsx` (the `.bottom-sheet` panel, not a full-screen wrapper), `frontend/src/components/map/MapContainer.tsx` (`.workspace-camera-controls`)
- Modify: `frontend/src/components/map/useRouteFit.ts` (`applyRouteFit` uses `measureMapPadding`; delete the `detailsOpen` lookup and the unused `useRouteFit` hook), `frontend/src/components/map/endpoint-fit.ts` (replace the hard-coded padding with `measureMapPadding`), `frontend/src/lib/workspace-layout.ts` + test (delete `mapPadding`, its constants and its three tests; keep `DESKTOP_MIN_WIDTH`)
- Test: `frontend/src/components/map/map-fit.test.ts`

**Interfaces:**
- Consumes: `occluderPadding`, `Rect`, `Padding` (Task 1).
- Produces:
  - `export const OCCLUDER_SELECTOR = "[data-map-occluder], .maplibregl-ctrl-bottom-right"`
  - `export function measureMapPadding(container: HTMLElement): Padding`: rects of every `OCCLUDER_SELECTOR` match inside the closest `.workspace-shell` (or `document` when there is none), relative to `container.getBoundingClientRect()`.
  - `export function observeOccluders(container: HTMLElement, onChange: () => void): () => void`: a `ResizeObserver` on current occluders, plus a `MutationObserver` on the shell (attributes `data-details`, `data-sheet`, `data-focus`, `hidden`; `childList` subtree) that re-binds it. `onChange` is coalesced to one call per animation frame. Returns a disposer.

- [ ] **Step 1: Write the failing test** in `map-fit.test.ts`, with a fake container and fake elements exposing `getBoundingClientRect()` and `closest()`/`querySelectorAll()` (node environment, no DOM): `measureMapPadding` returns `occluderPadding(containerRect, rects)` for the matched elements and ignores elements outside the shell.
- [ ] **Step 2: Run, expect FAIL.** `npx vitest run src/components/map/map-fit.test.ts`.
- [ ] **Step 3: Implement** `occluders.ts`; switch `applyRouteFit` and `applyEndpointFit` to `padding: measureMapPadding(map.getContainer())`. Keep the `maxZoom` values and durations. Add the attributes.
- [ ] **Step 4: Verify.** `npx vitest run` and `npm run typecheck` pass; `grep -rn "mapPadding\|detailsOpen" src` is empty.
- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/lib/workspace-layout.ts frontend/src/lib/workspace-layout.test.ts frontend/src/components/map/occluders.ts frontend/src/components/map/useRouteFit.ts frontend/src/components/map/endpoint-fit.ts frontend/src/components/map/map-fit.test.ts frontend/src/components/workspace/WorkspaceShell.tsx frontend/src/components/workspace/BottomSheet.tsx frontend/src/components/map/MapContainer.tsx
  git commit -m "fix: keep the fitted route clear of every map overlay"
  ```

### Task 3: Refit when overlays change, unless the user moved the map

**Files:**
- Modify: `frontend/src/lib/camera-policy.ts`, `frontend/src/components/map/useMapCamera.ts`
- Test: `frontend/src/components/map/map-camera.test.ts`

**Interfaces:**
- Consumes: `observeOccluders` (Task 2).
- Produces: `createMapCamera(...)` returns `reframe(): void` in addition to today's methods. A user `zoomend` or `dragstart` (with `originalEvent`) sets `userMoved = true`. `showRoute()` and the initial fit reset it. `reframe()` calls `fit()` only when `mode === "overview" && !userMoved && fitted`.

- [ ] **Step 1: Write the failing tests** (reuse the fake map in `map-camera.test.ts`):
  - `reframe refits in overview`: after creation (1 fit), `reframe()` → `fit` called twice.
  - `reframe is ignored after a user move`: emit `dragstart` with `originalEvent`, then `reframe()` → still one fit.
  - `show route re-enables reframe`: user move, `showRoute()`, `reframe()` → three fits in total.
  - `reframe is ignored while following`: zoom to 17 with `originalEvent` (mode `following`), `reframe()` → no extra fit.
- [ ] **Step 2: Run, expect FAIL.** `npx vitest run src/components/map/map-camera.test.ts`.
- [ ] **Step 3: Implement**, then in `useMapCamera` subscribe `observeOccluders(map.getContainer(), () => controller.reframe())` inside the controller effect and dispose it with the controller.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/lib/camera-policy.ts frontend/src/components/map/useMapCamera.ts frontend/src/components/map/map-camera.test.ts
  git commit -m "feat: reframe the route when map overlays change"
  ```

### Task 4: Driver signal labels

**Files:**
- Create: `frontend/src/lib/driver-signal-labels.ts`, `frontend/src/lib/driver-signal-labels.test.ts`
- Modify: `frontend/src/components/map/SignalMarkers.tsx` (prop `labels?: "full" | "driver"`, default `"full"`), `frontend/src/components/map/MapContainer.tsx` (prop `signalLabels?: "full" | "driver"` passed through), `frontend/src/components/dashboard.tsx:297` (pass `"driver"` when `driver`)

**Interfaces:**
- Produces:
  - `export const DRIVER_LABELLED_SIGNALS = 2`
  - `export function upcomingIntersectionIds(intersections: readonly IntersectionTelemetry[], count = DRIVER_LABELLED_SIGNALS): Set<string>`: the first `count` with `tti_seconds !== null`, in tick order.
  - `export function distinctStreetName(id: string, route: readonly RouteIntersection[]): string | null`

- [ ] **Step 1: Write the failing tests:**
  - `labels the next two`: tick `[a(tti null), b(12), c(30), d(55)]` → `{b, c}`.
  - `labels at most the remaining upcoming`: `[a(null), b(null), c(8)]` → `{c}`; all null → empty set.
  - `drops the shared street`: route `[X "Aleja Juliusza Słowackiego / Mazowiecka", Y "Aleja Juliusza Słowackiego / Krowoderska", Z "Aleja Juliusza Słowackiego / Łobzowska"]` → Y gives `"Krowoderska"`, X gives `"Mazowiecka"`.
  - `keeps all distinguishing parts`: `"Karola Bunscha / Profesora Michała Bobrzyńskiego / Czerwone Maki"` with neighbour `"Profesora Michała Bobrzyńskiego / Drukarska"` → `"Karola Bunscha / Czerwone Maki"`.
  - `falls back to the first part`: `"Mogilska"` between two `"Mogilska / …"` neighbours → `"Mogilska"`.
  - `no label for coordinate names`: `"50.07118, 20.00717"` → `null`; a `null` name → `null`; an unknown id → `null`.
- [ ] **Step 2: Run, expect FAIL.** `npx vitest run src/lib/driver-signal-labels.test.ts`.
- [ ] **Step 3: Implement** the helpers (coordinate test: `/^-?\d+(\.\d+)?, -?\d+(\.\d+)?$/`). In `SignalMarkers` with `labels === "driver"`: the label text is `distinctStreetName(...)` for upcoming IDs and `""` otherwise. Hide the pill when the text is empty (`label.hidden = !text`), and use the driver label class `font-sans text-[11px] font-medium max-w-[11rem] truncate` instead of the mono class. The ARIA label keeps `coarseMarkerLabels(...).ariaLabel`. Add `upcoming` to the effect dependencies.
- [ ] **Step 4: Run, expect PASS;** then `npm run lint && npm run typecheck`.
- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/lib/driver-signal-labels.ts frontend/src/lib/driver-signal-labels.test.ts frontend/src/components/map/SignalMarkers.tsx frontend/src/components/map/MapContainer.tsx frontend/src/components/dashboard.tsx
  git commit -m "feat: show short labels for the next two signals in driver mode"
  ```

### Task 5: Browser verification

**Files:** none (artefacts in `.tmp/playwright/p6/`).

- [ ] **Step 1:** Run the full frontend checks. Expected: all pass.
- [ ] **Step 2:** With the backend and `npm run dev`, use the `playwright-cli` skill. Recreate the two reference scenes: the police car from Komisariat IV to the Słowackiego / Mazowiecka area. For each, screenshot right after the run-start fit:
  - 1790×934 Green Wave, details open. The route's bounding box lies entirely below the nav bar's bottom edge and left of the inspector's left edge (check with `getBoundingClientRect` of the overlays against the route endpoints' `map.project`).
  - 1790×934, details closed, and in Focus mode.
  - 438×875 Driver, sheet collapsed. The route is clear of the header, the next-signal card and the sheet. At most two pills are visible, each without `INT-`.
  - Drag the sheet to half; the route refits. Zoom manually, toggle Details; no refit.
  - Every view still shows the `Simulated · all signal states` chip. The attribution line has no "simulated" text.
  Look at each screenshot before claiming the step.
- [ ] **Step 3:** Report the milestone: changed files, check output, screenshots reviewed, and the proposed commit message (if not committed per task).
