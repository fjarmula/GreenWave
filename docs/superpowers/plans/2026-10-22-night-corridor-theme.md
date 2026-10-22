# Night Corridor Visual Theme Implementation Plan

> **For agentic workers:** REQUIRED SKILLS: emil-design-eng (primary), executing-plans, verification-before-completion, playwright-cli. Milestone-specific skills are listed per milestone. Steps use checkbox syntax.

**Goal:** Make the frontend as visually appealing as possible under one cohesive "Night Corridor" theme, without changing behaviour.

**Architecture:** Styling only. Semantic tokens and motion tokens live in `frontend/src/app/globals.css`; components move from ad hoc Tailwind palette classes (emerald/cyan/violet/amber) onto those tokens. Existing screens, routes, component boundaries, props and simulation logic stay as they are.

**Tech Stack:** Existing Next.js App Router, React, Tailwind v4, Base UI/shadcn, MapLibre, Vitest, @playwright/cli. CSS-only motion; no new dependencies.

**Branch:** `feat/night-corridor-theme` (created with human authorization).

## Design decisions (approved by the human, 2026-10-22)

- **Theme:** "Night Corridor": control-room feel. Deep blue-black (dark) and cool off-white (light) neutrals, tinted at hue ~255.
- **Colour has meaning only:** `go` = signal green (brand, green wave, positive outcomes); `caution` = amber; `emergency` = red; `cascade` = violet (cascade mode); `beacon` = cyan (route/info). All text pairings ≥ 4.5:1 in both themes.
- **Type:** Geist for UI; Geist Mono only for telemetry values and IDs; tabular numerals for live numbers.
- **Motion (Emil Kowalski rules):**
  - Strong `--ease-out`, `--ease-in-out` and `--ease-drawer` curves; UI durations under 250ms.
  - `scale(0.97)` press feedback on every pressable element.
  - Panels enter with `@starting-style` (opacity + 4px rise).
  - Dialogs scale `.96 → 1` from the centre.
  - No animation on keyboard-initiated actions (Escape, focus mode).
  - Hover effects gated behind `(hover: hover) and (pointer: fine)`.
  - Only `transform` and `opacity` animate.
  - Reduced motion removes movement and keeps fades.
- **Delight is reserved for rare moments:** the home hero illustration (a vehicle dot travelling a street while signals ahead turn green in sequence) and the run-finished summary. The human may ask to revert the illustration.

## Global constraints

- Do not touch `backend/`, generated contracts, simulation/transport logic or the screen scaffold (home + sub-screens).
- No dependency or lockfile changes. UI copy stays English. Simulated values stay visibly labelled.
- Keep light/dark themes, 44px touch targets on coarse pointers, safe-area insets and `100dvh` shells.
- HTML snapshot tests in `__snapshots__/` will change with class names: regenerate deliberately and review the diffs.
- Browser output stays under `.tmp/playwright/`.

## Workflow (human-defined)

1. Complete one milestone.
2. Run `npm run lint && npm run typecheck && npm run format:check && npm test && npm run build` in `frontend/` and check visually with playwright-cli, in light and dark.
3. Report the changes and propose a commit message. **The human reviews and commits**; wait before starting the next milestone.

## Milestones

### 1. Foundation (done)

- [x] Night Corridor palette for light and dark; semantic tokens `go`, `caution`, `emergency`, `cascade`, `beacon` exposed as Tailwind colours.
- [x] `shadow-panel` and `shadow-float` elevation tokens.
- [x] Strong motion curves (`ease-out`, `ease-in-out`, `ease-drawer`).
- [x] `pressable` utility; transitions on the existing `.workspace-button` and `.json-inspect-button` presses.
- [x] Global focus ring, selection colour, thin tinted scrollbars.
- [x] Theme cross-fade only during the switch (`data-theme-switching`, 250ms, set by ThemeToggle; skipped under reduced motion; map canvas excluded).
- [x] `theme-color` meta matches the new backgrounds; shadcn `Button` drops `transition-all` and uses a scale press.

### 2. Home screen (done)

Skills: emil-design-eng, animate.

- [x] Hero with an animated green-wave corridor SVG (CSS keyframes, one shared 8s loop; reduced motion pauses on a mid-run frame).
- [x] Destination cards: icons, `go`-tinted hover (fine pointers only), `pressable`, 40–60ms stagger on first load.
- [x] "Return to … simulation" as a live status pill with a pulsing dot.
- [x] Tool links (Diagnostics, Driver) and the simulation disclaimer restyled.

### 3. Workspace chrome (done)

Skills: emil-design-eng, mobile-native.

- [x] Header: segmented pill navigation, aligned theme toggle (sliding thumb), compact icon + label Details/Focus buttons (44px on coarse pointers).
- [x] Map overlays ("Show route", "Resume following", zoom controls) as frosted floating controls.
- [x] Provenance pill sits above the map attribution (and lifts over the expanded compact attribution on narrow maps).
- [x] Follow-up (done in milestone 5): in replay the provenance pill becomes a footer under the transport bar.
- [x] MapLibre controls follow the tokens.

### 4. Inspector / HUD (done)

Skills: emil-design-eng, find-animation-opportunities.

- [x] Consistent section cards and type scale across DispatchForm and its controls (vehicle type, location, density, cascade, playback speed, primary CTA).
- [x] KpiHeader: large tabular numbers; status and connection chips on semantic tokens.
- [x] Run panel and Stop button on `emergency` tokens.
- [x] IntersectionList: status chips; TTI bar animated via `transform: scaleX` with a linear transition lasting one tick (follows playback speed); "View JSON" demoted to a quiet inline action.
- [x] Shared `hud-*` vocabulary in `@layer components` (panel, head, icon, segmented, input, range, switch, primary/secondary/danger, alert, chip, value) with `tone-*` modifiers.
- [x] RunSummary (finished moment may get a subtle entrance), DataQualityPanel, StationRanking, PreviousRunCard.

### 5. Sub-screens (done, awaiting human commit)

Skills: emil-design-eng.

- [x] Comparison: pane titles, transport bar, timeline slider, preparation card.
- [x] Diagnostics: the six steps as one connected flow; endpoint activity cards.
- [x] Driver status card.
- [x] JSON dialog: centred `.96 → 1` entrance and backdrop fade.

- [x] Fix: transparent colour-mixes use sRGB (OKLCH mixing with `transparent` produced a powerless hue that rendered reddish).
- [x] Eyebrow and label styles unified app-wide (sentence case, 12px).

### 6. Polish pass

Skills: mobile-native, break-ui, review-animations, verification-before-completion.

- [ ] Phone layouts and safe areas; touch hover states.
- [ ] Worst-case data (long names, many signals, missing fields).
- [ ] Animation review: easing, durations, interruptibility, reduced motion.
- [ ] Final light/dark/reduced-motion screenshots of every screen; all checks green.
