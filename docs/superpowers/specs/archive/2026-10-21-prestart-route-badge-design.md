# Pre-start route badge: design

## Intent

Before route computation, the setup screen should describe selected endpoints without presenting a made-up route identity or implying a corridor exists.

## Decisions

- With no incident selected, prompt for incident selection. Once station and incident are selected, say that the route will be computed when the simulation starts.
- Remove the hard-coded route ID and planned-corridor claim from setup. Keep actual route geometry and identity tied to route data in live mode.
- Use the same truthful setup status in mock and backend modes.

## Constraints and non-goals

- Do not precompute or fabricate a backend route, estimate, or signal corridor. Preserve station and incident map markers.
- No routing, map transport, API, generated-contract, dependency, or lockfile change. Keep English and accessible status text.

## Acceptance criteria

- Initial and selected-incident setup show no fictitious route ID or planned-route claim.
- Changing the incident updates endpoint selection status without stale route text. Live mode still displays its actual route and does not show the setup badge.
