# Terminal speed presentation: design

## Intent

The dashboard should distinguish current vehicle state from the speed measured over the final simulated second. A positive arrival-tick speed must not look like a vehicle still moving after completion.

## Decisions

- Preserve the backend and mock telemetry sample, including its positive arrival-tick interval speed and final position.
- While running with a tick, display that tick's speed as the last simulated second's measurement. A running zero-speed tick is a valid `0.0 km/h` value.
- Once finished, display current speed as `0.0 km/h` with an arrival label. On cancellation or error, show no current-speed value or claim. Before telemetry exists, show an unavailable value.
- Apply the same rule to the KPI strip and vehicle card for both transports.

## Constraints and non-goals

- No backend motion, event, schema, or generated-contract change. Do not erase retained telemetry to conceal the presentation problem.
- Preserve responsive layout and English text. Do not imply a historical sample is current.

## Acceptance criteria

- A finished run with positive final interval speed shows `0.0 km/h` as current speed in both UI locations.
- Cancelled and errored runs do not claim current speed; the final map position and other retained sample data remain available.
- Running positive and zero speeds, plus the no-tick state, are labelled and displayed consistently in both transports.
