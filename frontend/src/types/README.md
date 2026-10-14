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
does not start a simulation. Initialization creates a synthetic route response
and starts the F4 one-second stream. Returning to setup resets the run and stops
the timer. The mock finishes after its sample GreenWave estimate (380 seconds).
ITS logs are bounded to 20 entries; the console shows the latest five.

The mock uses straight-line interpolation between selected endpoints, a sample
5,400 m distance and 780/380 second estimates from the architecture example.
Traffic density scales only the mock normal estimate; cascade toggles the second
sample signal's active flag and state. TTI counts down from sample 28/38 second
values and clamps at zero. Signal snapshots remain fixed example states: this
is not backend routing or a signal transition engine. F5 will render route and
vehicle data. Runtime transport validation remains necessary for integration.
