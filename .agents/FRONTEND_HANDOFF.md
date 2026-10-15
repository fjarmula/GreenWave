# Frontend Dashboard Handoff

## Delivered scope

The dashboard implementation plan (`FRONTEND_DASHBOARD.md`, F0–F5) is complete.
The production frontend lives in `frontend/`; the former v0 design directory is
not needed for runtime behavior.

- The Next.js dashboard is split into HUD components in
  `src/components/hud/` and MapLibre components in `src/components/map/`.
- Dispatch setup selects synthetic origin and destination nodes, previews their
  actual geographic MapLibre markers, and starts the simulated lifecycle.
- Global simulation state is held by `src/components/simulation-provider.tsx`
  and `src/lib/simulation-state.ts` with `SETUP`, `RUNNING`, and `FINISHED`
  states.
- The live view renders a route, interpolated ambulance position, signal
  markers, KPIs, and ITS audit entries. It is responsive for mobile and
  desktop, and all interface text is English.
- Light and dark themes cover the HUD and MapLibre controls. The UI uses
  300 ms color transitions; the existing MapLibre instance fades the old
  basemap down before switching styles and fades the new style back in, so
  camera position and zoom remain intact.

## Current mock boundary

The frontend is intentionally still a synthetic demonstration. The mock layer
is isolated behind `src/lib/simulation-adapter.ts`:

```text
Dashboard / HUD / map
        ↓
useSimulationStream (controller and state dispatch)
        ↓
SimulationAdapter: start / subscribe / stop
        ↓
MockSimulationAdapter
```

- `src/lib/mock-simulation-adapter.ts` owns mock route construction, the 1 Hz
  telemetry timer, mock ambulance movement, and sample signal snapshots.
- `src/lib/mock-simulation-config.ts` owns the shared synthetic timings,
  distance, density baseline, and stream interval. Do not duplicate these
  values in UI components.
- `src/lib/useSimulationStream.ts` only connects the selected adapter to
  reducer actions. `dashboard.tsx` does not construct synthetic route data.
- `src/types/telemetry.ts` is a temporary translation of Architecture §4, not
  a generated backend contract. `src/types/api.generated.ts` remains generated
  and must not be edited manually.

## Backend integration sequence

1. Define the initialization and telemetry payloads as canonical Pydantic
   schemas under `backend/src/greenwave/schemas/`. Resolve the architecture's
   open questions before treating them as a contract, especially stream
   subscription/cancellation, concurrent simulations, and the final signal
   state representation.
2. Export OpenAPI and regenerate frontend types:

   ```bash
   cd backend && uv run python scripts/export_openapi.py
   cd ../frontend && npm run generate:types
   ```

3. Replace the temporary types with generated aliases where possible. If the
   selected WebSocket/SSE message is not represented by a REST route, register
   its schema in the OpenAPI document first so it can be generated.
4. Implement a backend adapter that satisfies the existing `SimulationAdapter`
   interface, then replace the adapter selection in
   `src/lib/simulation-adapter.ts`. Dashboard, HUD, reducer, and map components
   should not need transport-specific changes.
5. Make the backend response authoritative for route geometry, total distance,
   estimates, vehicle position, and signal state. Signal coordinates (or a
   documented lookup keyed by signal ID) are required before replacing the
   frontend's synthetic along-route marker placement.
6. Add runtime validation at the transport boundary, plus tests for connection,
   completion, cancellation, invalid payloads, and reconnect/stale-event
   behavior once those semantics are agreed.

## Deliberate limitations to preserve until integration

- Route geometry, endpoint choices, distances, estimates, vehicle movement,
  and signal placement are synthetic; the Carto/OSM basemap itself is real.
- The current `CLEARING_CASCADE` sample remains only a frontend mock. The
  architecture notes that its relationship to the canonical signal state
  machine is unresolved.
- The frontend must continue to label this as simulated data and must not send
  traffic-controller commands.

## Validation

Run from `frontend/` after frontend changes:

```bash
npm run lint
npm run typecheck
npm run format:check
npm test
npm run build
```
