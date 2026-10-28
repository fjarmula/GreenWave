# Domain invariants

## PoC safety boundary

ER-GreenWave models emergency-vehicle routing and traffic-signal priority for analysis and demonstration. Signal states and green corridors are simulation state, not physical actuation. Never add controller protocols, live signal commands, deployment behavior, or safety claims without explicit requirements, authorization, and safety review. Clearly label simulated values so users cannot mistake them for verified physical states.

Core capabilities are spatial ETL into a directed road graph, a 1 Hz simulation that calculates time to intersection and documented signal states, corridor batching/cascade behavior, and dispatcher telemetry over SSE (the only streaming transport; there are no WebSockets). Context is not permission to invent unspecified behavior.

The documented state sequence is `NORMAL` → `CLEARING` → `PRIORITY_GREEN` → `RECOVERY`. Confirm exact transitions, timing, and exceptions in `GreenWave_ARCHITECTURE.md` and existing code; do not invent them.

## Simulation and telemetry

- Permit only documented transitions. Make preconditions, timeout, interruption, recovery, duplicate-event, and stale-event behavior explicit and independently testable. Completed, cancelled, and interrupted runs must return to valid documented state.
- Keep simulation time distinct from wall-clock time. Use controllable clocks where practical; avoid unbounded 1 Hz-loop work; define delayed-tick behavior from documented requirements.
- Follow the documented protocol for conflicting, cancelled, stale, and duplicate requests; do not invent arbitration policy. Preserve ordering, reconnect, and stale-update semantics.
- Do not let per-client work or queues block the loop. Handle disconnects without corrupting state; define message ordering, reconnection, and stale-update behavior from the existing protocol.
- Keep inputs, routes, signal states, and outcomes deterministic for a fixed seed and dataset version. Make assumptions configurable, traceable, and never operational guarantees.
- Isolate adapters from domain logic. Providers must be replaceable and provider types must not leak into contracts. Add tests for routing, timing, priority scenarios, boundaries, and deterministic replay.
- Treat telemetry and scenario data as sensitive when it could identify vehicles, routes, or infrastructure.
- Expected failures include unavailable signal data, malformed coordinates/GIS records, missing routes, and disconnected clients. Use domain-specific errors where useful; do not catch broad exceptions to hide failure, silently turn invalid data into plausible data, or improvise retry/timeout/fallback behavior.

## Spatial and routing

- Confirm CRS and units before distance calculations. Do not compare angular coordinates as metres; use an appropriate projected CRS or geodesic method.
- Validate geometries and coordinates at ingestion. Make directed-road, one-way, connectivity, and edge-weight assumptions explicit.
- Handle disconnected graphs, missing/stale data, and unreachable intersections explicitly; never fabricate routes.
- Keep distance/time units consistent. Test corridor-batching values below, at, and above configured thresholds.
- Do not perform expensive graph or spatial preprocessing in the simulation loop unless measured and justified.

## Contracts

Pydantic schemas are canonical. Register non-route telemetry payloads in OpenAPI so frontend types remain generated. Identify one canonical definition per payload; do not maintain competing definitions. For contract changes, update affected backend/frontend representations and verify serialization/deserialization.
