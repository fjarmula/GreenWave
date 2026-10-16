# Phase 2 · Frontend — Contract Migration and Backend Transport (Piotr)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Expand each task with superpowers:writing-plans before coding if a step leaves a choice open.

**Owner:** Piotr Lorek · **Branch:** `feature/frontend-integration` from tag `contract-v1` · **Worktree:** own worktree, never shared.

**Goal:** Make the dashboard consume the canonical v1 contract (generated types), add a real HTTP + SSE `SimulationAdapter` with validation, reconnection and terminal-event handling, and show real intersection positions — while the mock stays the default until Phase 3 flips the switch.

**Architecture:** Keep the existing seam: components and the reducer talk only to `SimulationAdapter`. Two implementations behind it — the existing mock (migrated to v1, kept forever as the offline demo fallback, D22) and a new backend adapter (`fetch` for start/stop, `EventSource` for the stream). A thin validation layer sits between the wire and the reducer (D23). Map rendering stays in `components/map/`, HUD in `components/hud/`.

**Tech Stack:** Next.js 16.4 (App Router — read `frontend/node_modules/next/dist/docs/` for client components and `NEXT_PUBLIC_*` env handling before Task F5; this version has breaking changes), React 19.3, TypeScript strict, MapLibre GL 6, vitest 5, `openapi-typescript` output in `src/types/api.generated.ts`.

**Spec:** `GreenWave_ARCHITECTURE.md` §4 + `docs/adr/0003-simulation-contract-v1.md` + `docs/superpowers/plans/2026-10-16-phase2-00-contract-freeze-and-coordination.md` (decisions D2–D23).

## Global Constraints

- You write **only** `frontend/**` excluding `frontend/src/types/api.generated.ts`. Never `npm run generate:types` on this branch unless coordination doc §5 produced a new contract tag and you rebased onto it (then the regenerated file is identical to `main`'s — commit nothing new there).
- Never `git add graphify-out`. Never edit root docs (`README.md`, `AGENTS.md`, `.agents/**`, architecture) — Phase 3.
- No `any`; `unknown` + guards at the wire boundary (`.agents/INSTRUCTIONS_REFERENCE.md` §5.2).
- Every UI string stays English and keeps the "simulated" labelling; never present signal states as real.
- `NEXT_PUBLIC_SIMULATION_TRANSPORT` default stays `mock` on this branch (D22). The backend adapter is exercised by tests and by local runs with the env var set.
- No new runtime dependency without asking (D23 decides validation without zod). Framer Motion etc. from `.agents/FRONTEND_DASHBOARD.md` "creative freedom" is welcome **only after** F1–F7 are green, and needs a one-line OK because it touches `package-lock.json`.
- Checks after every task: `npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`.

## Review Focus

1. **Backend not running / wrong URL** — start must fail fast with a readable "Simulation backend unreachable" state and a way back to setup; never an unhandled promise rejection or an infinite spinner. → F4, F6.
2. **Stream drops mid-run** (backend restart, laptop sleep) — show "Reconnecting…", resume on reconnect, and if the server answers 404 show "Simulation no longer exists" and stop; the ambulance must not keep animating on stale data. → F4, F6.
3. **Duplicate / out-of-order / foreign events** — an event with `id` ≤ last seen tick, or a different `simulation_id`, is dropped; unknown `event_type` is ignored, not a crash. → F3, F4.
4. **Superseded by another tab** — `SIMULATION_CANCELLED{SUPERSEDED}` shows a clear message; the tab does not auto-restart and does not fight the other tab. → F2, F6.
5. **Rapid start → back to setup → start** — the old stream is closed before the new one opens; no events from run 1 land in run 2 (React 19 Strict Mode double-effects included). → F2, F4.

---

## File structure

```
frontend/src/
  types/telemetry.ts        (MODIFY → thin aliases of api.generated.ts, no own wire shapes)
  lib/
    config.ts                         NEW  API base URL + transport choice (env, validated)
    simulation-adapter.ts   (MODIFY)  extended interface + env-based selection
    mock-simulation-adapter.ts (MODIFY) emits v1 events
    transport/
      validate.ts                     NEW  type guards for responses/events (D23)
      errors.ts                       NEW  typed adapter errors (ErrorResponse codes, network)
      backend-simulation-adapter.ts   NEW  fetch + EventSource
    simulation-state.ts     (MODIFY)  connection/terminal/error states, real ITS log
    useSimulationStream.ts  (MODIFY)
  components/
    hud/IntersectionList.tsx (MODIFY) is_cascade instead of CLEARING_CASCADE
    hud/ItsConsole.tsx       (MODIFY) real ITS_DISPATCH entries
    hud/KpiHeader.tsx        (MODIFY) status enum, connection badge
    hud/DispatchForm.tsx     (MODIFY) errors, playback speed (if D9), pending state
    hud/RunSummary.tsx       NEW      completed/cancelled summary
    map/SignalMarkers.tsx    (MODIFY) real positions from route_intersections
    map/MapContainer.tsx     (MODIFY) fit to route bounds; data attribution
    map/EndpointMarkers.tsx  (MODIFY) requested vs snapped endpoints
  .env.example               NEW
```

---

### Task F1: Migrate to the v1 contract (mock keeps working)

**Files:** Modify `src/types/telemetry.ts`, `src/lib/mock-simulation-adapter.ts`, `src/components/hud/IntersectionList.tsx`, `src/components/map/SignalMarkers.tsx`, `src/components/hud/KpiHeader.tsx`, `src/types/README.md`; Tests: existing `*.test.ts` updated.

**Interfaces:**
- Produces: `telemetry.ts` exports only aliases, e.g. `SimulationStartRequest = components["schemas"]["SimulationStartRequest"]`, likewise `SimulationStartResponse`, `SimulationTickEvent`, `ItsDispatchEvent`, `SimulationCompletedEvent`, `SimulationCancelledEvent`, `SimulationStreamEvent`, `IntersectionState`, `AmbulanceStatus`, `RouteIntersection`, `ErrorResponse`. Keep the old exported names (`SimulationTick`, `SignalState`, …) as aliases for one task so diffs stay small, then remove them in this same task once call sites compile.

- [ ] Remove `CLEARING_CASCADE` everywhere. Cascade is now `state: "CLEARING"` + `is_cascade: true`; keep the purple cascade visual, driven by the flag (`IntersectionList`, `SignalMarkers` colour map keyed by the 4 states + a cascade override).
- [ ] `ambulance.status` is the 4-value enum; `KpiHeader` formatting stays.
- [ ] Mock: emits `schema_version`, `is_simulated: true`, `simulation_id`; fills `route_intersections` with **plausible fixed sample positions** along its straight line and marks them synthetic in a code comment; uses the real `INT-0360`/`INT-0366` ids from the architecture example instead of `INT-302/303`; emits at least one `ITS_DISPATCH` when a sample intersection enters `CLEARING`, and `SIMULATION_COMPLETED` at the end.
- [ ] `name` can be `null` (D4/D5) — render "Unnamed intersection".
- [ ] `tti_seconds` can be `null` after passing — render "Passed".
- [ ] Tests: reducer and mock tests updated to v1 shapes; a type-level test (compile-only) that `telemetry.ts` defines no object type of its own.
- [ ] `npm run build` green with `mock` transport — the dashboard looks and behaves as before.

### Task F2: Adapter interface and reducer for a real network

**Files:** Modify `src/lib/simulation-adapter.ts`, `src/lib/simulation-state.ts`, `src/lib/useSimulationStream.ts`; Tests `simulation-state.test.ts`, `useSimulationStream.test.ts`.

**Interfaces:**
- Produces:
  - `SimulationAdapter.start(request) -> Promise<SimulationStartResponse>` (rejects with `SimulationAdapterError`, F4).
  - `SimulationAdapter.subscribe(simulationId, subscriber) -> unsubscribe`, subscriber: `onTick(event)`, `onItsDispatch(event)`, `onTerminal(event: Completed | Cancelled)`, `onConnectionChange("connecting" | "open" | "reconnecting" | "lost")`, `onError(error)`.
  - `SimulationAdapter.stop(simulationId) -> Promise<void>` (D-architecture: stop needs the id).
  - Reducer state machine: `SETUP → STARTING → RUNNING → FINISHED | CANCELLED | ERROR`, plus `connection` sub-field on `RUNNING`; actions `START_REQUESTED`, `START_SUCCEEDED`, `START_FAILED`, `TICK`, `ITS_DISPATCH`, `CONNECTION`, `TERMINAL`, `ERROR`, `RESET`.

- [ ] Tests first (pure reducer): `TICK` with `tick` ≤ last tick is ignored; `TICK` with another `simulation_id` is ignored; `ITS_DISPATCH` appends a formatted log line (bounded to 20 entries as today); `TERMINAL{COMPLETED}` → `FINISHED` keeps route + last telemetry; `TERMINAL{CANCELLED, SUPERSEDED}` → `CANCELLED` with reason; `START_FAILED` → `ERROR` with the code; `RESET` from any state → `SETUP`.
- [ ] Hook: opens the subscription on `START_SUCCEEDED`, closes it on unmount/`RESET`/terminal; idempotent under React Strict Mode double effects (test with two mount cycles).
- [ ] "Stale" indicator: if `open` but no event for N seconds, set connection `reconnecting`. N is **not specified anywhere** — propose 3 s (three missed 1 Hz ticks), put it in `config.ts`, and mention it in the PR so it is approved explicitly.

### Task F3: Wire validation (D23)

**Files:** Create `src/lib/transport/validate.ts`, `src/lib/transport/validate.test.ts`.

**Interfaces:**
- Produces: `parseStartResponse(value: unknown): SimulationStartResponse`, `parseStreamEvent(value: unknown, expectedSimulationId: string): SimulationStreamEvent | null` (null = drop silently with a `console.warn` in dev), `parseErrorResponse(value: unknown): ErrorResponse | null`.

- [ ] Tests: rejects `schema_version !== "1.0"`, `is_simulated !== true`, wrong `simulation_id`, missing `ambulance.position.lat`, a non-finite number, an unknown `state` string, a `route_geometry` with < 2 coordinates; returns `null` (ignore) for an unknown `event_type`; accepts the architecture §4 examples (as fixtures written under `src/lib/transport/__fixtures__/`, typed against generated types so a contract change breaks compilation, not runtime).
- [ ] Guards check exactly what the UI dereferences plus the envelope — not a second full schema (no competing contract definition, `.agents/INSTRUCTIONS.md` §3).

### Task F4: Backend adapter (fetch + EventSource)

**Files:** Create `src/lib/transport/backend-simulation-adapter.ts`, `src/lib/transport/errors.ts`, `src/lib/transport/backend-simulation-adapter.test.ts`.

**Interfaces:**
- Consumes: `config.ts` (F5), `validate.ts` (F3).
- Produces: `createBackendSimulationAdapter(baseUrl: string): SimulationAdapter`; `SimulationAdapterError { kind: "network" | "http"; code?: ErrorResponse["error_code"]; status?: number; message }`.

- [ ] `start`: `POST {base}/api/v1/simulation/start` JSON; non-2xx → parse `ErrorResponse` (409/422/404 per D7); FastAPI validation 422 (no `error_code`) → `kind: "http"`, code `undefined`, generic message; network failure → `kind: "network"`; time out after a fixed limit via `AbortController` (propose 10 s — routing on the real graph may take a moment; confirm with Piotr's measured planning time).
- [ ] `subscribe`: `new EventSource({base}/api/v1/simulation/{id}/stream)`; listen to the **named** events from D3 (`SIMULATION_TICK`, `ITS_DISPATCH`, `SIMULATION_COMPLETED`, `SIMULATION_CANCELLED`) — `onmessage` alone will not fire for named events; validate each `data` with F3; drop by `lastEventId` ≤ last tick; on terminal event call `onTerminal` and **close** (otherwise `EventSource` auto-reconnects to a finished stream forever); on `error` with `readyState === CONNECTING` → `reconnecting`; if reconnect attempts keep failing past a limit, or the server replies 404, → `lost` + `onError`. Note: `EventSource` cannot read HTTP status — detect 404 by a follow-up `fetch` GET to the stream URL that is aborted as soon as headers arrive (FastAPI does not answer HEAD on a GET route), or by "error with readyState CLOSED". Pick one, document it in the file header.
- [ ] `stop`: `POST …/{id}/stop`, then close the `EventSource`; 404 on stop is not an error to the user (already gone).
- [ ] Tests with a hand-written `FakeEventSource` (installed on `globalThis`, emits named events, simulates errors) and a stubbed `fetch`: happy path ordering; duplicate tick dropped; foreign `simulation_id` dropped; terminal closes; reconnect → `reconnecting` → `open`; 409 maps to `SIMULATION_ID_IN_USE`; network failure maps to `kind: "network"`.

### Task F5: Configuration and adapter selection

**Files:** Create `src/lib/config.ts`, `frontend/.env.example`; Modify `src/lib/simulation-adapter.ts`; Test `src/lib/config.test.ts`.

**Interfaces:**
- Produces: `getFrontendConfig(): { transport: "mock" | "backend"; apiBaseUrl: string; staleAfterSeconds: number }` read from `NEXT_PUBLIC_SIMULATION_TRANSPORT` (default `mock`) and `NEXT_PUBLIC_API_BASE_URL` (default `http://127.0.0.1:8000`, trailing slash stripped). Invalid values → fall back to defaults **and** warn once (never silently pick `backend`).

- [ ] Read the Next 16 docs for how `NEXT_PUBLIC_*` is inlined at build time (it is baked into the client bundle; a change needs a rebuild/dev restart) and write that one fact in `.env.example`.
- [ ] `simulationAdapter` selection by config; keep it a module-level singleton exactly as today so components are untouched.

### Task F6: UX for real-world states

**Files:** Modify `src/components/hud/DispatchForm.tsx`, `KpiHeader.tsx`, `ItsConsole.tsx`, `src/components/dashboard.tsx`; Create `src/components/hud/RunSummary.tsx`.

- [ ] `STARTING`: disable the dispatch button, show "Computing route…".
- [ ] Errors by code (English): `ORIGIN_OFF_NETWORK` / `DESTINATION_OFF_NETWORK` → "Origin/Destination is not on the simulated road network"; `NO_ROUTE` → "No drivable route between these points"; `SIMULATION_ID_IN_USE` → retry with a new id once automatically, then show the error; `network` → "Simulation backend unreachable at <url>".
- [ ] Connection badge in `KpiHeader`: Live / Reconnecting… / Connection lost.
- [ ] `ItsConsole`: entries from `ITS_DISPATCH` — "Simulated FORCE_GREEN_PHASE → INT-0360, INT-0366 · hold {hold_duration_sec} s (≥ 40, e.g. 55) · ETA 14:32:38Z". Remove the synthesized per-tick log lines.
- [ ] `RunSummary` on `FINISHED`: estimated normal vs estimated GreenWave vs simulated elapsed, final time saved; on `CANCELLED`: reason ("Stopped" / "Superseded by another dispatch").
- [ ] Playback speed selector (1×, 2×, 5×, 10×) in `DispatchForm` **only if D9 was accepted**; otherwise skip this bullet.
- [ ] Every new string keeps "simulated" wording where it describes signal behaviour.

### Task F7: Map uses real geometry

**Files:** Modify `src/components/map/SignalMarkers.tsx`, `MapContainer.tsx`, `EndpointMarkers.tsx`, `dispatch-endpoints.ts` (only if Piotr reports a preset fails to snap).

- [ ] `SignalMarkers`: position = `route_intersections[i].position` (from the start response, joined to tick intersections by `id`); delete the even-spacing fallback for the backend path (keep it nowhere — the mock now supplies positions too, F1).
- [ ] `MapContainer`: fit bounds to `route_geometry` on `START_SUCCEEDED` (respect reduced motion: no animated fly).
- [ ] `EndpointMarkers`: when `snap_distance_m` > a few metres, draw a thin dashed connector from the requested point to the snapped point so the user sees why the route starts elsewhere.
- [ ] Attribution: the Carto basemap shows OSM attribution, but our **data** also needs "Road network & signals © OpenStreetMap contributors (ODbL) · Street registry © City of Kraków (MSIP)" (architecture §5). Add it as a MapLibre custom attribution, plus "All signal states are simulated".
- [ ] Ambulance animation: interpolate between consecutive tick positions as today, but **along the route polyline** (not a straight chord) — at 10× playback a chord visibly cuts corners. Reuse `route-position.ts`; add a test for interpolation across a polyline bend.

### Task F8: Branch finish

- [ ] Full frontend checks green.
- [ ] Local smoke against Piotr's branch **without merging** (he tells you when B7 works): run his worktree's backend, then `NEXT_PUBLIC_SIMULATION_TRANSPORT=backend npm run dev`; one full run at 10×, one stop mid-run, one second-tab supersede. Record what you saw in the PR. If something disagrees with the contract → coordination doc §5, don't patch around it.
- [ ] Playwright CLI smoke script against the **mock** transport (outputs in `.tmp/playwright/`, per AGENTS.md); Phase 3 re-points it at the backend.
- [ ] `git diff --name-only contract-v1...HEAD` — every path under `frontend/` and not `api.generated.ts`, plus your own plan file.
- [ ] Rebase on `main` **after** the backend PR is merged; CI green; PR with merge commit (not squash).

## What you hand to Filip during the branch (messages only)

- Early (after F1): confirm the generated types are pleasant to use — e.g. if the union didn't narrow on `event_type` in TS, that is a Pydantic-side fix (coordination doc §5), cheaper now than later.
- After F4: your timeout and stale-threshold proposals, so he can check them against his measured planning time and tick duration.
