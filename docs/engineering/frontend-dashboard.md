# Frontend dashboard constraints

Scope: maintain the official `frontend/` Next.js dashboard and simulated MapLibre workflow according to `GreenWave_ARCHITECTURE.md`. All UI text remains English.

The static v0 design source is `er-green-wave-dashboard-design/`; the official target is `frontend/`.

The delivered dashboard preserves the mock boundary until an approved backend contract changes it. Do not repeat completed dashboard build phases or start unrelated work without approval.

## UI and map

- Keep HUD presentation separate from `src/components/map/` rendering.
- Preserve responsive light/dark themes.
- Do not alter simulation logic or generated contracts from UI components.
- Improve UI/UX within established contracts and component boundaries; smooth interactions, spacing, typography, and visual polish are welcome. A new dependency or lockfile change needs explicit approval.

## Simulation boundary

- `src/lib/simulation-adapter.ts` isolates mock and future transport.
- `MockSimulationAdapter` owns synthetic route, 1 Hz telemetry, ambulance movement, and signal samples.
- `src/types/telemetry.ts` is temporary until generated types are used after Pydantic schemas and OpenAPI registration exist.
- Keep synthetic values visibly simulated. Never send traffic-controller commands.

## Backend integration

- Define canonical Pydantic schemas first, export OpenAPI, and regenerate frontend types.
- A transport adapter satisfies `SimulationAdapter`; dashboard and map components stay transport-agnostic.
- Backend data is authoritative for route geometry, distance, position, and signal state.
- Validate connection, completion, cancellation, invalid payloads, reconnection, and stale events.

## Verification

After frontend changes run `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test`, and `npm run build`.
