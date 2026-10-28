# Home and Driver Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-screen home page over a real Kraków green-wave background (live map on wide screens, static drawing on phones) with new mode icons, and a Driver screen whose setup panel minimizes and whose header collapses to a page menu.

**Architecture:**
- A backend export script bakes Kraków roads, the Aleje corridor and its signals into two committed frontend files: a JSON with the corridor and an SVG with the roads.
- One pure module drives the corridor animation for both backdrops.
- The home picks its backdrop on the client: static by default, upgraded to the live MapLibre map only on wide screens with WebGL.
- Driver changes go through opt-in props on the shared `BottomSheet` and `WorkspaceShell`, so the other views keep their behaviour.

**Tech Stack:** Next.js 16, React, MapLibre GL (already a dependency), Vitest (`environment: "node"`, SSR markup and pure tests), Python 3.12 with polars, shapely, networkx and pyproj (backend env), `@playwright/cli`.

**Spec:** `docs/superpowers/specs/2026-10-26-home-and-driver-polish-design.md`

## Global Constraints

- Branch `feat/ui-polish`. No push and no merge. Commits use `<category>: <message>`, stage explicit paths, and end with the session's `Co-Authored-By` trailer. Run `npx prettier --write` on touched frontend files before `git commit`; the pre-commit hook aborts on format changes.
- No new npm or Python dependencies. No API or schema change. No real signal actuation.
- Breakpoint: phone is `< DESKTOP_MIN_WIDTH` (`src/lib/workspace-layout.ts`, used by `useIsPhone`). "Wide" means `!useIsPhone()`.
- Animation constants (spec 1): `LOOP_MS = 16000`, `GREEN_LEAD = 0.14`, `GREEN_HOLD = 0.05`, `TRAIL = 0.22`, `REDUCED_PROGRESS = 0.55`.
- Motion tokens: `--ease-out`, `--dur-enter` (200ms). Hover styles go behind `@media (hover: hover) and (pointer: fine)`. Reduced motion means opacity only.
- MapLibre cannot parse `oklch()`. Map layer colours come from `mapPalette(theme)` (`src/components/map/map-palette.ts`): `wake`/`routeLive` for green and `signal.NORMAL` for the vehicle and red signals.
- OSM attribution must be reachable on both backdrops (spec 3). The "Simulation only" disclaimer stays visible (domain invariant).
- Frontend checks (in `frontend/`): `npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`. Backend checks (in `backend/`): `uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`.
- Playwright output goes only to `.tmp/playwright/`. The dev server runs on port 3100 (`npm run dev -- -p 3100`); the mock transport is fine.

## Review Focus

1. **Phones must never fetch MapLibre.** The server and first client render choose the static drawing. Only the client, after confirming wide and WebGL, imports the live map. Task 4 pins the `backdropKind` decision; Task 4 Step 6 checks the network log on a phone viewport.
2. **Live map failure.** No WebGL, a tile or style error, or going offline falls back to the static drawing, never a blank background. Task 4 pins `backdropKind(..., failed: true)`.
3. **Theme toggle on the home live map.** Corridor layers must survive the basemap style swap. `useMaplibreMap` bumps `styleRevision` on each style load, and the layers re-add on it (Task 4).
4. **Minimized sheet and keyboard.** While minimized, nothing below the peek row can take focus. The grabber stays reachable and its label says what it does. Task 7 pins `inert` and the labels.
5. **Short screens on home.** At heights under 700px the page scrolls instead of clipping, and the disclaimer stays reachable. Task 5 Step 5 checks 390×640.

---

### Task 1: Bake the home corridor (backend script + committed outputs)

**Files:**
- Create: `backend/scripts/export_home_corridor.py`
- Create: `backend/tests/scripts/test_export_home_corridor.py`
- Create (generated, committed): `frontend/src/data/home-corridor.json`, `frontend/public/home/krakow-roads.svg`

**Interfaces:**
- Produces `export_home_corridor(processed: Path, json_out: Path, svg_out: Path, *, start: tuple[float, float], end: tuple[float, float], center: tuple[float, float], span_x_m: float = 7600.0) -> dict`. `start`, `end` and `center` are lon/lat.
- JSON shape, consumed by Tasks 3 and 4. `x`/`y` are in viewBox units.

```json
{
  "provenance": {"generated_at": "...", "sources": ["road_edges.parquet", "intersections.parquet"], "crs": "EPSG:2178", "center": [lon, lat], "span_x_m": 7600.0},
  "viewBox": [0, 0, 1600, 1000],
  "phoneViewBox": [x, y, w, h],
  "route": {"path": "M..L..", "lonLat": [[lon, lat], ...]},
  "signals": [{"id": "INT-....", "name": "...", "t": 0.0, "x": 0.0, "y": 0.0, "lon": 0.0, "lat": 0.0}]
}
```

- SVG: the same `viewBox` as the JSON, with three `<path>` tiers (`minor`, `mid`, `major`) stroked `#fff`. Opacity is 0.35 for minor, 0.65 for mid and 1 for major; widths are 0.7, 1.2 and 2. No fill. It is used as an alpha mask, so it has no colours of its own.

Algorithm (from the brainstorm spike `bake_city.py`):
- Read `road_edges.parquet` (`EDGES_FILENAME` from `greenwave.etl.graph_io`), dropping `reverse_twin` rows. Geometry is WKB in `METRIC_CRS` (EPSG:2178).
- Tiers:
  - major: `motorway|trunk|primary` (and their `_link`s);
  - mid: `secondary|tertiary` (and their `_link`s);
  - minor: everything else.
- Keep edges whose centroid lies in the frame plus a 600 m pad. Simplify with a 2 m tolerance and round to 0.1 px.
- Build the route with networkx `shortest_path` on an undirected graph. Weight is `length_m`, ×4 for non-arterial edges. Start and end are the nearest graph nodes to `start`/`end`. Orient each edge geometry so it continues from the previous node.
- Signals: `intersections.parquet` rows within 40 m of the route. `t` is the projected distance along the simplified pixel route divided by its length. Drop any signal within `t` 0.035 of the previous one.
- `phoneViewBox`: the route's pixel bounding box padded by 60 px, widened to an aspect of 0.46 (w/h) around its centre.

- [ ] **Step 1: Write failing tests** in `test_export_home_corridor.py`. Load the script the way `test_export_station_snapshot.py` does (`importlib.util`). Build a fixture in `tmp_path`:
  - a 3×3 grid of 200 m `LineString` edges near `METRIC_CRS` point (7421000, 5547000) written to `road_edges.parquet`, with the columns `u, v, highway, length_m, reverse_twin, geometry_wkb`; the middle row is `primary`, the rest `residential`;
  - a 3-row `intersections.parquet` (`intersection_id, name, x_m, y_m, lon, lat`), two on the middle row and one off it.
  Tests:
  - `test_route_follows_arterial_and_lists_its_signals`: the JSON has 2 signals with `0 <= t <= 1` in ascending order, and `route.lonLat` has at least 2 points.
  - `test_svg_has_three_tiers_in_json_viewbox`: the SVG text contains `class="major"`, `class="mid"` and `class="minor"`, and `viewBox="0 0 1600 1000"`.
  - `test_provenance_recorded`: `provenance.crs == "EPSG:2178"` and both source names are listed.
  - `test_output_is_deterministic`: two runs give equal JSON except `generated_at`.
- [ ] **Step 2:** `cd backend && uv run pytest tests/scripts/test_export_home_corridor.py -q` → FAIL (script missing).
- [ ] **Step 3: Implement** the script, with a `main()` that uses `DatasetSettings().processed_dir`. Constants:
  - `start = (19.9235, 50.0478)`, `end = (19.9345, 50.0725)`, `center = (19.911, 50.0598)`;
  - outputs at `frontend/src/data/home-corridor.json` (indent 2) and `frontend/public/home/krakow-roads.svg`.
  The module docstring states the manual regeneration command, as `export_station_snapshot.py` does.
- [ ] **Step 4:** Rerun → PASS. Then `uv run python scripts/export_home_corridor.py`. Expect "11 signals" in its printout, the JSON under 40 KB and the SVG under 450 KB. Run the backend checks.
- [ ] **Step 5: Commit** `feat: bake the home corridor from the Kraków dataset`

### Task 2: Mode glyphs and home card icons (spec 4)

**Files:**
- Create: `frontend/src/components/workspace/ModeGlyphs.tsx`, `frontend/src/components/workspace/mode-glyphs.test.tsx`
- Modify: `frontend/src/components/workspace/HomeMenu.tsx` (the `MODES` icons; drop the `Waves`, `TrafficCone` and `GitCompareArrows` imports)

**Interfaces:**
- Produces `GreenWaveGlyph`, `StandardTrafficGlyph` and `ComparisonGlyph`, each `({ className }: { className?: string }) => JSX.Element`. Each is an `aria-hidden` `<svg>` with `fill="none"` and `currentColor` strokes. Geometry (from `mode-icons-v2.html`):
  - **Green Wave:** `viewBox="5 5 24 22"`, path `M7 19 C9.6 19 10.4 13 13 13 S16.4 20.5 19 20.5 S22.4 14.5 24 14.5` at stroke 2.2, plus a dot `(25.2, 14.5) r 2.3`.
  - **Standard traffic (S1):** `viewBox="0 0 24 24"`, path `M2.5 17h4.5V7.5h5.5V17h3.5` at stroke 2.2 with round joins, plus a dot `(19.4, 17) r 2.3`.
  - **Comparison (C1):** `viewBox="0 0 24 24"`, wave `M3 8 C5.2 8 5.8 4.6 8 4.6 S10.8 8 13 8 S15.2 6 16 6` with a dot `(19, 6) r 2.1`, and steps `M3 19.5h3v-5h3.5v5H11` with a dot `(14, 19.5) r 2.1`, all at stroke 2.

- [ ] **Step 1: Failing test:** each glyph renders `aria-hidden="true"` and `stroke="currentColor"`. Path and circle counts: wave 1/1, S1 1/1, C1 2/2. Rendering `<HomeMenu />` (wrapped in `SimulationProvider`) contains no `lucide-waves`, `lucide-traffic-cone` or `lucide-git-compare-arrows` class.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** the glyphs and swap them into `MODES` (`className="size-[18px]"`).
- [ ] **Step 4:** Run → PASS. `npm test`; update the home snapshots only if the diff is limited to the icons.
- [ ] **Step 5: Commit** `feat: draw mode icons as one wave, steps and race family`

### Task 3: Corridor animation core and static backdrop (spec 1, 6)

**Files:**
- Create: `frontend/src/lib/home-corridor.ts`, `frontend/src/lib/home-corridor.test.ts`
- Create: `frontend/src/components/workspace/HomeStaticBackdrop.tsx`, `frontend/src/components/workspace/useCorridorLoop.ts`

**Interfaces:**
- Produced by `lib/home-corridor.ts`:
  - `type CorridorSignal = { id: string; name: string; t: number; x: number; y: number; lon: number; lat: number }`
  - `LOOP_MS`, `GREEN_LEAD`, `GREEN_HOLD`, `TRAIL`, `REDUCED_PROGRESS` (values in Global Constraints)
  - `corridorProgress(timeMs: number, reduced: boolean): number`, in [0, 1)
  - `signalState(signalT: number, progress: number): "ahead" | "green" | "passed"`: green when `-GREEN_HOLD < signalT - progress < GREEN_LEAD`, ahead when it is ≥ `GREEN_LEAD`, otherwise passed
  - `pointAlong(lonLat: [number, number][], progress: number): { point: [number, number]; trail: [number, number][] }`: the trail runs from `max(0, progress - TRAIL)` to `progress`, measured along cumulative segment length with longitude scaled by cos(50.06°)
- Produced by `useCorridorLoop.ts`: `useCorridorLoop(onFrame: (progress: number) => void): void`. One `requestAnimationFrame` loop that reads `prefers-reduced-motion` and stops while `document.hidden` (via `visibilitychange`).
- `HomeStaticBackdrop({ phone }: { phone: boolean })` renders one `<svg>` with `viewBox` set to `corridor.viewBox` (or `corridor.phoneViewBox` on phone) and `preserveAspectRatio="xMidYMid slice"`. It contains:
  - `<mask id="home-roads" style="mask-type:alpha">` with `<image href="/home/krakow-roads.svg">` at viewBox size;
  - a full-size `<rect fill="var(--home-road-ink)" mask="url(#home-roads)">`;
  - the corridor base and trail paths, one `<circle>` per signal, and the vehicle with its halo.
  Each frame writes attributes directly through refs: the dash array and offset for the trail, `getPointAtLength` for the vehicle, and each signal's `data-state`. It does no React state per frame.

- [ ] **Step 1: Failing tests** (`home-corridor.test.ts`):
  - `corridorProgress(0, false) === 0`, `corridorProgress(LOOP_MS * 1.5, false) === 0.5`, `corridorProgress(123, true) === REDUCED_PROGRESS`;
  - `signalState(0.5, 0.40)` is `"green"`; `signalState(0.5, 0.30)` is `"ahead"`; `signalState(0.5, 0.56)` is `"passed"`;
  - `pointAlong([[0,0],[0,1]], 0.5).point` is `[0, 0.5]` and its `trail[0]` is `[0, 0.28]` (to within 1e-6);
  - `pointAlong(line, 0).trail` has length ≥ 1.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** `lib/home-corridor.ts`, `useCorridorLoop` and `HomeStaticBackdrop`. CSS in `globals.css` near `.home-main`:
  - `.home-backdrop` covers the page (`position: absolute; inset: 0; z-index: -1`).
  - Signal circles by `data-state`: ahead `var(--emergency)`, green `var(--go)` with a ring, passed `--home-signal-idle`.
  - Light-theme tokens: `--home-road-ink: oklch(0.2 0.01 260 / 22%)`, `--home-signal-idle: oklch(0.2 0.01 260 / 22%)`.
  - Dark-theme tokens: `--home-road-ink: oklch(1 0 0 / 16%)`, `--home-signal-idle: oklch(1 0 0 / 22%)`.
- [ ] **Step 4:** Run → PASS. Add an SSR test: `<HomeStaticBackdrop phone />` markup contains `viewBox="<phoneViewBox joined>"`, `href="/home/krakow-roads.svg"` and 11 `data-signal` circles.
- [ ] **Step 5: Commit** `feat: animate the home corridor over a static Kraków drawing`

### Task 4: Live map backdrop on wide screens (spec 1, 3)

**Files:**
- Modify: `frontend/src/components/map/useMaplibreMap.ts`. The signature becomes `useMaplibreMap(theme, { interactive = true, controls = true } = {})`; `controls: false` skips the `NavigationControl`. Attribution is always added.
- Create: `frontend/src/components/workspace/HomeLiveBackdrop.tsx`, `frontend/src/components/workspace/HomeBackdrop.tsx`, `frontend/src/lib/home-backdrop.ts` (+ test)

**Interfaces:**
- Produces `backdropKind({ hydrated, phone, webgl, failed }: { hydrated: boolean; phone: boolean; webgl: boolean; failed: boolean }): "static" | "live"`. It returns live only when hydrated, not phone, WebGL is available and the map has not failed.
- Produces `HomeBackdrop()`, the only backdrop the home renders. It holds `failed` in state and checks WebGL once (`canvas.getContext("webgl2") ?? getContext("webgl")`). It loads `HomeLiveBackdrop` with `next/dynamic(..., { ssr: false })`, so the MapLibre chunk is requested only when the result is `"live"`. While loading, or in the static case, it renders `<HomeStaticBackdrop phone={phone} />`.
- `HomeLiveBackdrop({ onFail }: { onFail: () => void })`:
  - calls `useMaplibreMap(theme, { interactive: false, controls: false })`;
  - on each `styleRevision` change, adds the sources and layers `home-route` (opacity 0.25, width 5), `home-trail`, `home-signals` (circle colour by a `state` property) and `home-vehicle` plus `home-vehicle-halo`, using `mapPalette(theme)` colours;
  - fits the route bounds with padding `{ left: 50% of width, right: 160, top: 80, bottom: 220 }`;
  - calls `onFail` on a map `error` event before the first `load`;
  - feeds `useCorridorLoop` through `pointAlong` and `signalState`, calling `setData` only when a signal's state changes.
- The CSS dim lives on the backdrop container: `.home-backdrop[data-kind="live"] .maplibregl-canvas { filter: saturate(0.5) }`, opacity 0.85 in dark and 0.7 in light.

- [ ] **Step 1: Failing tests** for `backdropKind`:
  - `{hydrated:false, phone:false, webgl:true, failed:false}` → static;
  - `{hydrated:true, phone:true, webgl:true, failed:false}` → static;
  - `{hydrated:true, phone:false, webgl:false, failed:false}` → static;
  - `{hydrated:true, phone:false, webgl:true, failed:true}` → static;
  - `{hydrated:true, phone:false, webgl:true, failed:false}` → live.
  Also: `renderToStaticMarkup(<HomeBackdrop />)` contains `href="/home/krakow-roads.svg"` (the server renders static) and no `maplibregl`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** `hydrated` comes from `useSyncExternalStore(noopSubscribe, () => true, () => false)`, and `phone` from `useIsPhone()`. Existing `useMaplibreMap` callers stay unchanged (defaults).
- [ ] **Step 4:** Run → PASS; `npm test`; `npm run typecheck`.
- [ ] **Step 5: Verify** with `playwright-cli` at 1440×900 on `/`:
  - The route, vehicle and signals animate on the live map.
  - Toggling the theme keeps the corridor layers.
  - The attribution ⓘ is present.
  - Routing `**/basemaps.cartocdn.com/**` to a 404 and reloading shows the static drawing.
  - Screenshots go to `.tmp/playwright/home-live-*.png`.
- [ ] **Step 6: Verify the phone** at 390×844: `playwright-cli requests` lists no `maplibre` chunk and no `cartocdn` request. Screenshot to `.tmp/playwright/home-static-phone.png`.
- [ ] **Step 7: Commit** `feat: play the home corridor on the live map on wide screens`

### Task 5: Home one-screen layout (spec 2, 3, 5)

**Files:**
- Modify: `frontend/src/components/workspace/HomeMenu.tsx`, `frontend/src/app/globals.css` (home rules ~1355-1620)
- Delete: `frontend/src/components/workspace/GreenWaveIllustration.tsx` and its `.corridor-*` / `.home-art*` CSS (unused after this task; confirm with `graphify query "GreenWaveIllustration"` before deleting)
- Test: create `frontend/src/components/workspace/home-menu.test.tsx`

**Interfaces:**
- Consumes: `HomeBackdrop` (Task 4) and the glyphs (Task 2).
- Layout in `HomeMenu`:
  - `<main className="home-main">` holds `<HomeBackdrop />`, `<div className="home-scrim" aria-hidden />`, a `<figcaption className="home-corridor-caption">` and the content grid (header / hero / bottom).
  - The caption shows on wide screens only, with the corridor name, "11 signalised junctions · real geometry", a legend and "Simulated".
  - The bottom area holds the cards, then one row with the tools and the disclaimer.
  - On phone, the static backdrop also gets the OSM line, an `<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>` placed after the disclaimer.
- CSS:
  - `.home-main { position: relative; isolation: isolate; height: 100dvh; overflow: hidden; display: grid; grid-template-rows: auto 1fr auto }`
  - Under `@media (max-height: 699px)`: `height: auto; min-height: 100dvh; overflow: visible`.
  - Scrims follow the mockup (`home-backgrounds-v3.html`, `.scrim` rules). Cards use the glass from that mockup: `background: color-mix(in oklch, var(--surface-1) 72%, transparent)` with a 14px backdrop blur.
  - On phone the cards become compact rows (icon, then title and copy), with the number hidden.

- [ ] **Step 1: Failing test:** `HomeMenu` markup (with providers) contains `home-scrim`, `home-corridor-caption`, `Aleje Trzech Wieszczów`, `Simulation only.` and `openstreetmap.org/copyright`, and contains no `corridor-art`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** the layout and CSS, then delete the illustration after confirming it is unused.
- [ ] **Step 4:** Run → PASS; `npm test`.
- [ ] **Step 5: Verify** screenshots at 1440×900, 390×844 and 390×640, in light and dark:
  - At 1440×900 and 390×844, `document.scrollingElement.scrollHeight <= innerHeight`.
  - At 390×640 the page scrolls and the disclaimer is reachable.
  - Text is readable over the background.
- [ ] **Step 6: Commit** `feat: fit the home page on one screen over the corridor background`

### Task 6: Three-snap sheet physics (spec 7)

**Files:**
- Modify: `frontend/src/lib/sheet-physics.ts`, `frontend/src/lib/sheet-physics.test.ts`

**Interfaces:**
- `SheetSnap` becomes `"minimized" | "collapsed" | "expanded"`.
- Produces `type SnapStop = { snap: SheetSnap; translate: number }`.
- Produces `settleSnap(stops: SnapStop[], startTranslate: number, offsetPx: number, velocityPxPerMs: number): SheetSnap`.
  - A flick (`|v| > FLICK_VELOCITY`) moves one stop from the start, in the flick's direction. Downward means a larger translate.
  - Otherwise it settles on the stop nearest `startTranslate + offsetPx`.
  - `stops` is sorted by translate inside the function.
- Keep `nextSnap` as a thin wrapper over two stops (`expanded` at 0, `collapsed` at `travelPx`) so existing callers and tests keep passing.

- [ ] **Step 1: Failing tests:**
  - stops `[e:0, c:300, m:520]`, start 300, offset +150, v 0 → `minimized` (nearest 450 is 520);
  - start 300, offset +40, v 0 → `collapsed`;
  - start 300, v +0.3 (flick down) → `minimized`; start 520, v −0.3 → `collapsed`; start 0, v −0.3 → `expanded` (stays at the bound);
  - two stops only (no minimized): start 300, v +0.3 → `collapsed`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS, plus the existing physics tests.
- [ ] **Step 5: Commit** `feat: settle the bottom sheet among any number of snaps`

### Task 7: BottomSheet minimized state (spec 7)

**Files:**
- Modify: `frontend/src/components/workspace/BottomSheet.tsx`, `frontend/src/components/workspace/bottom-sheet.test.tsx`, `frontend/src/components/workspace/WorkspaceShell.tsx` (the `WorkspaceSheet` type gains `minimizable?: boolean` and `minimizedLabel?: string`, passed to `BottomSheet`)
- Modify: `frontend/src/components/driver/DriverSetupSheet.tsx`. The title row (`#driver-setup-title`, around line 61) gets `data-sheet-peek` and shows `Incident · {dispatch.incident.label}` once an incident is chosen.

**Interfaces:**
- `BottomSheet` gains `minimizable?: boolean`. Default false keeps the two-stop behaviour.
- **Measurement.** When minimizable, `measure()` also reads the peek: the bottom edge of `[data-sheet-peek]` inside the collapsed slot, plus its padding-bottom inset. Minimized translate = `sheetHeight - peekVisible`. Stops go to `settleSnap`.
- **Minimized behaviour:**
  - The collapsed slot is `inert`.
  - A click on the sheet restores `"collapsed"`, unless it came from a drag.
  - The grabber's `aria-label` is "Show setup"; its `aria-expanded` stays false.
  - `--sheet-visible` is set from the current snap's visible height, so map controls drop with the sheet.

- [ ] **Step 1: Failing SSR tests:**
  - `<BottomSheet minimizable snap="minimized" …collapsed={<h2 data-sheet-peek>Where’s the incident?</h2>} />` gives `data-snap="minimized"`, a collapsed slot with `inert=""`, and a grabber with `aria-label="Show setup"`;
  - `snap="collapsed"` gives no `inert` on the collapsed slot;
  - without `minimizable` the markup is unchanged from today (assert the existing grabber labels "Show more" and "Show less").
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; `npm test`.
- [ ] **Step 5: Commit** `feat: let the bottom sheet minimize to its peek row`

### Task 8: Driver setup minimizes on map use; desktop minimize pill (spec 7)

**Files:**
- Modify: `frontend/src/components/map/MapContainer.tsx`. It gains the prop `onUserMove?: () => void`, called once per user gesture on `dragstart`, `zoomstart` and `rotatestart` when `event.originalEvent` is set, only while `!live`.
- Modify: `frontend/src/components/dashboard.tsx` (driver setup branch around line 250; the `onMapClick` passed to `MapContainer`)
- Modify: `frontend/src/components/workspace/WorkspaceShell.tsx` (desktop compact card)
- Test: `frontend/src/components/workspace/workspace-shell.test.tsx`

**Interfaces:**
- **Driver setup sheet:** `{ …, minimizable: true, minimizedLabel: incident ? \`Driver setup · ${incident.label}\` : "Driver setup · no incident" }`.
- **Phone gesture:** `onUserMove` → `if (phone && snap !== "minimized") setSnap("minimized")`.
- **Map click:** wrap the driver setup `onMapClick` so that after the original handler it calls `setSnap("collapsed")`.
- **Desktop card:**
  - When `desktopSheet.minimizable`, the aside renders a minimize button (`aria-label="Minimize setup"`, lucide `ChevronDown`, class `sheet-minimize`) in the top-right corner.
  - When `snap === "minimized"` the aside renders only `<button className="sheet-pill surface-glass pressable">{minimizedLabel}<ChevronUp/></button>`, which restores `"collapsed"`.
  - The pill enters with the popover motion (scale 0.97 + opacity, `--dur-enter`, `--ease-out`).

- [ ] **Step 1: Failing tests** (`workspace-shell.test.tsx`):
  - a shell with `sheet={{ snap: "minimized", minimizable: true, minimizedLabel: "Driver setup · no incident", … }}` renders `class="sheet-pill` with that label and not the collapsed content;
  - with `snap: "collapsed"` it renders `aria-label="Minimize setup"`;
  - a non-minimizable sheet renders neither.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; `npm test`.
- [ ] **Step 5: Verify** with `playwright-cli`:
  - Phone 390×844 on `/driver`: dragging the map minimizes the sheet to the peek row; tapping the map sets the incident and restores the sheet with "Incident · …"; tapping the minimized bar restores it.
  - Desktop 1440×900: minimize gives a pill; clicking it restores the card; dragging the map does not minimize.
  - Screenshots to `.tmp/playwright/driver-min-*.png`.
- [ ] **Step 6: Commit** `feat: minimize driver setup while the map is in use`

### Task 9: Compact Driver header with a page menu (spec 8)

**Files:**
- Create: `frontend/src/components/workspace/PageMenu.tsx`, `frontend/src/components/workspace/page-menu.test.tsx`
- Modify: `frontend/src/components/workspace/WorkspaceShell.tsx` (new prop `compactHeader?: boolean`; when true, the Details button is not rendered and the header gets `data-compact`)
- Modify: `frontend/src/components/dashboard.tsx` (driver `header` and `compactHeader={driver}`)
- Modify: `frontend/src/app/globals.css`

**Interfaces:**
- Produces `PageMenu({ current, title, detail }: { current: string; title: string; detail: string })`.
- **Trigger:** `<button className="page-menu-trigger" aria-expanded aria-controls={id}>` containing the lucide `Menu` icon, `{title}`, `<span className="text-muted-foreground">/ {detail}</span>` and `ChevronDown`. The title is also the page's `<h1>`: wrap the text in `<h1 className="workspace-title">` inside the button.
- **Popover:** `<div id className="page-menu" hidden={!open}>` containing `<WorkspaceNavigation current={current} />`, laid out vertically by CSS (`.page-menu .workspace-navigation { display: grid; border-radius: var(--radius-control) }`).
- **Closing:** Escape closes it and focuses the trigger; a `pointerdown` outside closes it; clicking a link closes it.
- **Motion:** `@starting-style` scale 0.97 + opacity, `transform-origin: top left`, `--dur-enter`/`--ease-out`, opacity only under reduced motion.
- **Compact header CSS:** one row at every width; actions stay icon-only.
- **Driver header:** `<PageMenu current="/driver" title="Driver simulation" detail={mode === "live" ? "Simulation" : "Setup"} />`.

- [ ] **Step 1: Failing tests:**
  - `PageMenu` markup has `aria-expanded="false"`, the popover `hidden=""`, one `<h1` containing "Driver simulation", and the 6 destination links;
  - `WorkspaceShell compactHeader` markup has `data-compact` and does not contain `aria-controls="workspace-inspector"` (Details);
  - without `compactHeader` the Details button is still there.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; `npm test` (update the driver snapshots only for header markup).
- [ ] **Step 5: Verify** with `playwright-cli` at 390×844 and 1440×900 on `/driver`:
  - The header is one row (height ≤ 56px on phone).
  - The menu opens and lists 6 pages; Escape closes it and focus returns to the trigger; choosing Home navigates.
  - Green Wave still shows its tab strip and Details button.
  - Screenshots to `.tmp/playwright/driver-header-*.png`.
- [ ] **Step 6: Commit** `feat: collapse the driver header into a page menu`

### Task 10: Final verification

- [ ] **Step 1:** Run the frontend checks, then the backend checks. Everything must pass; record the counts.
- [ ] **Step 2:** `git status` is clean apart from `.tmp/` and `.superpowers/`. `git log main..HEAD --oneline` lists the earlier 11 commits plus Tasks 1–9.
- [ ] **Step 3:** Run `graphify update .`.
- [ ] **Step 4:** Run a fresh whole-branch review per the executing skill, with this plan's Review Focus. Run the fix pass, then report to the human with the screenshots under `.tmp/playwright/`. Do not push.
