# R4 — Coordinated Map Camera Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development if chosen by the human). Steps use checkbox syntax. Master: [multi-view programme](2026-10-22-multiview-master.md). Requires R3.

**Goal:** Automatically follow the displayed emergency vehicle at detail zoom while preserving deliberate user navigation.

**Architecture:** One camera policy coordinates route fitting, detail follow and manual suspension. VehicleMarker exposes its displayed position to that policy; frame updates stay outside React state. Visible-area padding comes from R3.

**Tech Stack:** Existing Next.js App Router, React, TypeScript, Tailwind/Base UI, MapLibre, Vitest and @playwright/cli; Node 22+.

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

- Threshold jitter must not switch follow repeatedly (Task 1).
- User pan and programmatic motion must be distinguishable (Task 1).
- Hidden/zero-size containers and style swaps must not yield invalid fit bounds (Task 1).
- 10x playback must keep camera and marker aligned without duplicate frame loops (Task 2).
- Stale/terminal/unmount must freeze or clean up camera work (Task 2).

---

## File map and interfaces

- Create `frontend/src/lib/camera-policy.ts` and `.test.ts`: proposed `nextCameraMode(current, event)` returning `overview | following | suspended`; events cover user zoom/pan, show-route, resume and run change. Add `canFit`/padding helpers only if existing audit helpers do not already provide them.
- Create `frontend/src/components/map/useMapCamera.ts`; modify `useRouteFit.ts`, `EndpointMarkers.tsx`, `VehicleMarker.tsx`, `MapContainer.tsx` and `lib/marker-slide.ts` only as needed to expose displayed coordinates.
- Suggested `VehicleMarker` addition: `onDisplayedPosition?: (position: [number, number]) => void`; callback/ref never dispatches telemetry or sets per-frame React state. Camera hook consumes map, geometry, displayed-position source, stale/terminal status and visible padding.
- Tests: `camera-policy.test.ts`, existing `marker-slide.test.ts`, and proposed `components/map/map-camera.test.ts` with a fake map. Avoid calling browser-only map constructors in node tests.

## Task 1: Camera policy and fitting

- [ ] RED: at zoom 16.5 overview remains; >16.5 follows; following at 16.0 stays; <16.0 exits; user pan suspends; programmatic events do not suspend; Resume follows; Show route exits follow; new run resets overview. Explicit fit consumes once, zero-size containers defer safely, endpoint clicks preserve zoom when already in view.
- [ ] Run `cd frontend && npm test -- src/lib/camera-policy.test.ts src/components/map/map-camera.test.ts`; observe RED.
- [ ] GREEN: integrate one policy writer and remove competing fits. Preserve audit M6 endpoint behavior. Resize/padding updates keep current view unless an explicit fit/new run requests otherwise. Tune only documented UI defaults after evidence.
- [ ] Rerun focused tests; fake map asserts fit/jump/ease calls have finite coordinates and valid padding.

## Task 2: Display-position follow and cleanup

- [ ] RED: marker/camera helper tests assert callback coordinates equal shown marker coordinates, stale state cancels follow work, terminal prevents later frames, cleanup removes listeners/frames, reduced motion uses immediate updates and no tween.
- [ ] Run the camera tests plus `npm test -- src/lib/marker-slide.test.ts`; observe RED, wire the displayed-position source, rerun GREEN.
- [ ] Browser both transports at 1x and 10x: zoom past threshold, follow a signal-bearing route, pan/suspend/resume, zoom out/show-route, toggle focus/inspector/theme, interrupt telemetry, stop and complete. Check vehicle stays inside the usable map area while following and no fighting/jumping after manual intervention.
- [ ] Record actual thresholds/durations and evidence under `.tmp/playwright/multiview/r4/`. Do not claim measured performance improvement without frame/runtime evidence.

## Milestone closeout

- [x] Run the full frontend gate listed in the master; require exit 0 or explicitly record any baseline blocker without claiming completion.
- [x] Run `git diff --check`; inspect snapshots and focused diff for unrelated changes.
- [x] Record acceptance evidence, actual file/interface choices and deviations in the master. Propose its listed Conventional Commit; do not perform branch/push/PR operations.


Implementation closeout: see the master completion record for the actual interfaces, tests, browser artifacts and verification limits. The original task checklist is preserved as the detailed planning baseline; programme status is maintained only in the master.
