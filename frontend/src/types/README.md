# Simulation contracts and state

`api.generated.ts` is generated from the canonical backend Pydantic schemas
(contract `contract-v1`, ADR 0003); never edit it by hand. `telemetry.ts` only
gives those generated schemas short frontend names; it declares no wire shapes
of its own (`telemetry.test.ts` enforces this at compile time). TypeScript types
alone do not validate incoming JSON.

`SimulationProvider` is mounted in the root layout. Components can read the
snapshot with `useSimulationState()` and dispatch actions with
`useSimulationDispatch()`.

The mock adapter is the offline demo transport. It draws a straight synthetic
route between the selected endpoints, with the architecture's sample estimates
(5,400 m, 780/380 s) and two sample intersections (`INT-0360`, `INT-0366`, real
ids and names) placed on that line at their sample distances; those positions
are synthetic. A scripted sample timeline imitates the documented thresholds
(`CLEARING` at TTI ≤ 40 s, `PRIORITY_GREEN` at ≤ 25 s, `RECOVERY` for 15 s after
passing, one-hop cascade within 250 m), emits `ITS_DISPATCH` when sample signals
enter `CLEARING`, and ends with `SIMULATION_COMPLETED` once every signal is
back to `NORMAL`. It is not the simulation engine. Each one-second tick advances
`playback_speed` simulated seconds. All signal states are simulated.
