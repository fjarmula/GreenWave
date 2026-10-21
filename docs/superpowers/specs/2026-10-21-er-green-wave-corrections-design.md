# ER Green Wave behaviour and phase-detail corrections: design

## Intent

Correct disabled ER Green Wave so an emergency vehicle rolls cautiously through a simulated red movement rather than stopping at its stop line. Correct detailed signal rendering so junction and pedestrian indicators represent only supported simulated movements, remain visible or explicitly unavailable at high zoom, and do not overlap unreadably.

This document amends `2026-10-20-er-green-wave-mode-design.md`. The direct user requirement here supersedes that document's stationary disabled-mode clearance dwell.

## Decisions

### Rolling standard-traffic crossing

With `green_wave_mode: DISABLED`, the engine uses the normal simulated phase programme. At a route stop line whose route movement is `RED`, it begins one controlled crossing of `standard_crossing_distance_m`; it does not stop first. Its extra cautious time is `standard_clearance_factor * delay_seconds * traffic_density_multiplier`, distributed proportionally over that controlled distance. For a segment of length `d` with ordinary speed limit `v`, simulated time is `d / v + cautious_time_remaining * (d / crossing_distance_remaining)`.

The resulting speed is positive and never above `v`; the calculation carries across edge ends. A route movement that is `GREEN` follows normal ambulance motion. `YELLOW` is treated as `RED` for this PoC. A subsequent stop line begins a fresh controlled crossing. `standard_crossing_distance_m` is strictly positive in this model.

Enabled behaviour remains unchanged. Disabled runs never activate a corridor, cascade, or emit an ITS dispatch.

### One domain phase meaning

The engine obtains crossing permission and map projection from the same pure domain phase programme. `route_movement_color_at(route_model, state, intersection_id, at_s)` returns the route vehicle movement colour or `None` when no supported route vehicle signal exists. Motion samples it at the exact simulated time it reaches a stop line; telemetry samples it at the completed tick's `simulated_time_s`. Display transition heads may delay a visual red-to-green change for legality, but never change this programme colour.

`None` is conservative for disabled motion: it takes the cautious crossing path, while the map shows no invented phase marker and retains its detail-unavailable fallback.

### Phase fidelity and availability

`traffic_signals` nodes may expose vehicle and pedestrian explanatory indicators. `pedestrian_crossing` nodes expose pedestrian indicators only. For each intersection, non-empty controlled-edge identities are sorted and assigned two normal-cycle slots by sorted ordinal modulo two; more than two identities alternate deterministically. Empty identities have no phase indicator. This replaces the arbitrary sort position of `signal_key` and remains explicitly simulated, not a claim of live or authoritative traffic-controller state. Priority can make only a route **vehicle** signal green; every pedestrian indication remains red during CLEARING and PRIORITY_GREEN.

Missing phase geometry is not fabricated. At detailed zoom the UI retains the intersection-level state marker and labels detailed phases unavailable for that intersection.

### Detailed map layout

The frontend groups phase indicators by intersection and assigns deterministic screen offsets by group/member order. It preserves colour plus concise text and ARIA labels, and never relies on a two-pixel left/right split as collision handling.

## Constraints

- Simulation only; never introduce live traffic-controller calls, safety claims, or operational advice.
- Preserve routes, enabled-mode motion, open-road speed, and the frozen stream envelope.
- Pydantic schemas remain canonical. Regenerate OpenAPI and TypeScript only when public schemas change.
- Add no dependencies; MapLibre remains contained in `frontend/src/components/map/`.
- Fixed data, settings, request, and clock produce deterministic motion and phases.

## Acceptance criteria

- A disabled vehicle facing a simulated red/yellow movement has positive, capped speed throughout its controlled crossing; it does not dwell at the stop line.
- A disabled vehicle facing green incurs no cautious-crossing penalty.
- Disabled runs have no active corridor, cascade targets, or ITS dispatch in backend or mock transport.
- Pedestrian-crossing nodes never render invented vehicle signals.
- High zoom preserves an explicit state/fallback for every route intersection, including those without phase geometry.
- Detailed markers update from tick data, are readable when approaches are nearby, and remain labelled simulated.
