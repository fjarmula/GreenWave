# P2 Soft Glass Visual System and Map Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: emil-design-eng (primary), apple-design, subagent-driven-development or executing-plans, test-driven-development, verification-before-completion, playwright-cli. Use Context7 for MapLibre API docs. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every screen adopts the approved "Soft Glass" look (calm, Apple-Maps-like, frosted glass over a full-bleed map), and the map is the real basemap recoloured, with the corridor drawn in the home animation's language.

**Architecture:** Tokens and one glass material in `globals.css` drive all components. Simulation workspaces become map-first (map under everything, header and inspector float as glass). The CARTO basemap is recoloured by a pure `restyleBasemap(style, theme)` applied through MapLibre `setStyle(url, { transformStyle })` inside the existing theme-swap barrier, so the first frame of each theme is already restyled. Corridor layers keep their ids and data flow; only paint and marker DOM change.

**Tech Stack:** Next.js 16.4, React 19.3, Tailwind v4, MapLibre GL 6.14, Vitest, `@playwright/cli`.

**Spec:** `docs/superpowers/specs/2026-10-23-soft-glass-live-comparison-design.md` (section P2). Visual references (local): `.superpowers/brainstorm/19135-1792746801/content/theme-directions-2.html` card G, `driver-soft-glass.html`, `map-style.html` option B. Prior plan whose constraints still hold: `docs/superpowers/plans/2026-10-23-ui-overhaul.md`.

## Global Constraints

- No new dependencies, no lockfile changes. No backend or generated-contract changes.
- Signal colour semantics unchanged (go green, caution amber, emergency red, cascade violet, beacon cyan); all text pairs ≥ 4.5:1 in both themes (extend `src/lib/theme-tokens.test.ts`).
- Keep the theme view-transition mechanism (`src/lib/theme-transition.ts`, map theme barrier) untouched in behaviour; the switch must stay seamless.
- Radii: sheet 22px, card/tile 14px, control 12px, pill full. Glass: light white 82% + `blur(20px) saturate(1.6)` + 1px inner top highlight + soft neutral shadow; dark graphite (`--surface-2`) 72% + same blur + `oklch(1 0 0 / 8%)` hairline ring.
- `go` stays the single UI accent. No decorative gradients, no coloured shadows, no glow except the map signal-lamp halo and vehicle pulse.
- Numerals: display 28–40px semibold, tracking −0.03em to −0.04em, `tabular-nums`. Mono only for IDs (`INT-0167`) and raw telemetry.
- Motion: UI ≤ 250ms, transform/opacity only, hover gated by `(hover: hover) and (pointer: fine)`, reduced motion keeps fades only. Sheet/panel open-close may use `--ease-drawer` up to 400ms.
- Copy: English, sentence case, friendly ("41 s faster", "Green in 180 m"); simulated values stay visibly labelled.
- Keep 44px coarse-pointer targets, safe-area insets, `100dvh` shells, no horizontal page scroll at 390px.
- Snapshot tests (`__snapshots__/`) change with classes: regenerate deliberately and review.
- Browser artefacts only under `.tmp/playwright/p2/`.
- Checks per task: `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`.

## Review Focus

1. Basemap style unreachable (CARTO 503): the page still renders with the fallback ground colour and the theme switch completes within the barrier cap. Task 4 test `restyleBasemap tolerates unknown layers` + Playwright offline route.
2. Glass over a busy map in light theme: inspector text stays ≥ 4.5:1 against the worst case (glass composited over white street). Task 1 contrast test composites glass over `#ffffff` and over the dark map ground.
3. Browsers without `backdrop-filter` support: glass falls back to an opaque surface, never transparent text on map. Task 2 `@supports not (backdrop-filter: blur(1px))` rule, asserted by CSS text test.
4. Inspector floating panel at short desktop heights (1280×720) and 200% zoom: panel scrolls internally, never clips the primary action. Task 3 Playwright step.
5. Theme switch mid-run with the vehicle moving: wake/pulse layers re-add after `style.load` and do not flash the old palette. Task 5 test on `styleRevision` re-add + Playwright `theme-switch.js` `mapThemeAtFirstFrame`.

---

## File map

- `frontend/src/app/globals.css` — tokens, `surface-glass` utility, component classes (workspace, hud, home, comparison, json dialog).
- `frontend/src/components/map/basemap-style.ts` (new) + test — pure restyle of CARTO style JSON.
- `frontend/src/components/map/map-palette.ts` — extend palette with basemap and corridor colours.
- `frontend/src/components/map/map-theme-swap.ts`, `useMaplibreMap.ts` — pass theme into `setStyle` with `transformStyle`.
- `frontend/src/components/map/{RouteLayer,SignalMarkers,VehicleMarker,EndpointMarkers,StationLayer,IncidentMarker}.tsx` — corridor language.
- `frontend/src/components/workspace/{WorkspaceShell,HomeMenu,GreenWaveIllustration}.tsx`, `frontend/src/components/hud/*`, `frontend/src/components/diagnostics/*` — class changes only.

---

### Task 1: Soft Glass tokens

**Files:**
- Modify: `frontend/src/app/globals.css` (`:root`, `.dark`, `@theme inline` radius mapping lines ~50–56, ~126–129)
- Test: `frontend/src/lib/theme-tokens.test.ts`

**Interfaces — Produces tokens:** `--radius-control: 12px`, `--radius-card: 14px`, `--radius-sheet: 22px` (remove `--radius-inner`, `--radius-surface`; remap `@theme inline` `--radius-sm→control`, `--radius-md/lg→card`, `--radius-xl..4xl→sheet`); `--glass-bg`, `--glass-ring`, `--glass-shadow`, `--glass-highlight`; `--tile` (opaque inner tile: light `oklch(0.97 0.004 260)`, dark `oklch(0.26 0.008 260)`); light `--bg` `oklch(0.965 0.005 255)` (pale cool grey like the mock's `#eef1f5`); dark `--bg` graphite `oklch(0.17 0.004 260)`.

- [ ] **Step 1: Failing tests:** add pairs `fg/tile`, `fg-muted/tile`, `fg/glass-over-white`, `fg-muted/glass-over-white`, `fg/glass-over-map-dark` (composite `--glass-bg` over `#ffffff` in light and over dark map ground `#1b1d21` in dark) to `text pairs meet 4.5:1 in both themes`; new test `radii follow the soft glass scale` asserting `--radius-control: 12px`, `--radius-card: 14px`, `--radius-sheet: 22px`.
- [ ] **Step 2:** `cd frontend && npx vitest run src/lib/theme-tokens.test.ts` → FAIL.
- [ ] **Step 3:** Implement tokens; tune lightness only until green. Update `theme-color` meta hexes (`src/app/layout.tsx`, `src/components/theme-provider.tsx`) to the new `--bg`.
- [ ] **Step 4:** PASS; full checks. Commit `feat: add soft glass tokens`.

### Task 2: Glass material and component sweep

**Files:** `frontend/src/app/globals.css` (`@utility surface-float` → `surface-glass`; `.workspace-*`, `.hud-*`, `.theme-toggle*`, `.json-dialog`, `.comparison-*`), component class names where `surface-float` is used (`grep -rn "surface-float" frontend/src`).

**Interfaces — Produces:** `@utility surface-glass` (background `var(--glass-bg)`, `backdrop-filter: blur(20px) saturate(1.6)`, `box-shadow: var(--glass-highlight), var(--glass-ring), var(--glass-shadow)`, `border-radius: var(--radius-sheet)`), with `@supports not (backdrop-filter: blur(1px)) { background: var(--surface-2) }`. `@utility tile` (opaque `--tile`, `--radius-card`).

- [ ] **Step 1: Failing test** in `theme-tokens.test.ts`: `it("glass has an opaque fallback")` — CSS text contains `@supports not (backdrop-filter` and, inside it, `background-color: var(--surface-2)`; and `surface-float` no longer appears.
- [ ] **Step 2:** FAIL → implement:
  - Segmented controls (`.hud-segmented`, `.theme-toggle`, nav pill): track `--tile`, thumb white/`--surface-3` with `--thumb-shadow`, radius `--radius-control`; pill nav radius full.
  - Buttons: `.hud-primary` 44px, `--radius-card`, `go` fill, white text, `pressable`; `.hud-danger` becomes a soft red tile (`color-mix(var(--emergency) 12%)` bg, `--emergency` text).
  - Inputs `.hud-input`: `--tile` fill, no border, focus ring `0 0 0 3px color-mix(in srgb, var(--ring) 25%, transparent)`.
  - Chips `.hud-chip`: pill, tinted bg 12% of tone, tone text, semibold 11px.
  - KPI numerals `.hud-value`/`.kpi-value`: per Global Constraints numerals.
  - JSON dialog: `surface-glass` panel, `--radius-sheet`.
- [ ] **Step 3:** Regenerate snapshots `npx vitest run -u`; review diff is class/style only. Full checks. Commit `feat: apply soft glass material to controls`.

### Task 3: Map-first workspace shell

**Files:**
- Modify: `frontend/src/components/workspace/WorkspaceShell.tsx`, `frontend/src/app/globals.css` `.workspace-shell` … `.workspace-driver-status` (~lines 368–720)
- Test: `frontend/src/components/workspace/workspace-shell.test.tsx`

Layout: `.workspace-map-slot` is `position: absolute; inset: 0` under everything at all widths. Desktop (≥ 768px): `.workspace-header` floats top-left as a glass bar (nav pill + title), `.workspace-actions` floats top-right; `.workspace-inspector` is a `surface-glass` panel `position: absolute; top: 4.5rem; right: 0.75rem; bottom: 0.75rem; width: 380px` with internal scroll. Phone (< 768px): header glass bar at top; inspector is a glass panel docked to the bottom (`max-height: 45%`, `--radius-sheet` top corners) — P3 replaces this with the draggable sheet. Map padding (`src/lib/workspace-layout.ts` `mapPadding`) must account for the floating panel so `fitBounds` keeps the route visible.

- [ ] **Step 1: Failing tests:** `it("renders the map slot beneath floating header and inspector")` — markup order: map slot first, `data-layout="map-first"` on `main`; inspector has class `surface-glass`. In `src/lib/workspace-layout.test.ts`: `mapPadding(1440, 900)` right padding ≥ 380 + 12 when details open (add a `detailsOpen: boolean` third param: `mapPadding(width: number, height: number, detailsOpen: boolean)`), phone `mapPadding(390, 844, true)` bottom ≥ 45% of height.
- [ ] **Step 2:** FAIL → implement; update `mapPadding` callers (`grep -rn "mapPadding(" frontend/src`).
- [ ] **Step 3:** PASS; snapshots; full checks.
- [ ] **Step 4:** Playwright: `/simulation/green-wave` at 1440×900, 1280×720, 390×844, both themes, setup and live → `.tmp/playwright/p2/shell-*.png`; `scrollWidth <= innerWidth`; primary action visible at 1280×720 and at 200% zoom (`playwright-cli run-code` setting `document.body.style.zoom`).
- [ ] **Step 5:** Commit `feat: float workspace chrome over a full-bleed map`.

### Task 4: Basemap restyle

**Files:**
- Create: `frontend/src/components/map/basemap-style.ts`, `frontend/src/components/map/basemap-style.test.ts`
- Modify: `frontend/src/components/map/map-palette.ts` (+ test), `map-theme-swap.ts` (+ `map-theme-swap.test.ts`), `useMaplibreMap.ts`

**Interfaces:**
- Produces `type BasemapPalette = { ground: string; street: string; streetCasing: string; majorStreet: string; water: string; park: string; building: string; label: string; labelHalo: string }` added to `MapPalette` as `basemap: BasemapPalette`. Light: ground `#eef1f5`, street `#ffffff`, streetCasing `#dde2ea`, majorStreet `#ffffff`, water `#cfe3f2`, park `#dcefdc`, building `#e4e8ee`, label `#69707c`, labelHalo `#ffffff`. Dark: ground `#1b1d21`, street `#2c2f35`, streetCasing `#24272c`, majorStreet `#383c43`, water `#1d2b3a`, park `#1f2b22`, building `#23262b`, label `#9aa0ab`, labelHalo `#1b1d21`. (Verify label/ground ≥ 4.5:1 in the palette test.)
- Produces `restyleBasemap(style: StyleSpecification, theme: ResolvedTheme): StyleSpecification` — pure, returns a new object. Rules by layer `type` and `source-layer` (OpenMapTiles schema used by CARTO): `background` → ground; `fill` on `water` → water; `fill` on `park`/`landcover` with class wood/grass → park; `fill` on `building` → building; `line` on `transportation` → street, with ids containing `case`/`casing` → streetCasing and `motorway|trunk|primary` in filter/id → majorStreet; `symbol` text → `text-color` label, `text-halo-color` labelHalo; `symbol` on `poi` → `visibility: none`. Unknown layers untouched.
- Changes `MapStyleTarget.setStyle(url: string, theme: ResolvedTheme): void`; `useMaplibreMap` implements it as `instance.setStyle(url, { transformStyle: (_previous, next) => restyleBasemap(next, theme) })` (confirm option name/signature for MapLibre 6 via Context7). Initial map: construct with `style: groundOnlyStyle(theme)` (`{ version: 8, sources: {}, layers: [{ id: "ground", type: "background", paint: { "background-color": palette.ground } }] }`, exported from `basemap-style.ts`) then immediately `swap` to the initial theme through the same `setStyle` path, so no unstyled CARTO frame is ever painted.

- [ ] **Step 1: Failing tests** (`basemap-style.test.ts`, small hand-written style fixture with one layer per rule plus an unknown `raster` layer): each rule sets the expected paint value for both themes; POI symbol gets `layout.visibility === "none"`; unknown layer is deep-equal to input; input object not mutated. `map-theme-swap.test.ts`: `to("dark")` calls `setStyle(styles.dark, "dark")`. `map-palette.test.ts`: every basemap key present for both themes; label/ground contrast ≥ 4.5.
- [ ] **Step 2:** `npx vitest run src/components/map` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS. Playwright: both themes, zoom 12/14/16 on Kraków centre → `.tmp/playwright/p2/basemap-*.png`; `playwright-cli route "**/basemaps.cartocdn.com/**" --status=503` → ground colour shown, theme switch still completes (run `frontend/scripts/visual-audit/theme-switch.js`).
- [ ] **Step 5:** Commit `feat: recolour the basemap to soft glass`.

### Task 5: Corridor in the home-animation language

**Files:** `map-palette.ts` (+ test), `RouteLayer.tsx`, `SignalMarkers.tsx`, `VehicleMarker.tsx`, `EndpointMarkers.tsx`, `StationLayer.tsx`, `IncidentMarker.tsx`, `globals.css` (marker classes), tests `dashboard-map-lifecycle.test.tsx`, `src/lib/signal-visuals.test.ts`.

**Interfaces — Produces** in `MapPalette`: `routeCasing` (light `#ffffff`, dark `#0f1114`), `routeLive` (go), `routeStandard` (light `#8a919c`, dark `#6b717c`), `wake` (go). Layer ids unchanged except new `vehicle-wake` line layer.

- Route: casing 14px + line 7px, round caps/joins (mock G). Standard mode draws `routeStandard`.
- Signals: DOM lamp dot 12px with 3px white (light) / graphite (dark) ring; `PRIORITY_GREEN` adds a 4px soft halo `box-shadow: 0 0 0 4px color-mix(go 25%)`; `NORMAL` red; `CLEARING` teal; `RECOVERY` caution. `INT-xxxx` labels on small glass chips, mono 10px.
- Vehicle: white-ringed red dot 16px (`--emergency` fill, 3px white ring) with the existing pulse ring (1.2s, `--ease-out`, reduced motion → static ring); in ENABLED mode a `vehicle-wake` line layer draws the last 120 m of route behind the vehicle with a `line-gradient` from transparent to `wake` at 70% (requires `lineMetrics: true` on its GeoJSON source; slice with `pointAtDistance`/`distanceAlongRoute` from `src/lib/route-position.ts`).
- Endpoints/stations/incident: white-ringed solid dots (station beacon blue, incident emergency red), labels on glass chips.

- [ ] **Step 1: Failing tests:** palette keys for both themes; `it("adds the vehicle wake only in Green Wave mode and re-adds it after a style load")` in `dashboard-map-lifecycle.test.tsx` using the existing fake map; `signal-visuals.test.ts` asserts PRIORITY_GREEN visual has `halo: true`, others `false` (add `halo` to the visual descriptor).
- [ ] **Step 2:** FAIL → implement → PASS; snapshots regenerated and reviewed.
- [ ] **Step 3:** Playwright: live run both modes, both themes, desktop + phone → `.tmp/playwright/p2/corridor-*.png`; compare against `map-style.html` B.
- [ ] **Step 4:** Commit `feat: draw the corridor like the home animation`.

### Task 6: Home and diagnostics in Soft Glass

**Files:** `HomeMenu.tsx`, `GreenWaveIllustration.tsx`, `globals.css` (`.home-*`, `.corridor-*`), `src/components/diagnostics/*.tsx` class names.

- Home: background `--bg`; hero unchanged copy; illustration in a `--radius-sheet` card on `--surface-1`; corridor art recoloured: blocks `--tile`, road white with `streetCasing` casing (light) / `street` (dark), vehicle as Task 5 (red dot, white ring), green wake and lamps unchanged. Mode cards: `--radius-sheet`, `surface-1`, icon in a 36px rounded tile; `pressable`.
- Diagnostics: cards `--radius-card` on `--surface-1`; status chips per Task 2; data-flow view uses tiles.
- [ ] **Step 1:** Update `HomeMenu`/diagnostics snapshot tests deliberately (`npx vitest run -u`), review diff.
- [ ] **Step 2:** Playwright `frontend/scripts/visual-audit/routes.js` → `.tmp/playwright/visual/p2/`; reduced motion keeps the corridor paused.
- [ ] **Step 3:** Full checks. Commit `feat: bring home and diagnostics to soft glass`.

### Task 7: Closeout sweep

- [ ] `routes.js` 5 routes × 2 themes × 2 viewports; `theme-switch.js` both directions on `/` and `/simulation/green-wave`: `cssTransitions == 0`, `mapThemeAtFirstFrame == true`; `playwright-cli console warning` clean.
- [ ] Keyboard pass: focus ring visible on glass in both themes.
- [ ] Report with before/after frames; `graphify update .`.
