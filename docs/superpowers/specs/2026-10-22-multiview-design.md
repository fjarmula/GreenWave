# Multi-view simulation workspace: design

## Intent and status

Turn the official `frontend/` single-view dashboard into a map-first, multi-route simulation application. The user approved preparing the detailed planning package on 2026-10-22; this package does not itself record implementation approval or authorize product-code changes. Route names in the original request are examples. The implementation agent has discretion within the boundaries below.

Success means that choosing a mode, inspecting a run, comparing outcomes, understanding endpoint activity and opening a phone-oriented view each have a clear place. Avoid decorative dashboard clutter, tiny uppercase text, unnecessary animations and overlapping glass panels.

## Repository baseline

Inspected on 2026-10-22, with a clean working tree. `app/page.tsx` renders `Dashboard`; `app/layout.tsx` already mounts `SimulationProvider`. `Dashboard` owns dispatch, stations, setup/live presentation and `useSimulationStream`; `DispatchForm` owns settings. The stream hook owns a subscription effect. Reducer/controller boundaries and mock/backend adapters already exist. `MapContainer` consumes root context directly; `VehicleMarker` interpolates positions and `useRouteFit` fits per run.

The live-run Stop work from the repository audit is implemented: preserve `stopRequested`, `stopError`, stop confirmation, failed-stop retry and retained terminal summaries. Do not regress it to an immediate reset. Consult the current code rather than treating pending audit descriptions as completed work.

Both transports currently allow one active run per adapter/backend manager. Backend start supersedes the previous active run. SSE reconnect supplies the latest snapshot, not a full history. Mock motion is synthetic and must remain labelled accordingly.

## Goals

- Six distinct destinations: menu, enabled simulation, disabled simulation, comparison, endpoint diagnostics and driver presentation.
- A shared in-memory scenario and a persistent single subscription across client navigation.
- Viewport-bound simulation/compare layouts and reversible Focus Mode.
- Automatic vehicle following at detail zoom, with explicit user control.
- Honest, synchronized comparison using recordings of the same scenario.
- Mobile accessibility and keyboard access throughout.

## Global constraints

- Simulation only; never add real signal actuation. Keep simulated values visibly labelled; UI copy stays English.
- Node 22+, existing Next.js App Router, React, strict TypeScript, Tailwind, Base UI/shadcn, MapLibre and Vitest. No dependency or lockfile changes without explicit approval.
- Pydantic schemas are canonical; generated contracts are never hand-edited. This programme does not change backend lifecycle or public contracts.
- Simulation and comparison shells use `height: 100vh; height: 100dvh; overflow: hidden`; only bounded panels/lists may scroll. Preserve browser zoom and access to content at enlarged text sizes.
- HUD stays outside the map rendering boundary. Preserve light/dark themes, telemetry validation, explicit Stop and terminal summaries.
- Git follows AGENTS.md: explicit paths only; no branch operations, push or PR without explicit authorization. Notify the human before changing AGENTS.md or GreenWave_ARCHITECTURE.md.
- Browser work uses @playwright/cli through bash; read playwright-cli skill first. No DOM/a11y tree dumps. All browser output stays under `.tmp/playwright/multiview/`.

## Information architecture and layout

Suggested routes: `/`, `/simulation/green-wave`, `/simulation/standard`, `/compare`, `/diagnostics`, `/driver`. Names and grouping may change before routing implementation; record the final map in the master and update every link/test together. Distinct enabled and disabled destinations remain mandatory. Avoid aliases unless a real existing bookmark requires them.

The menu is restrained: three primary mode choices, secondary diagnostic and driver links. Use Next Link and normal navigation semantics. Deep links open useful setup or empty states without automatically starting a run.

The recommended desktop workspace is a compact header, a dominant map and one collapsible inspector. Dispatch, Intersections and Events can be tabs or another equally compact progressive-disclosure arrangement. One primary action per state. Dataset detail belongs in diagnostics. On phones, use an accessible details sheet rather than stacking HUD blocks below the map. Home/diagnostics may scroll when necessary; simulation and comparison must not acquire document scrolling.

Focus Mode hides application navigation, KPI panels, inspectors and ornamental map overlays. Vehicle, route and relevant simulated signal layers remain map content. Keep required attribution/provenance and a small accessible Exit Focus control; this is the deliberate exception to literal map-only presentation. Escape exits Focus Mode when no nested dialog owns Escape. Hidden controls leave the tab order and pointer hit testing. Restore focus to the trigger. Focus must not stop a run or recreate its map.

## State and navigation lifecycle

Keep the reducer and transport boundary. A persistent runtime owns start, stop and the sole subscription. Scenario ownership moves above route pages and contains the incident, vehicle selection, ranking, dispatch settings and station loading. Reuse existing dispatch controller cancellation/stale-result logic.

Ordinary navigation never starts, stops, resets or changes a run's mode. On a destination for another mode, show its setup and clearly identify any active run; require an explicit replacement action before a new start. Home and diagnostics can show a compact active-run return action. Returning to the same mode or driver continues its run. Snapshot the run's labels/endpoints so editing a draft cannot relabel an existing run.

Keep view preferences separate from telemetry. No new persistence service, local-storage telemetry or cross-device synchronization. Reload returns to setup and does not automatically reconnect, start or stop an unknown server run. Retain the last successfully finished summary in memory; stopped/failed runs do not replace it. Reuse audit M3 if implemented by execution time.

One map instance must survive setup/live, focus and inspector changes within a mounted workspace. A route change may remount a map, but must preserve the run and subscription. Do not build a hidden permanent map solely to preserve GPU resources across unrelated routes.

## Camera policy

Overview fits valid route geometry once per run; defer fitting until dimensions and style are usable. Focus/inspector changes update map size and visible-area padding without unconditional refitting. Setup clicks preserve user zoom; explicit fit and off-screen endpoints remain available.

Planning defaults: enter automatic follow at zoom >16.5; return to overview at zoom <16.0. Between these bounds keep the current state. A deliberate pan suspends automatic follow until Resume following or a fresh overview-to-detail zoom crossing. Programmatic camera changes never masquerade as user input. Follow retains zoom and north-up orientation. Show route exits follow and fits the route.

Camera and marker use the same displayed/interpolated position. Do not run competing frame loops or rerender the full React tree per animation frame. Stale telemetry freezes follow at the last received position; terminal state cancels animation and leaves a coherent final frame. Reduced motion removes camera tweening. The agent may tune thresholds and movement durations after browser evaluation, recording the values and reasons; automatic detail-zoom following and manual override are mandatory.

## Comparison model

Recommended scope is sequential capture followed by synchronized replay, respecting the single-active-run contract. The interface must say recording/replay, never imply two live streams. Simultaneous live comparison is a separate backend architecture decision requiring human approval.

Freeze origin, destination, chosen station, vehicle, density and cascade preference once per pair. Only mode and run id differ; the disabled engine ignores cascade according to its existing contract. Capture enabled to successful completion, then disabled. Use existing supported playback speeds, with 10x as the suggested recording default. Starting a comparison while a live run exists requires explicit replacement. Recording belongs to the persistent runtime and may continue while navigating; Cancel explicitly stops capture and prevents the second start, including when a pending start resolves late.

Capture validated start responses, ordered ticks, dispatches and terminals. Do not reconstruct simulation motion/signals in presentation. A complete recording requires tick 1 through the final terminal tick with no missing simulated seconds and a successful completion terminal. A reconnect alone is not failure if coverage stays complete; gaps, start failures, cancellations or mismatched geometry/settings make the pair incomplete. Show the reason and a retry action. No fabricated missing frames or silent mock fallback.

Keep one pair in memory with a planning cap of 10,000 tick frames per mode and 32 MiB serialized pair data; overflow cancels capture with a clear error. These frontend limits may be adjusted with measured evidence and documented rationale. Clear discarded buffers. Do not retain arbitrary historical pairs.

Replay is driven by elapsed simulated seconds, supports play/pause/restart/scrub and freezes at its current cursor when hidden rather than jumping ahead. Hold an arrived vehicle at its destination while the other continues; distinguish arrival time from final recovery/completion time. Show total completion travel-time metrics using existing domain presentation, and label any separately calculated arrival metric precisely. Actual mode-to-mode difference comes from the two completed runs, never the preflight estimate or current_time_saved_sec treated as an actual pair delta.

Desktop has two equal panes; small screens show one map with an enabled/disabled toggle retaining the same cursor. Comparison opens in dispatch setup with the same map, destination and settings controls as the individual simulation views. After sequential preparation, both recordings start playing automatically at the selected replay speed; desktop shows two full-width panes with results initially collapsed. Focus remains available through the explicit control. Pane labels, replay provenance and attribution remain legible. Overview camera linking is optional; follow must center each pane on its own vehicle. No recursive camera event loops.

## Diagnostics

Show stations/geocode → ranking → start → SSE → validation/state → map/HUD, plus stop, dataset quality and simulated ITS dispatch. The latter is an internal simulated gateway/event, not an outbound traffic-controller HTTP request.

Separate the static architecture explanation from observations in this browser session. Observe adapter operations and subscription events without monkey-patching global fetch/EventSource or adding requests just to make nodes look active. Record operation, outcome, measurable browser duration, tick and connection state; no invented server timings. Label mock execution synthetic and unused operations Not observed.

Use an in-memory ring of at most 200 entries. Never store raw addresses, coordinates, full URLs with queries, request/response bodies or uncontrolled error messages. Use an allowlist of operation/status fields. Sampling/coalescing repetitive ticks is allowed; retain terminal/failure visibility and label sampled counts. Diagnostics must not block stream delivery.

## Driver and visual craft

Driver uses the enabled run in the same browser session; this is a mobile simulation presentation, not real navigation or a claim of verified signal safety. No geolocation, routing instructions or live road-control behavior is added.

Prioritize map, vehicle status, speed, elapsed time, stale/connection feedback and follow/recenter. Put secondary settings and lists behind Details. Maintain an accessible Stop action while running, including a recoverable failed-stop state. Focus Mode may hide status/controls until exited. Use safe-area insets, input text >=16px for coarse pointers, touch targets >=44px for primary controls, appropriate touch-action on controls without breaking map gestures, and browser zoom. Test portrait, landscape and keyboard-open states.

Preserve Geist and the existing theme system. Agent chooses spacing, inspector side/width, responsive breakpoints, compact icons, radii, borders and shadows. Use color semantically; status also has text/icon cues. Favor short, interruptible transform/opacity transitions, reduced motion, immediate keyboard interactions and hover styles gated by pointer capability. No animation dependency or visual decoration project is necessary.

## Delegated choices and consultation boundary

Agent may rename routes and modules coherently; choose composition, inspector tabs/disclosures, responsive breakpoints, small visual refinements and pure helper APIs; tune documented frontend camera/capture limits after measurement. Proposed file names in plans are the starting map, not an obligation to create unnecessary wrappers. Update downstream references when changing an interface.

Consult the human before materially replacing the map-first/single-inspector structure, changing comparison from replay to concurrent live sessions, removing distinct destinations or Focus Mode, adding dependencies or storage, expanding backend/public contracts, or changing navigation into implicit run replacement. Do not seek permission for routine choices within this design.

## Acceptance and review ownership

R1–R7 subplans own state, routing, shell, camera, comparison, diagnostics, and driver/closeout respectively. Each has behavior tests and browser acceptance. The master is the single implementation status record; historical audit plans are not automatically marked complete by this programme.


## Implementation choices — 2026-10-22

Execution was authorized after this design package. The six suggested routes were selected unchanged.
Root runtime/scenario/comparison providers retain browser-session ownership; the shared viewport shell
uses one bounded nonmodal inspector on phones. Comparison uses the common event-tick clock, with
final reported travel time distinguished from observed arrival and recovery completion. Capture limits
remain 10,000 frames per mode and 32 MiB per pair, conservatively counting serialized structure.
The master plan records the software verification and physical-device checks still outstanding.
