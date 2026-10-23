# UI Overhaul ("Night Corridor II") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: emil-design-eng (primary), executing-plans, test-driven-development, verification-before-completion, playwright-cli. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make theme switching atomic and make the frontend read as one restrained, high-craft product (Linear/Raycast/Vercel tier) without changing behaviour.

**Architecture:** Styling and presentation only. A small pure module (`src/lib/theme-transition.ts`) owns the theme switch via the View Transitions API, with a barrier the map can join. Tokens in `src/app/globals.css` move to an explicit neutral scale, hairline borders and a single UI accent. Components migrate onto those tokens; no props, routes, simulation or transport logic change.

**Tech Stack:** Next.js 16.4 App Router, React 19.3 (`flushSync`), Tailwind v4, next-themes 0.4.6, MapLibre 6, Vitest (node env), `@playwright/cli`. CSS-only motion; no new dependencies.

**Spec:** this document's "Audit" and "Design decisions" sections, plus the prior approved plan `docs/superpowers/plans/2026-10-22-night-corridor-theme.md` (palette semantics, motion rules), which this plan refines.

## Global Constraints

- Do not touch `backend/`, generated contracts, simulation/transport logic or the screen scaffold.
- No dependency or lockfile changes (`docs/engineering/frontend-dashboard.md`). UI copy stays English. Simulated values stay visibly labelled.
- Signal colours keep their meaning: `go` green, `caution` amber, `emergency` red, `cascade` violet, `beacon` cyan. All text pairings ≥ 4.5:1 in both themes.
- Keep light/dark/system themes, 44px targets on coarse pointers, safe-area insets, `100dvh` shells.
- UI motion ≤ 250ms; only `transform`/`opacity` animate (colour may *transition* on hover, never as a layout animation). Hover gated by `(hover: hover) and (pointer: fine)`. No animation on keyboard-initiated actions. Reduced motion keeps fades, drops movement.
- HTML snapshot tests (`__snapshots__/`) change with class names: regenerate deliberately, review the diff.
- Browser artefacts only under `.tmp/playwright/`.
- Per phase: `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`, then the Playwright checklist in light and dark, desktop (1440×900) and phone (390×844).

## Review Focus

1. **Theme change not triggered by the toggle** (OS switch while on "System", another tab writing `localStorage.theme`): must snap cleanly in one frame, no 2k-element transition storm. Owned by Task 1.2 (`disableTransitionOnChange`).
2. **Rapid double-click on the toggle** mid-transition: the second click must skip the first transition and land on the final theme. Task 1.1 test `skips the running transition when a new one starts`.
3. **Map style slow or offline** (CARTO unreachable): the barrier must time out and the page transition still completes. Task 1.1 test `does not wait past the barrier cap`.
4. **Browsers without `document.startViewTransition`** and reduced motion: instant switch, never a half-applied theme. Task 1.1 tests `applies directly without view transitions` / `under reduced motion`.
5. **Light-theme contrast after de-saturation** (muted text on `surface-1`/`bg`): Task 2.1 contrast test covers every documented pair.

---

## Audit (2026-10-23, dev server, Chromium via playwright-cli)

Evidence scripts and frames: `.tmp/playwright/audit/` (`switch.js`, `longtask.js`, `maptime.js`, `shots.js`).

### Root cause: why the theme switch looks bad

The app does not have one transition, it has ~2,100 independent ones racing a frozen main thread.

| # | Finding | Evidence | Source |
|---|---|---|---|
| 1 | `:root[data-theme-switching] *` forces a 250ms transition on `background-color, border-color, color, fill, stroke, box-shadow` for **every element**. Because the base layer sets `* { border-color: var(--border) }`, every element also transitions four border sides, bordered or not. | `/simulation/green-wave`: **2,102** CSS transitions start on one click (471 × 4 border sides, 192 `color`, 23 `background-color`). Home: 902. | `globals.css:339-345`, `globals.css:159-161` |
| 2 | Starting those transitions blocks the main thread, so the cross-fade is never seen: the page freezes, then the 300ms timer that removes `data-theme-switching` expires during the freeze and everything snaps. | Long task **445ms**, worst frame **517ms**. Click→first paint **~350ms** with the rule vs **~170ms** with transitions disabled (same dev build). | `ThemeToggle.tsx:16-23` |
| 3 | Pseudo-elements are not matched by `*`, gradients cannot interpolate, and `color-scheme` flips native controls instantly. These snap at t=0 while their hosts fade. | At t=0 the hero glow (`.home-main::before`) is already the dark-theme gradient while `body` is still light. Same for `.workspace-provenance::before`, `.dashboard-map::after`, `.hud-range` track gradient, scrollbars, `<select>`. | `globals.css:1084-1096`, `:628`, `:220`, `:1510` |
| 4 | Translucent surfaces (`color-mix(... transparent)`, `bg-card/88`) transition over parents that are transitioning on the same clock, so mid-frames show compounding, off-palette greys. Text and its background pass through low-contrast midpoints. | Visible in slowed captures of the inspector and nav pill. | `globals.css:452, 524, 613, 1449` |
| 5 | The map runs a **separate, unsynchronised** three-stage swap: canvas dims to 28% ~107ms after the click (after React's effect), MapLibre `setStyle` waits a further 220ms, new style is painted at **~381ms**. Page and map are never in the same theme state at the same time. | `maptime.js`: `switchingAt 107`, `classRemovedAt 381`. | `useMaplibreMap.ts:81-111`, `globals.css:347-357` |
| 6 | next-themes applies the class in a `useEffect` after `setTheme`, so any snapshot/transition tooling must flush React synchronously first. `disableTransitionOnChange` is not enabled, so OS-driven or cross-tab switches also run every hover transition at once. | `next-themes/dist/index.mjs` (`S` applied in effect on `[e,c]`). | `layout.tsx:49` |
| 7 | The theme-toggle thumb animates `transform` 200ms while the rest of the page changes colour: two clocks on one control. | `globals.css:560` | |

**Fix (Phase 1):** delete the global transition rule; switch themes inside `document.startViewTransition` with a synchronous React flush, so the browser captures old and new states as two bitmaps and cross-fades them on the compositor (one clock, pseudo-elements and `color-scheme` included, no per-element style work). Turn on `disableTransitionOnChange` so nothing inside the new live snapshot transitions. Let the map join the switch through a capped barrier instead of running its own fade. Give the toggle thumb its own `view-transition-name` so it morphs position inside the same transition.

### Styling architecture and "AI slop" inventory

The prior Night Corridor work already fixed a lot (`transition-all` is gone, custom curves exist, `pressable`, `@starting-style` dialog). What remains:

| Before | After | Why |
|---|---|---|
| `:root[data-theme-switching] *` 250ms colour transitions | View Transition root cross-fade, 180ms `--ease-out` | One compositor animation instead of 2,100 style transitions |
| `.home-main::before` green radial glow; `.dashboard-map` cyan radial gradient | Remove | Decorative gradient glows are the most recognisable AI-template tell |
| `.hud-primary` coloured glow `0 10px 24px -12px go/80%`; `DashboardHeader` `shadow-lg shadow-emerald-500/25` | Flat accent fill + 1px top inner highlight | Coloured shadows read as "SaaS template"; depth comes from luminance, not glow |
| `.hud-panel` = border + card bg + `shadow-panel` inside an already-bordered inspector | Flat sections on the inspector surface, hairline dividers | Cards-in-panels look floaty; Linear/Vercel inspectors are flat |
| Dark neutrals at chroma 0.018–0.025 (navy-black) | Chroma 0.006–0.010 | Saturated blue-black is the default "dark dashboard" look; near-neutral reads more expensive and lets signal colours carry meaning |
| 9 radii in use (0.4375, 0.5, 0.625, 0.75, 0.875, 1, 1.25rem, 999px, shadcn calc scale) | 4: `--radius-xs` 6px, `--radius-sm` 8px, `--radius-md` 12px, `--radius-full` | Inconsistent rounding is a "generated" signature |
| 7 type sizes incl. arbitrary `text-[9px]`/`[10px]`, mono used for prose labels ("1.0x normal") | 8-step scale; mono only for IDs/telemetry values | Clear hierarchy; mono-as-decoration is noise |
| DOM map markers `shadow-lg`/`shadow-md`/`drop-shadow-md` | `--shadow-marker`: `0 0 0 1px` ring + `0 1px 2px` | Heavy blurred shadows on small markers look muddy on both map styles |
| MapLibre paints hard-coded Tailwind hex (`#10b981`, `#8b5cf6`, `#ef4444`, `#22c55e`, `#f59e0b`, `#064e3b`, `#64748b`) | Theme-aware `map-palette.ts` resolved from the same OKLCH values | Map colours currently ignore the token system and don't adapt to theme |
| Violet "Cascade corridor mode" switch is the loudest control in the inspector | Switch uses the UI accent; violet stays on map links and the cascade chip | One accent for controls; semantic hues for data |
| `.dark` blur+saturate floats (`blur(12px) saturate(1.4)`) re-declared in 4 places | One `.surface-float` utility | Single material over the map |
| Dead UI with slop classes: `dashboard/RoutePreview.tsx`, `dashboard/VehicleTelemetry.tsx`, `DashboardHeader` component body (only its `DashboardMode` type is imported), `ui/button.tsx` (no importers) | Delete; move `DashboardMode` type | Removes ~200 lines of off-system styling |
| Phone: MapLibre compact attribution opens expanded, covering the provenance pill and a third of the map | Start collapsed | Seen at 390×844 on every map route |

Typography observations: hero is good (`text-balance`, tight tracking) but `tracking-tight` (-0.025em) is too loose at 60px; KPI values already use `tabular-nums`, but the density readout (`1.5x`), home ordinals (`01`), diagnostics durations and comparison timeline do not.

---

## Design decisions (need human approval before Phase 2)

| # | Decision | Recommendation |
|---|---|---|
| D1 | De-saturate neutrals (changes the approved "deep blue-black" to near-neutral cool grey) | Yes. Hue 260, chroma ≤ 0.010 |
| D2 | Cascade switch colour: violet → UI accent | Yes; violet remains on map + chip |
| D3 | Inspector cards → flat sections | Yes |
| D4 | Map joins the theme transition via a barrier capped at 300ms (screen holds the old frame up to the cap) vs map popping in after the cross-fade | Barrier. Hold old frame; prefetch both style JSONs so the real wait is short |
| D5 | Theme transition style: plain cross-fade vs circular clip-path reveal from the toggle | Plain 180ms cross-fade. The toggle is utilitarian; restraint wins |

Phase 1 does not depend on these and can start immediately.

## Token spec (Phase 2)

Values are OKLCH; verify with the Task 2.1 contrast test, adjust lightness only.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `0.985 0.002 260` | `0.155 0.008 260` | page, workspace header, inspector |
| `--surface-1` | `1 0 0` | `0.185 0.008 260` | raised sections, inputs on bg |
| `--surface-2` | `1 0 0` | `0.215 0.009 260` | popover, dialog, segmented thumb |
| `--surface-3` | `0.955 0.003 260` | `0.25 0.010 260` | hover / pressed fill |
| `--fg` | `0.20 0.010 260` | `0.96 0.003 260` | primary text |
| `--fg-muted` | `0.46 0.012 260` | `0.72 0.010 260` | secondary text (≥ 4.5:1) |
| `--fg-subtle` | `0.60 0.010 260` | `0.56 0.010 260` | placeholder, disabled, decorative only |
| `--border` | `oklch(0 0 0 / 8%)` | `oklch(1 0 0 / 7%)` | hairlines |
| `--border-strong` | `oklch(0 0 0 / 12%)` | `oklch(1 0 0 / 11%)` | inputs, segmented track |
| `--highlight` | none | `inset 0 1px 0 oklch(1 0 0 / 5%)` | top edge of surface-2 only |
| `--shadow-float` | `0 1px 2px oklch(0 0 0/6%), 0 8px 24px -8px oklch(0 0 0/12%)` | `0 0 0 1px oklch(1 0 0/6%), 0 12px 32px -8px oklch(0 0 0/60%)` | only elements over the map and dialogs |
| `--shadow-marker` | `0 0 0 1px oklch(0 0 0/12%), 0 1px 2px oklch(0 0 0/20%)` | `0 0 0 1px oklch(0 0 0/40%), 0 1px 2px oklch(0 0 0/50%)` | DOM map markers |
| `--primary` | existing `go` | existing `go` | the one UI accent |

Mapping: shadcn names stay as aliases (`--background`→`--bg`, `--card`→`--surface-1`, `--popover`→`--surface-2`, `--accent`/`--muted`→`--surface-3`, `--muted-foreground`→`--fg-muted`). `--shadow-panel` is removed. Elevation in dark mode = one lightness step per level + hairline; no shadows on in-flow surfaces.

Type scale (`@theme`): `--text-2xs` 11px/16, `--text-xs` 12/16, `--text-sm` 13/20, `--text-base` 14/20, `--text-md` 16/24, `--text-lg` 20/28, `--text-xl` 28/34 (-0.02em), `--text-display` 48–60 (-0.035em). Headings `text-wrap: balance`; body `text-wrap: pretty`; `.hud-value`, `.tabular` → `font-variant-numeric: tabular-nums`.

Motion tokens: `--ease-out` (exists), `--dur-press: 120ms`, `--dur-hover: 150ms`, `--dur-enter: 200ms`, `--dur-exit: 150ms`, `--dur-theme: 180ms`.

## Motion spec (Phase 3)

| Element | Frequency | Motion |
|---|---|---|
| Theme switch | rare | VT root cross-fade 180ms `--ease-out`; toggle thumb morph 200ms via `view-transition-name: theme-thumb` |
| Buttons, segments, nav links, home tools | many/day | `scale(0.97)` on `:active`, 120ms `--ease-out`; full-width/large surfaces (`.hud-primary`, `.home-card`) `scale(0.98)` |
| Hover fills | many/day | `background-color`/`color` 150ms `ease`, fine pointers only |
| Route nav, segmented controls, Details/Focus toggles | many/day, often keyboard | none (instant) |
| JSON dialog | occasional | in: opacity + `scale(.96→1)` 200ms (exists); out: opacity 150ms via `transition-behavior: allow-discrete` (new) |
| Run summary `.hud-enter` | rare | keep `@starting-style`, shorten 300→220ms |
| Status dots (`animate-pulse`) | ambient | replace Tailwind pulse with 2s opacity breathe 1→0.45, `ease-in-out` |
| Range thumb | frequent | `scale(1.1)` on `:active`, 120ms |

---

## Phase 0: Baseline harness

### Task 0.1: Commit reusable Playwright audit scripts

**Files:**
- Create: `frontend/scripts/visual-audit/routes.js` (screens 5 routes × light/dark × desktop/phone → `.tmp/playwright/visual/<phase>/`)
- Create: `frontend/scripts/visual-audit/theme-switch.js` (light→dark and dark→light on `/` and `/simulation/green-wave`; reports `{ cssTransitions, viewTransitionAnimations, firstPaintMs, longTasks, mapThemeAtFirstFrame }`)
- Create: `frontend/scripts/visual-audit/README.md` (one paragraph: `playwright-cli open` then `playwright-cli --raw run-code --filename=...`; dev or `npm run build && npm start`)

Port from `.tmp/playwright/audit/{shots,switch,longtask,maptime}.js`. `mapThemeAtFirstFrame` = whether `MapContainer`'s style name matches `html.dark` in the first rAF after `transition.finished` (read via a `data-map-theme` attribute set in Task 1.3).

- [ ] Write scripts; run both on the current tree with `npm run build && npm start`; save baseline numbers into the README table ("before" row).
- [ ] Commit: `test: add playwright visual audit scripts`

---

## Phase 1: Atomic theme switch (priority)

### Task 1.1: `theme-transition` module

**Files:**
- Create: `frontend/src/lib/theme-transition.ts`
- Test: `frontend/src/lib/theme-transition.test.ts`

**Interfaces:**
- Produces:
  - `type ThemeBarrier = (nextResolved: "light" | "dark") => Promise<void>`
  - `registerThemeBarrier(barrier: ThemeBarrier): () => void` (returns unregister)
  - `transitionTheme(apply: () => void, nextResolved: "light" | "dark", env?: ThemeTransitionEnv): Promise<void>`
  - `type ThemeTransitionEnv = { startViewTransition?: (cb: () => Promise<void>) => { finished: Promise<void>; skipTransition(): void }; reduceMotion: boolean; capMs?: number /* default 300 */ }` (defaults read `document`/`matchMedia` lazily so tests inject everything; Vitest runs in `node`)

Behaviour: no VT or reduced motion → call `apply()` synchronously, resolve. Otherwise skip any in-flight transition, then `startViewTransition(async () => { apply(); await Promise.race([Promise.allSettled(barriers.map(b => b(next))), sleep(capMs)]) })`.

- [ ] **Step 1: Failing tests** (`describe("transitionTheme")`):
  - `applies directly without view transitions`: env without `startViewTransition` → `apply` called once, synchronously.
  - `applies directly under reduced motion`: `reduceMotion: true` + spy VT → VT not called.
  - `applies inside the view transition callback`: fake VT records callback; `apply` not called before the callback runs, called once inside it.
  - `waits for registered barriers`: barrier resolving after 50ms (fake timers) → callback promise pending at 49ms, resolved at 50ms; barrier receives `"dark"`.
  - `does not wait past the barrier cap`: never-resolving barrier, `capMs: 300` → callback resolves at 300ms.
  - `ignores a rejecting barrier`: rejecting barrier → callback resolves, no throw.
  - `skips the running transition when a new one starts`: two calls → first transition's `skipTransition` called once.
  - `unregister removes the barrier`.
- [ ] **Step 2:** `cd frontend && npx vitest run src/lib/theme-transition.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat: add atomic view-transition theme switch helper`

### Task 1.2: Wire toggle, delete the transition storm

**Files:**
- Modify: `frontend/src/components/hud/ThemeToggle.tsx` (delete `switchThemeSmoothly`/`switchTimer`; onClick → `transitionTheme(() => flushSync(() => setTheme(value)), resolve(value))` where `resolve("system")` uses `matchMedia("(prefers-color-scheme: dark)")`; thumb gets `style={{ viewTransitionName: "theme-thumb", transform: ... }}`)
- Modify: `frontend/src/app/layout.tsx:49` (add `disableTransitionOnChange`)
- Modify: `frontend/src/app/globals.css` (delete lines 339-345; add VT rules below)
- Test: `frontend/src/components/hud/ThemeToggle.test.tsx` (new; render to static markup like `DashboardHeader.test.tsx`; assert thumb carries `view-transition-name:theme-thumb`)

```css
::view-transition-old(root),
::view-transition-new(root) {
  animation-duration: var(--dur-theme, 180ms);
  animation-timing-function: var(--ease-out);
}
::view-transition-group(theme-thumb) {
  animation-duration: 200ms;
  animation-timing-function: var(--ease-out);
}
@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) { animation: none; }
}
```

- [ ] Failing test → implement → `npm test` green.
- [ ] Verify `flushSync` really lands the class inside the callback: in `theme-switch.js`, assert `html.classList.contains("dark")` is true in the first frame of `::view-transition-new` (read inside `transition.ready`). If false, `apply` additionally sets `documentElement.classList` and `style.colorScheme` directly (mirrors next-themes' own `S`).
- [ ] Playwright gate: `cssTransitions === 0` during the switch, `viewTransitionAnimations > 0`, no long task > 50ms attributable to style recalc (prod build), hero glow and body change in the same frame.
- [ ] Commit `fix: make theme switching atomic with view transitions`

### Task 1.3: Map joins the switch

**Files:**
- Modify: `frontend/src/components/map/useMaplibreMap.ts` (remove `MAP_STYLE_FADE_OUT_MILLISECONDS`, `styleSwapTimer`, `dashboard-map-canvas--switching` handling; on mount `registerThemeBarrier(next => swap(next))` where `swap` calls `setStyle(MAP_STYLES[next])` and resolves on the next `style.load` followed by one `render`; the existing `[theme]` effect becomes a no-op when `appliedTheme.current === theme` so it only covers non-toggle switches; set `data-map-theme` on the container on every `style.load`; prefetch both `MAP_STYLES` URLs with `fetch(url, { cache: "force-cache" })` after first load)
- Modify: `frontend/src/app/globals.css` (delete lines 347-357)
- Test: `frontend/src/components/dashboard-map-lifecycle.test.tsx` (extend: barrier registered on mount, unregistered on unmount; a second barrier call for the already-applied theme resolves immediately)

- [ ] Failing tests → implement → green.
- [ ] Playwright gate: `mapThemeAtFirstFrame === true` for both directions on `/simulation/green-wave` and `/compare`; offline CARTO (`playwright-cli route "**/basemaps.cartocdn.com/**" --status=503`) still completes the transition within cap + 200ms.
- [ ] Record "after Phase 1" row in `scripts/visual-audit/README.md`.
- [ ] Commit `fix: swap map style inside the theme transition`

**Phase 1 checkpoint:** report numbers vs baseline, propose message, wait for human feedback on D1–D5.

---

## Phase 2: Tokens and surfaces

### Task 2.1: Contrast-checked neutral scale

**Files:**
- Modify: `frontend/src/app/globals.css:65-156` (new tokens per Token spec, shadcn aliases)
- Create: `frontend/src/lib/theme-tokens.test.ts`

The test reads `globals.css`, extracts `:root` and `.dark` custom properties, converts OKLCH → linear sRGB → WCAG luminance (inline helper, ~25 lines, composites alpha over the pair's background).

- [ ] Failing test `text pairs meet 4.5:1 in both themes`: pairs `fg/bg`, `fg/surface-1`, `fg/surface-2`, `fg-muted/bg`, `fg-muted/surface-1`, `fg-muted/surface-2`, `primary-foreground/primary`, `go|caution|emergency|beacon|cascade` on `bg` and `surface-1`.
- [ ] Test `hairline borders stay subtle`: dark `--border` alpha between 0.05 and 0.09.
- [ ] Implement tokens; tune lightness only until green.
- [ ] Update `theme-color` meta hexes in `layout.tsx:29-30` and `theme-provider.tsx:14` to the new `--bg`.
- [ ] Commit `feat: replace neutrals with contrast-checked surface scale`

### Task 2.2: Radii, elevation, materials

**Files:** `frontend/src/app/globals.css` (all component classes), `frontend/src/components/map/{StationLayer,SignalMarkers,IncidentMarker,MapContainer}.tsx`

- [ ] Add `--radius-xs|sm|md|full` to `@theme`; replace every literal radius in `globals.css` (0.4375→xs, 0.5/0.625→sm, 0.75/0.875/1/1.25rem→md).
- [ ] Remove `--shadow-panel` and its uses (`.hud-panel`, `.home-art`, `.home-card`, `.flow-step`); in-flow surfaces get border only.
- [ ] Add `@utility surface-float` (surface-2 at 82% + `backdrop-filter: blur(12px) saturate(1.4)` + `--shadow-float`), replace the four re-declarations (`.workspace-float`, `.workspace-provenance`, `.comparison-preparation`, maplibre ctrl group).
- [ ] Map DOM markers: `shadow-lg|md`, `drop-shadow-md` → `shadow-[var(--shadow-marker)]`; marker labels `bg-card/95 backdrop-blur` → `surface-float`.
- [ ] Remove `.home-main::before` glow and the `.dashboard-map` radial gradient; `.hud-primary` glow → `box-shadow: var(--highlight)`.
- [ ] Regenerate snapshots (`npx vitest run -u`), review diff is class/style-only.
- [ ] Commit `refactor: unify radii, elevation and map materials`

### Task 2.3: Typography

**Files:** `frontend/src/app/globals.css` (`@theme` text scale, `@layer base` headings/paragraph wrap), components using `text-[9px]`/`text-[10px]`/`text-[11px]`/`tracking-[…]` (55 occurrences; `grep -rnE "text-\[(9|10|11)px\]|tracking-\[" src/components`)

- [ ] Add scale tokens; replace arbitrary sizes (9/10px → `text-2xs` 11px; map labels stay 10px via `.dashboard-map-label` only).
- [ ] Hero: `tracking-[-0.035em]`; `h1,h2,h3 { text-wrap: balance }`, `p { text-wrap: pretty }`.
- [ ] `tabular-nums` on density readout, home ordinals, diagnostics durations, comparison timeline time, playback chips.
- [ ] Mono only on IDs/values: "1.0x normal/3.0x peak", "simulated s per real s" → sans `text-2xs text-[var(--fg-muted)]`.
- [ ] Commit `refactor: tighten type scale and numeric alignment`

### Task 2.4: Theme-aware map palette

**Files:**
- Create: `frontend/src/components/map/map-palette.ts` — `mapPalette(theme: "light" | "dark"): { routeCasing, routeLive, routePlanned, cascade, endpointLine, signal: Record<SignalPhase, string> }` (hex strings, derived once from the OKLCH tokens and commented with their source token)
- Test: `frontend/src/components/map/map-palette.test.ts` (every key present for both themes; `signal.PRIORITY_GREEN` ≠ `signal.CLEARING`; dark route casing darker than light casing)
- Modify: `RouteLayer.tsx:28,36`, `CascadeLinksLayer.tsx:48`, `EndpointMarkers.tsx:89`, `SignalMarkers.tsx:25-31` to read from `mapPalette(theme)`; layers already re-add on `styleRevision`, so the palette follows the barrier swap.
- [ ] TDD as above; commit `feat: derive map layer colours from theme tokens`

### Task 2.5: Remove dead off-system UI

**Files:** delete `src/components/dashboard/RoutePreview.tsx` (+test), `VehicleTelemetry.tsx` (+test), `src/components/ui/button.tsx`; move `DashboardMode` type from `DashboardHeader.tsx` to `src/components/dashboard/dashboard-mode.ts`, delete `DashboardHeader.tsx` (+test) after confirming no renderer (`grep -rn "<DashboardHeader" src`). Keep `components.json`.
- [ ] Full check suite green; commit `refactor: remove unused dashboard preview components`

**Phase 2 checkpoint:** `routes.js` sweep, side-by-side with Phase 0 frames, human review.

---

## Phase 3: Component polish and micro-interactions

Each task: implement → snapshot regen + review → full checks → `routes.js` for the touched routes → commit.

### Task 3.1: Workspace chrome
`globals.css` `.workspace-header|navigation|button|float|provenance`, `.theme-toggle`. Nav pill: track `--surface-3` at 60% → `--surface-1` + `--border-strong`; active link `--surface-2` + `--highlight`, no drop shadow. `.workspace-button` drops `box-shadow`; `:active` uses `--dur-press`. Commit `feat: refine workspace chrome surfaces`.

### Task 3.2: Inspector HUD
`.hud-panel` → flat section (`padding-block: 1.25rem`, no border/bg/shadow; `.hud-divider` between) — D3. `.hud-primary`: 40px tall, `--radius-sm`, accent fill, `--highlight`, `:active scale(0.98)`. `.hud-switch` checked → `--primary` (D2). `.hud-range` thumb → accent border, `:active scale(1.1)`; track uses `--border-strong`. `.hud-segmented` track `--surface-1`, selected `--surface-2` + `--highlight`. Replace `motion-safe:animate-pulse` in `KpiHeader.tsx:128`, `ItsConsole.tsx:30` with `.status-breathe`. Commit `feat: flatten inspector and refine HUD controls`.

### Task 3.3: Dialog and inputs
`.json-dialog`: exit 150ms opacity using `transition-behavior: allow-discrete` on `display, overlay`; `::backdrop` `oklch(0 0 0 / 50%)` without blur. `.hud-input`: `--surface-1`, `--border-strong`, focus ring `0 0 0 3px color-mix(var(--ring) 20%)`, placeholder `--fg-subtle`. Commit `feat: polish dialog exit and form fields`.

### Task 3.4: Home
`.home-card`: `--radius-md`, border only, hover border `--border-strong` (not green), `:active scale(0.98)`; ordinals tabular. `.home-art` border only. Keep corridor animation (approved delight). Commit `feat: quiet home surfaces`.

### Task 3.5: Phone map attribution
`MapContainer`/`useMaplibreMap.ts`: on first `load`, if the attribution control is compact, remove `maplibregl-compact-show` once so it starts collapsed; the `:has(.maplibregl-compact-show)` provenance offset stays for when the user opens it. Test in `map-render-state.test.ts` style if logic is extracted; otherwise Playwright gate only. Commit `fix: start phone map attribution collapsed`.

---

## Playwright verification checklist (every phase)

Run against `npm run build && npm start` (dev-mode React inflates timings).

- [ ] `routes.js`: 20 frames (5 routes × 2 themes × 2 viewports) into `.tmp/playwright/visual/<phase>/`; compare with previous phase. Nothing clipped at 390px; no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`).
- [ ] `theme-switch.js` both directions, `/` and `/simulation/green-wave`: `cssTransitions == 0`; `firstPaintMs` ≤ baseline/2; no frame > 50ms outside the map barrier window; `mapThemeAtFirstFrame == true`.
- [ ] Theme via OS: `playwright-cli set-color-scheme dark` with theme = system → single-frame snap, `cssTransitions == 0`.
- [ ] Reduced motion: `playwright-cli set-reduced-motion reduce` → switch is instant; dialog fades only; corridor paused.
- [ ] Keyboard: Tab through nav, toggle, inspector; focus ring visible on every stop in both themes; Escape/Focus mode not animated.
- [ ] Coarse pointer (`open --mobile`): targets ≥ 44px; no hover styles stick after tap.
- [ ] Console clean (`playwright-cli console warning`).
