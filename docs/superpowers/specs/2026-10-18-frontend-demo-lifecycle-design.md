# Frontend Demo Lifecycle Design

**Status:** Approved 2026-10-18

## Intent

ER-GreenWave's dashboard must remain a credible simulation demo in two supported modes:
the default offline mock and the Compose-configured backend transport. The existing mock
adapter implements completion, stop, and supersede semantics, but its golden stream
characterization covers only completed runs. In addition, a request-building library
module imports the `PlaybackSpeed` type from a HUD component, reversing the intended
presentation-to-library dependency.

This increment makes the playback-speed domain value reusable and characterizes a
cancelled mock stream. It also records a reproducible, manual browser acceptance
procedure for the real Compose stack. It does not change the v1 contract or the
simulation's runtime semantics.

## Goals

1. `PlaybackSpeed` and its allowed values have one reusable home under `frontend/src/lib/`.
2. HUD components consume the playback-speed module; library modules never import from
   `components/` for this domain value.
3. The mock-stream golden suite contains a stopped-run scenario with a terminal
   `SIMULATION_CANCELLED` event and no later telemetry.
4. A contributor can repeat the real-backend browser check using the approved
   Playwright CLI procedure after preparing the GIS dataset.
5. The offline mock remains the default frontend transport and the Compose override
   remains the real-backend route.

## Non-goals

- No Pydantic, OpenAPI, or generated TypeScript change.
- No change to `SimulationAdapter`, reducer, SSE framing, mock timing, allowed speeds,
  or dashboard visual markup.
- No new dependency, Playwright package, browser automation framework, lockfile, or
  committed browser output.
- No change to the PoC boundary: all values and dispatches remain simulated.
- No switch of `DEFAULT_TRANSPORT` from `mock` to `backend`.

## Existing architecture and decisions

- ADR 0003 D9 defines allowed request playback speeds as `1`, `2`, `5`, and `10`; the
  wall-clock tick remains one second and simulation advances in one-second sub-steps.
- ADR 0003 D22 and `docs/engineering/frontend-dashboard.md` keep mock transport as the
  offline fallback and select backend transport by environment configuration.
- `src/lib/simulation-adapter.ts` is the transport boundary. `mock-simulation-adapter.ts`
  owns synthetic route and stream behavior; HUD and map components remain transport-agnostic.
- A `SIMULATION_CANCELLED` terminal event has the v1 envelope and reason `STOPPED` or
  `SUPERSEDED`. The adapter must make terminal delivery final.

## Design

Create `frontend/src/lib/playback-speed.ts` as the sole owner of:

```ts
export const PLAYBACK_SPEEDS = [1, 2, 5, 10] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];
```

`PlaybackSpeedSelector` imports both exports. `DispatchForm` and `start-request.ts`
import the type from the library module. This is a relocation only: labels, radio-group
behavior, selected default, and request payload remain unchanged.

Extend the existing file-snapshot test rather than adding a second parallel stream
harness. Model a `STOPPED` scenario explicitly: subscribe, advance a fixed number of
mock intervals, call `stop()` for that simulation id, advance additional intervals,
and record callbacks. The snapshot must include one `onTerminal` cancellation payload;
the test must also assert that the callback record count does not grow after the
additional time advance. Completion scenarios remain unchanged.

Document the manual browser acceptance procedure in `frontend/README.md`. It must say
that raw and processed data must be prepared first, use `docker compose up --build`,
set the Compose backend transport, and use `@playwright/cli` through bash only. All
CLI output, screenshots, and traces belong under `.tmp/playwright/` and are not
committed. The procedure covers: start, live telemetry, stop/cancel, and a second tab
superseding the first.

## Ownership boundary

This track owns only `frontend/src/components/hud/dispatch/`, the listed frontend
library/test/snapshot files, and `frontend/README.md`. It must not modify backend
sources, API schemas, generated contracts, root documentation, Compose configuration,
or dashboard/map markup outside the imports needed for the type relocation.

## Acceptance criteria

- `PLAYBACK_SPEEDS` and `PlaybackSpeed` are exported from `src/lib/playback-speed.ts`.
- No file under `frontend/src/lib/` imports `PlaybackSpeed` from a component path.
- The stopped golden scenario emits exactly one `SIMULATION_CANCELLED` terminal event
  with reason `STOPPED` and emits no later mock ticks or dispatches.
- Existing completion/cascade/playback scenarios retain their recorded behavior.
- `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test`, and
  `npm run build` pass.
- The documented browser procedure is executable when the local prepared-data
  prerequisite is available; its artifacts stay ignored under `.tmp/playwright/`.
