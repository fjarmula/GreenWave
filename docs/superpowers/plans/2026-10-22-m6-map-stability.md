# M6 — Map Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development). Steps use checkbox (`- [ ]`) syntax. Master: `2026-10-22-repo-audit-master.md` (findings F4, F6, F15; decision D3). Requires M2 and M3.

**Goal:** One MapLibre instance lives for the whole page session. Picking an incident does not throw away the user's zoom. Fits never run against a zero-size container.

**Architecture:**
- **One map instance:** `Dashboard` renders setup and live inside the same `<section>` element and gives `RoutePreview` a stable `key="route-preview"`. Only class names and the conditional `DispatchForm` sibling change, so React keeps the `MapContainer` subtree and its `useMaplibreMap` instance.
- **Fit decision:** a pure `endpointFitDecision({points, viewBounds, focusRequested})` in `src/components/map/endpoint-fit.ts` returns `"none"` or `"fit"`. It fits when the user pressed "View station and incident" (animated 600 ms), or when an endpoint changed and at least one endpoint lies outside the current view bounds (animated, instant under reduced motion). Otherwise nothing moves. `maxZoom` stays 13.2 / 14 for the fits that do run.
- **Size guard:** `EndpointMarkers` and `useRouteFit` skip `fitBounds` when the container's `clientWidth` or `clientHeight` is 0.

**Tech stack:** React 19, MapLibre GL, Vitest, `playwright-cli`.

## Root cause

- `dashboard.tsx` renders `<section>…<RoutePreview/></section>` in setup and a bare `<RoutePreview/>` in live mode. The element type at that tree position changes, so React unmounts the subtree, `useMaplibreMap` calls `instance.remove()`, and the style is downloaded again ("Loading map tiles…").
- `EndpointMarkers.tsx:63` re-fits on every endpoint coordinate change with `maxZoom 13.2` and `duration: 0` whenever no focus request has been made.
- An overflowing 320 px layout produced `Invalid LngLat (NaN, NaN)` from `fitBounds` (2026-10-21 master, item 2).

## File map

- `frontend/src/components/dashboard.tsx`: stable section and key.
- `frontend/src/components/dashboard/RoutePreview.tsx`: no structural change expected; verify that the outer `<section>` and map wrapper `<div>` are the same element types in both modes.
- `frontend/src/components/map/endpoint-fit.ts` (new, + `.test.ts`).
- `frontend/src/components/map/EndpointMarkers.tsx`: use the decision and the size guard; read bounds with `map.getBounds()`.
- `frontend/src/components/map/useRouteFit.ts`: size guard.
- New `frontend/src/components/dashboard-map-lifecycle.test.tsx`: mock `@/components/map/MapContainer` with a component that counts mounts and unmounts.

## Tasks

### Task 1: One map instance across modes

- [ ] RED: render `Dashboard` with the mock adapters, start a run (the mock start resolves), finish or stop it, and go back to setup. The `MapContainer` mock must report exactly one mount and zero unmounts.
- [ ] GREEN: restructure; update the Dashboard snapshots (word diff: wrapper classes only).

### Task 2: Fit decision

- [ ] RED (`endpoint-fit.test.ts`):
  - both points inside the view → `none`;
  - one point outside → `fit`;
  - focus requested with both inside → `fit`;
  - no points → `none`;
  - a point exactly on the bound counts as inside.
- [ ] GREEN; wire it into `EndpointMarkers` (track the last applied `focusRequest` in a ref so a re-render does not re-fit).

### Task 3: Size guard

- [ ] RED: a unit test with a fake map whose container is 0 × 0, for both `EndpointMarkers`' effect helper and `useRouteFit`; extract a small `canFit(map)` helper if that makes it testable. `fitBounds` is not called.
- [ ] GREEN; frontend gate; `graphify update .`.

### Task 4: Browser acceptance

- [ ] Mock production build and real backend, 1440 × 1000:
  - zoom to 16, click a street → zoom stays 16 and the incident marker appears where clicked;
  - pick an address far outside the view → the map animates to include it;
  - start a run → no "Loading map tiles…" overlay;
  - Network panel or `performance.getEntriesByType('resource')` shows the style JSON fetched once per theme;
  - back to setup → the same.
- [ ] 320 × 720 and 390 × 844: no console errors.
- [ ] Evidence under `.tmp/playwright/repo-audit/m6/`.

## Acceptance

- Exactly one map construction per page load and theme; no remount on mode changes.
- Map clicks never move the camera; explicit focus and off-screen endpoints still fit.
- Frontend gate green.
