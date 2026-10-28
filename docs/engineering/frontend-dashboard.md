# Frontend dashboard constraints

Scope: maintain the official `frontend/` Next.js dashboard and simulated MapLibre workflow according to `GreenWave_ARCHITECTURE.md`. The dashboard defaults to Polish for Kraków. The shared header exposes PL/ENG; the selected language persists in a cookie. Translate presentation copy and accessible labels, while preserving API values, identifiers, original JSON, and geographic names. Scenario time stays in Europe/Warsaw in either language.

Treat GreenWave as a proper noun in both languages. Polish copy should read naturally as UI text; use nominative or impersonal status labels (for example, „Anulowana” or „Anulowano”). Translate complete labels instead of assembling sentences from declined status fragments.

The static v0 design source is no longer in the repository; `frontend/` is the only dashboard.

The delivered dashboard uses the canonical v1 generated contract. Mock transport remains the default and offline fallback; the selectable backend transport is implemented. Do not repeat completed dashboard build phases or start unrelated work without approval.

## UI and map

- Keep HUD presentation separate from `src/components/map/` rendering.
- Preserve responsive light/dark themes.
- Do not alter simulation logic or generated contracts from UI components.
- Improve UI/UX within established contracts and component boundaries; smooth interactions, spacing, typography, and visual polish are welcome. A new dependency or lockfile change needs explicit approval.

## Simulation boundary

- `src/lib/simulation-adapter.ts` isolates mock and backend transport.
- `MockSimulationAdapter` owns synthetic route, 1 Hz telemetry, ambulance movement, and signal samples.
- `src/lib/dispatch-adapter.ts` isolates incident dispatch (stations, geocode, rank). The mock has no address search and ranks by straight-line distance from `src/data/stations.snapshot.json` ("Approximate (mock)"); regenerate the snapshot with `backend/scripts/export_station_snapshot.py`.
- `src/types/telemetry.ts` exposes thin aliases of generated API types; Pydantic schemas and OpenAPI remain canonical.
- Keep synthetic values visibly simulated. Never send traffic-controller commands.

## Backend integration

- Define canonical Pydantic schemas first, export OpenAPI, and regenerate frontend types.
- A transport adapter satisfies `SimulationAdapter`; dashboard and map components stay transport-agnostic.
- Backend data is authoritative for route geometry, distance, position, and signal state.
- Validate connection, completion, cancellation, invalid payloads, reconnection, and stale events.

## Verification

After frontend changes run `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test`, and `npm run build`.

## Workspace controls and signal diagnostics

The shared workspace shell exposes a bottom-right primary dispatch action outside scrolling settings,
including minimized phone sheets and Focus Mode. Shared headers show the brand's
Home link and concise navigation labels without a repeated desktop mode heading. Home uses the same
header and logo geometry. One Focus Mode toggle hides or shows the details panel (including the phone
sheet) while navigation, telemetry and run controls remain visible; Escape restores the panel.
Comparison mode and speed/status pills sit at the right of each map. Vehicles use blue markers,
separate from the red/amber/green signal colours. A measured dock height keeps panels, phone sheets and map
controls clear of the dispatch action and its outcomes. One camera toggle shares a toolbar with
Dispatch settings: Follow vehicle from overview/suspension, Show route while following or when
telemetry cannot be followed. Comparison follows its fresh running members together; route overview
remains available for finished members. The settings popover contains no duplicate follow switch.

Map phase detail draws vehicle lights only. Pedestrian indications remain in each tick's
`signal_phases` and the Diagnostics JSON inspector. Phase entries expose `controlled_edge_ids`
for road approaches and `is_route_movement` for the vehicle movement followed by the route.
The dataset identifies approaches, not individual lanes; mock signals have no real edge IDs.
Priority targets route vehicle movements green and other movements red, preserving clearance
transitions; ordinary cycles remain unchanged outside priority.

Camera view changes share the existing 600 ms station/incident focus timing. Show route uses an eased
pan/zoom rather than a flight arc; reduced-motion preferences keep view changes immediate. Both
camera actions stop an old gesture before applying the new view so rapid toggles remain interruptible.
