# Mock route consistency: design

## Intent

An offline dispatcher demo should present one coherent synthetic trip for any selected station and incident. Its line, distance, estimates, junctions, vehicle position, and speed should agree, while remaining visibly distinct from backend routing and real travel-time predictions.

## Decisions

- Keep arbitrary map-click incidents and the straight-line mock route. Measure separation geodesically in metres; use the existing 5,400 m, 780 s normal, and 380 s Green Wave values as reference rates at traffic density 1.5. Density changes normal time only.
- Derive preflight and started-run estimates from the same pure calculation. Before both endpoints exist, show no time or percentage estimate. Label computed mock values approximate.
- Place two synthetic junctions at the current route distance multiplied by `1480 / 5400` and `1632 / 5400`, in that order. Use synthetic IDs and names; preserve deterministic signal/cascade behavior.
- Report each tick's speed from the distance actually moved during that simulated second. Keep enabled and disabled open-road motion identical until a controlled crossing changes progress.
- If an incident exactly coincides with a mock station, exclude that station from ranking and report it as `station_at_incident`. Use the next distinct station; if none exists, report `NO_STATION_REACHABLE`. Reject a direct zero-distance mock start with `NO_ROUTE`.

## Constraints and non-goals

- Simulation only. The straight line does not represent a drivable route or a real response-time prediction.
- Preserve the 1 Hz mock stream, enabled/disabled mode semantics, existing public schemas, backend behavior, and transport boundaries. Add no dependency or lockfile change.
- Keep output deterministic for fixed request and clock. Preserve English UI copy.

## Acceptance criteria

- Different endpoint separations produce correspondingly different finite distances and estimates in preflight and the run; the reference scenario retains its reference values.
- Route geometry begins and ends at the selected coordinates. Both synthetic junctions lie in order on that route, with valid distinct synthetic identities.
- Each nonterminal speed sample agrees with position change over its tick; no `NaN` or infinite value appears for valid inputs.
- Coincident-station ranking and direct zero-distance starts produce the specified result or error without a stuck timeline.
- Enabled and disabled streams retain their existing signal behavior; disabled mode emits no ITS dispatch.
