# Simulation contracts and state

`api.generated.ts` is generated from the canonical backend Pydantic schemas.
Currently it contains only the health endpoint. `telemetry.ts` temporarily
translates the architecture's Phase 1 and Phase 2 examples for the frontend mock
workflow. When backend simulation models are exported, replace these definitions
with generated aliases and reconcile differences before connecting transport.
TypeScript types alone do not validate incoming JSON.

`SimulationProvider` is mounted in the root layout. Components can read the
snapshot with `useSimulationState()` and dispatch actions with
`useSimulationDispatch()`:

- `START` receives the initialization request and response together, enters
  `RUNNING`, stores route geometry and estimates, and clears previous telemetry.
- `TICK` updates the latest telemetry while running.
- `FINISH` preserves the final route and telemetry for a finished view.
- `RESET` returns to `SETUP` and clears the previous run.

The dashboard's setup/live tabs are presentation state; opening Live operations
does not start a simulation. F4 will connect initialization and the mock stream
to these actions. F5 will render route and vehicle data. No timers, transport,
signal transition logic, or automatic completion rules are implemented in F3.
