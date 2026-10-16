# Simulation engine operational constraints

- Scope: model green-corridor behaviour for analysis and demonstration. Never actuate real traffic signals or emergency systems.
- Keep simulation inputs, routing, signal states, and outcomes deterministic for a fixed seed and dataset version.
- Model assumptions must be explicit, configurable, and traceable in outputs; do not present simulated outcomes as operational guarantees.
- Validate graph connectivity, route feasibility, timing bounds, and scenario inputs before execution. Fail fast with actionable errors.
- Preserve canonical domain contracts in `backend/src/greenwave/schemas/`. Regenerate OpenAPI and frontend types after contract changes.
- Isolate adapters from domain logic. External map, routing, and data providers must be replaceable and must not leak provider types into contracts.
- Add focused tests for routing, timing, signal-priority scenarios, boundary cases, and deterministic replay.
- Treat all telemetry and scenario data as sensitive when it could identify real vehicles, routes, or infrastructure.
