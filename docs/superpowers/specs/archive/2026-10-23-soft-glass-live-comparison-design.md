# Soft Glass, driver sheet, rolling corridor and live comparison: design

Date: 2026-10-23. Branch: `feat/night-corridor-theme` (follows the UI overhaul plan `docs/superpowers/plans/2026-10-23-ui-overhaul.md`).
Brainstorm mockups (local, untracked): `.superpowers/brainstorm/19135-1792746801/content/` — `map-style.html` (option B chosen), `comparison-live.html`, `theme-directions-2.html` (G "Soft Glass" chosen), `driver-soft-glass.html` (approved).

## Intent

The app works, but it does not yet sell the idea. The human wants the contest demo to make the green corridor obvious and pleasant to watch:

- the vehicle in corridor mode must visibly *flow* through junctions, never stop at a cleared light;
- the comparison must be watched **live**, both runs at once, so the time saved is felt, not replayed;
- the whole app should look like a calm, premium consumer product ("Soft Glass", Apple-Maps-like), with the map in the visual language of the home animation the human already loves;
- the driver screen must put the map first once a run starts.

## Projects (independent, in this order)

| # | Project | Touches |
|---|---|---|
| P1 | Quick fixes: JSON dialog response-only; rolling corridor motion | frontend diagnostics; backend motion, mock session, architecture doc |
| P2 | Soft Glass visual system and map restyle | frontend tokens, components, map layers |
| P3 | Driver sheet | frontend driver/workspace shell |
| P4 | Live comparison | backend session manager + contract (ADR), frontend comparison |

P3 depends on P2's sheet/material primitives. P4's UI uses P2's look but its backend/controller work can start in parallel with P2. P1 has no dependencies.

## Goals

1. JSON dialog shows the response only.
2. Corridor-mode vehicle never drops to 0 km/h at a cleared junction; standard mode unchanged.
3. Every screen uses Soft Glass, light and dark.
4. Main map: real basemap recoloured to Soft Glass; corridor drawn in the home-animation language.
5. Driver: once started, the map dominates; settings are one tap away, not on screen.
6. Comparison: one click starts both runs live and simultaneously; ends on a result card.

## Non-goals

- No replay, scrubbing or "watch again" in comparison (explicitly declined). The recording/replay code path is removed, not kept beside the live one.
- No change to route choice, signal programme, priority state machine, or `T_greenwave` / `T_normal` estimates.
- No new npm/Python dependencies, no lockfile changes (repo rule). The bottom sheet, glass and map styling are hand-built.
- No real signal actuation (project rule).

## Anti-goals (failure even if it "works")

- The corridor vehicle still visibly halts at green lights, or trip time / time-saved numbers change.
- The two comparison vehicles drift apart in simulated time (one pane ahead of the other's clock), making the race dishonest.
- Soft Glass that reads as a generic template: glow, coloured shadows, gradients-for-decoration (the overhaul already removed these; do not reintroduce).
- Map labels or route unreadable over glass sheets; glass panels hiding the vehicle.
- Light/dark switching regresses (the human calls it seamless now; keep the view-transition mechanism from the overhaul untouched).

## Constraints

- AGENTS.md rules: graph-first navigation, TDD, Playwright via `@playwright/cli` with output under `.tmp/playwright/`, explicit-path staging, commit subject `<category>: <message>`.
- Pydantic schemas canonical; regenerate `contracts/openapi.json` and `frontend/src/types/api.generated.ts` after schema change.
- `GreenWave_ARCHITECTURE.md` changes (P1 motion, P4 concurrency) are **pre-approved by the human in this brainstorm**; still state them in the milestone report.
- Contract `contract-v1` is frozen (ADR 0003): P4 needs a new ADR (0008) for an additive change.
- Mock transport remains the default and must reach parity for P1 motion and P4 comparison.
- Overhaul constraints still apply: signal colour semantics (go/caution/emergency/cascade/beacon), ≥ 4.5:1 text contrast in both themes, 44px coarse-pointer targets, `100dvh` shells, motion ≤ 250ms on UI, only transform/opacity animate, reduced-motion respected.

---

## P1a. JSON dialog: response only

`frontend/src/components/diagnostics/JsonDetails.tsx`: the request body is already shown at the top of the dialog; the Request/Response switch is useless. Remove the `side` state and the switch; always show the response body (with its existing "omitted" and empty states). Copy copies the response. Update `endpoint-json.test.tsx`.

## P1b. Rolling corridor (no stop at cleared lights)

**Cause.** `backend/src/greenwave/simulation/motion.py` (`move_one_second`): in ENABLED mode the vehicle reaches each intersection's first stop line, dwells `min_intersection_delay_seconds` (`D_min`, default 3 s) at 0 km/h, then holds until every route light there was shown green. Documented in `GreenWave_ARCHITECTURE.md` §2 (line ~137).

**Decision (human-approved).** Keep `D_min` per intersection in the trip time, but spend it as a slowdown, not a stop:

- Over an approach window before the first stop line (setting `greenwave_approach_distance_m`, default 60 m, clamped to the distance actually available after the previous stop line / route start), the vehicle drives at a constant reduced speed such that the window takes exactly `L/v + D_min`. Reuse `cautious_speed_mps` (same formula the disabled crossing uses), across edge ends.
- Trip time stays `T_greenwave`, so estimates, `current_time_saved_sec`, golden tick expectations for arrival time and the comparison remain honest. Positions over time change (golden motion fixtures are regenerated deliberately and reviewed).
- **Safety hold stays:** if at the stop line a route light was not last shown green, the vehicle waits at the line (as today). That is the only case it may show 0 km/h. With priority normally green long before arrival, this is rare.
- `AmbulanceStatus.CROSSING_INTERSECTION` covers the slowdown window and any hold (today it covers dwell/hold).
- **Rolling floor (my call):** the slowdown never goes below `greenwave_min_rolling_speed_kmh` (default 15 km/h). When the available window (short gap after the previous junction, or route start) cannot absorb all of `D_min` at or above the floor, the remainder is spent past the stop line, through the junction, at the same floor speed until it is used up. The vehicle therefore never stops for `D_min`; trip time is still exactly `T_greenwave`. Only the safety hold below can show 0 km/h.
- Mock parity: `frontend/src/lib/mock-session.ts` precomputes legs; add the same reduced-speed leg before each first stop line in ENABLED mode so mock trip time also includes `D_min` the same way. Check `mock-simulation-adapter.golden.test.ts` expectations.
- Update `GreenWave_ARCHITECTURE.md` §2 paragraph on the dwell, and `docs/engineering/domain-invariants.md` if it mentions the dwell.

Builder's call: exact setting name; whether the window is measured to the first stop line or to the intersection's `distance_along_route_m` (they are the same field per schema comment).

---

## P2. Soft Glass visual system

Reference mockups: `theme-directions-2.html` card G (light), `driver-soft-glass.html`.

**Character.** Calm, premium, consumer-grade (Apple Maps). Light and airy; large rounded sheets of frosted glass floating over a full-bleed map; friendly sentence-case copy ("41 s faster", "Green in 180 m"); big confident numerals; generous radii. Dark theme: the same structure in graphite glass (dark translucent sheets, near-neutral graphite background), not navy.

**Tokens** (refine the overhaul's scale in `frontend/src/app/globals.css`, keep shadcn aliases):

- Radii: sheet 22–24px, card/inner tile 12–14px, control 10–12px, pill full. Replaces the overhaul's 6/8/12 scale.
- Materials: one `surface-glass` utility (light: white ~80–85% + `backdrop-filter: blur(20px) saturate(1.6)` + 1px inner top highlight + soft neutral drop shadow; dark: graphite ~70% with the same blur, hairline `oklch(1 0 0 / 8%)` ring). Inner tiles are opaque `surface-1` (`#f3f5f8`-like light).
- Accent: the existing `go` green stays the single UI accent (primary buttons, "faster" pills). Signal colour semantics unchanged.
- Type: keep Geist; display numerals 28–40px semibold, tracking −0.03/−0.04em, `tabular-nums`. Mono only for IDs (`INT-0167`) and raw telemetry.
- Shadows only on floating glass; in-flow surfaces flat. No glow except the signal lamp halo and vehicle pulse on the map.
- Motion: sheets open/close with the iOS drawer curve `cubic-bezier(0.32, 0.72, 0, 1)` 300–400ms (sheet is the one allowed >250ms, as a drawer); everything else per overhaul motion spec.

**Layout.** Simulation workspaces become map-first: the map fills the viewport; header, inspector and status float as glass over it. Desktop: the inspector is a floating glass panel (left or right, builder's call, consistent across routes) instead of a docked column; it can collapse. Phone: the inspector is the bottom sheet (P3 builds the sheet; P2 applies it to Green Wave/Standard too once available — or P2 uses the floating panel on desktop only and P3 brings the sheet to all phone layouts; builder sequences).

**Screens.** Home (keep structure and the corridor animation, restyle to Soft Glass palette and radii), Green Wave, Standard, Driver, Comparison, Diagnostics. Diagnostics stays a document-like page (no map), Soft Glass cards.

### Map restyle (option B, human-chosen)

- Keep the CARTO vector basemaps (positron/dark-matter) but **recolour at runtime** after `style.load` via `setPaintProperty`/`setLayoutProperty`, from a theme-aware basemap palette next to `components/map/map-palette.ts`. Light: pale grey ground, white streets cased by a faint grey, pale blue water, soft green parks, muted labels. Dark: graphite ground, slightly lighter streets, deep blue-grey water, dim green parks. Hide POI icon layers that add noise.
- Must work with the overhaul's theme barrier: recolouring happens before the barrier resolves so the first new frame is already restyled.
- **Corridor in home-animation language:**
  - Route: white-cased road with the `go` line on top (light), dark casing in dark; standard mode uses a neutral line.
  - Signals: lamp dots — red (not cleared), green with soft halo when priority green; caution/cascade colours where the state machine says so. Short "post" is a builder's call if it reads at map zoom.
  - Vehicle: white dot, red ring, 1.2s pulse ring, green wake trailing along the route behind it (corridor mode only).
  - Labels: `INT-xxxx` mono on glass chips.
- Existing marker files (`SignalMarkers.tsx`, `RouteLayer.tsx`, vehicle marker, `EndpointMarkers.tsx`, `StationLayer.tsx`) are restyled, not rewritten; layer ids and data flow unchanged.

---

## P3. Driver sheet

Reference: `driver-soft-glass.html` (approved).

Current problem (screenshot `.tmp/playwright/brainstorm/driver-live-phone.png`): after "Initialize green corridor" the phone shows the status card over the map *and* the full inspector below it (two Stop buttons); on desktop the inspector column stays open.

Behaviour:

- **Setup:** bottom sheet (phone) / floating panel (desktop) titled "Where's the incident?" with address field, vehicle segmented control, a one-line summary of simulation parameters ("Traffic 1.5× · Cascade on · 1× speed ›") that expands to the full dispatch settings, and the primary "Initialize green corridor".
- **On start:** the sheet collapses automatically to a compact card: speed (big), ETA, a "41 s faster · simulated" pill, and a single round Stop button. The full dispatch settings leave the screen.
- **Next signal card** at the top: lamp + "Green in 180 m" + intersection name (from the next unpassed route intersection, its state and distance).
- **Dispatch settings** reopen only from a small glass chip ("Dispatch settings"); while running they are read-only or show the active run's settings (builder's call; must not start a second run silently).
- **Drag up** the compact card to reveal route signals (`IntersectionList`) and details; drag down/flick to collapse. Velocity-based dismissal, pointer capture, damping at bounds; keyboard and screen-reader accessible (the grabber is a button toggling expanded state; Escape collapses).
- Desktop: same states; the panel shrinks to the compact floating card on start and expands on click.
- Only one Stop control exists in any state.
- Terminal (arrived/cancelled): compact card shows the result and "Back to setup".

---

## P4. Live comparison

**Today.** `/compare` records ENABLED then DISABLED sequentially through the single operation slot (`frontend/src/lib/comparison/*`), then replays. Backend `SessionManager` (`backend/src/greenwave/simulation/session.py`) allows one active run; a new start supersedes it.

**Decision (my call, presented to and accepted by the human as "live, both at once, keep the two-pane look, result card at end").**

Backend:

- New ADR `docs/adr/0008-live-comparison-pair.md`: additive to contract v1.
- New endpoint `POST /api/v1/simulation/compare/start` taking one scenario (the existing start-request fields minus `green_wave_mode`, plus two client-chosen ids or one id from which both are derived — builder's call) and returning both start responses (routes). Both modes plan the same route (they already do: route choice is mode-independent).
- `SessionManager` treats the pair as **one active operation**: starting any other run or another pair supersedes both; stopping either id stops both (builder's call whether stop-one stops both; recommended both, to keep the race fair).
- **Lockstep:** both engines are advanced by one shared loop task: each wall-clock interval advances both by the same simulated seconds and publishes both ticks, so pane clocks never diverge. A pair member that has arrived keeps emitting nothing further but the pair continues until both terminals.
- Each run keeps its own `simulation_id` and is streamed by the existing `GET .../{id}/stream` SSE endpoint; tick/terminal schemas unchanged.

Frontend:

- `SimulationAdapter` gains `startComparison(request)`; backend adapter calls the new endpoint, mock adapter runs two mock sessions on one timer (lockstep).
- Comparison controller (rewrite of `comparison-controller.ts`) owns the operation slot, starts the pair, subscribes to both streams, exposes live state per mode, handles cancel/error/terminal for both. Remove `recording.ts`, `replay.ts`, `ComparisonReplay` replay clock and their tests; keep useful pieces (e.g. `completionDelta`, render-snapshot plumbing) where they still apply.
- UI (Soft Glass): two equal map panes on desktop, each labelled (Green Wave / Standard traffic) with speed and distance left; one map with a mode toggle on phone. Below the maps, a shared **progress bar** of both vehicles along the route.
- **Live readout (my call, honesty):** distance lead only, measured, never a projected time: "Green Wave ahead by 0.7 km", "Standard traffic ahead by 120 m" or "Level". After the first vehicle arrives: "Green Wave arrived · standard traffic 0.4 km behind". No live seconds figure, so nothing during the race can contradict the result card.
- **Either mode may lead or win.** After P1b the Green Wave vehicle slows at every junction while standard drives through greens at full speed, so standard can lead mid-race and, on routes with few red lights, can arrive first. The UI states it neutrally both ways; no demo steering of routes.
- When both have arrived: **result card** — both actual arrival times, the actual difference (`completionDelta`, existing `comparisonResultLabel` wording for faster/slower/same), and signals given priority — and "New comparison". No replay. `current_time_saved_sec` (vs the `T_normal` estimate) is not shown on the comparison screen, to avoid two different "saved" numbers.
- **Signals given priority (my call, no contract change):** derived on the client from the Green Wave run's ticks: count of route intersections that reached `PRIORITY_GREEN`, out of the route total.
- Playback speed: uses the setup's playback speed (default 10× for comparison as today's preparation used; builder's call to keep the setup's selection).

---

## Left to the builder

Setting names; desktop inspector side; whether P2's phone layouts wait for P3's sheet; signal "post" rendering; exact palette values (must pass the overhaul's contrast test); compare endpoint id scheme; stop-one-stops-both (recommended yes); read-only vs editable settings while running; test file organisation; milestone grouping inside each plan.
