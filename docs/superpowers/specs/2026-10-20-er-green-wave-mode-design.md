# ER Green Wave mode and intersection-phase detail: design

## Intent

Make the dashboard demonstrate why ER-GreenWave reduces emergency response time. A viewer runs one simulation in one map view, with ER Green Wave either enabled or disabled, and compares the final total travel time. The contrast must arise from intersection coordination and surrounding traffic flow, not from an artificial open-road speed advantage.

All behaviour and signal indications remain explicitly simulated. This is a Kraków PoC; it must neither connect to nor claim to control physical traffic infrastructure.

## User outcome

When an emergency vehicle is away from a controlled intersection, both modes use the same route, road attributes, ambulance-capable edge speed, and normal acceleration/edge traversal model. The vehicle may be capable of high speed (including above typical urban limits where the current ambulance edge model permits it).

At an intersection:

- **ER Green Wave enabled** pre-emptively clears and prioritises the route as the existing engine does. The emergency vehicle makes only the existing minimal simulated crossing dwell. The signal display makes the prioritised movement and held conflicting movements visible.
- **ER Green Wave disabled** leaves the intersection on its normal simulated programme. The emergency vehicle can legally proceed on red in the model, but has to proceed carefully: queued road users must react and form a life corridor. It therefore incurs a longer, traffic-dependent clearance/crossing interval and travels at the ordinary road speed limit while inside the controlled crossing area. Once it exits that area it resumes the identical ambulance edge-speed model used by the enabled run.

The dashboard uses one selectable run, not a simultaneous two-run comparison. A future side-by-side comparison is deliberately out of scope, but the selected mode and its final time must be retained in run state so that a later comparison can consume them.

## Scope

### Included

1. Add an `enable_green_wave` start-run choice, shown as **ER Green Wave** with Enabled/Disabled values. It is independent of the existing cascade toggle: cascade remains a Green Wave implementation detail and has no priority effect while Green Wave is disabled.
2. Make the chosen mode canonical in the Pydantic start request, start response, and run/terminal telemetry where the frontend needs it. Regenerate OpenAPI and TypeScript types; never hand-edit generated artifacts.
3. Extend the deterministic backend motion model with a standard-traffic intersection traversal. It must use settings, not hidden constants, and remain reproducible for a fixed dataset/settings/seed.
4. Keep the existing priority motion unchanged when enabled. In disabled mode, model a cautious crossing as a configurable clearance delay plus a configurable controlled-crossing distance travelled at the current edge's ordinary speed limit. The clearance delay scales with `traffic_density_multiplier`; its default derives from each route intersection's existing `delay_seconds`, which is already the repository's documented normal-mode delay assumption.
5. Add a deterministic, simulated intersection-phase projection for the map: vehicle approaches and pedestrian crossings receive `RED`, `YELLOW`, or `GREEN` values. It is shown only after the map is sufficiently zoomed into an intersection, so the city view stays uncluttered.
6. In Green Wave priority states, the phase projection must show the emergency approach green and conflicting vehicle/pedestrian movements held red. In normal/disabled operation, it follows a deterministic cycle. Yellow is an explicit transition interval, never inferred by the UI.
7. Make the key completed-run result **Total travel time**. Existing time-saved presentation may remain, but it must not be the primary outcome for this feature.
8. Cover backend mode/motion/phase rules, schema compatibility, frontend controls, adapter parity, zoom visibility, and final-summary rendering with tests.

### Excluded

- Live signal/controller integration, operational recommendations, or safety claims.
- A simultaneous/side-by-side run or historical comparison screen.
- Changing routes, open-road ambulance speeds, road-attribute factors, or traffic-density semantics outside a controlled crossing area.
- Lane-level traffic simulation, empirically calibrated driver reaction times, or claiming that the simulated values represent real Kraków signal timing.
- Editing generated OpenAPI/TypeScript files by hand or adding dependencies.

## Product and interaction design

The setup HUD contains an accessible binary ER Green Wave control, defaulting to Enabled to preserve current behaviour. Copy explains that it is a simulation setting. The selected value is locked into the run request and displayed in the live/summary context so the result cannot be mistaken for the other mode.

The map continues to show its normal route and vehicle layers. At the existing general zoom, phase markers do not render. At a high zoom threshold, each route intersection displays compact, positioned vehicle and pedestrian lights for its approaches/crossings. The marker uses colour plus a text/ARIA label; it does not rely on colour alone. The phase overlay is a simulated explanatory layer, not a claim about live signals.

On completion, the summary leads with the final total travel time. It identifies the mode used. It does not claim an observed real-world saving.

## Simulation design

### Mode contract

Use a closed `GreenWaveMode` representation (`ENABLED` / `DISABLED`) in the canonical backend schema; expose it in API responses/events consumed by the dashboard. The request may accept a boolean only if the Pydantic schema normalises it immediately to the closed representation; the UI speaks in Enabled/Disabled mode labels. This is an implementer decision to keep event interpretation unambiguous.

`enable_cascade_mode` remains in the request for compatibility. When Green Wave is disabled, the engine must not transition intersections into corridor-clearing or dispatch an ITS priority payload, regardless of its cascade value.

### Standard-traffic crossing model

The present implementation stores a first stop line, but not a lane-level exit geometry. The new model therefore defines a configurable **controlled crossing distance** beginning at that first stop line. This is a modelling boundary, labelled simulated and configurable; it is not a claim that every physical junction has that exact geometry.

For an unpassed route intersection in disabled mode:

1. Travel to its first stop line using the same ambulance edge-speed model as enabled mode.
2. Spend a deterministic clearance interval representing cautious red-light entry and life-corridor formation. Default clearance is the intersection's existing `delay_seconds`, multiplied by the run's traffic-density multiplier; it must be clamped/configured so invalid values cannot create negative or non-finite time.
3. For the next controlled-crossing distance, cap the emergency vehicle at the current edge's ordinary speed limit (not its ambulance boost). If the configured distance spans an edge boundary, carry the cap across the route deterministically. It must not reduce speed before the stop line or after the controlled segment.
4. Resume normal ambulance edge motion immediately after the controlled segment.

The enabled mode remains the existing short minimum intersection dwell. Both modes continue to use the same route selected at initialisation. Tests must show that the modes have identical open-road movement and differ only once an intersection is reached.

### Phase model

The ETL currently provides intersection/approach metadata, not authoritative real-time movement programs. Phase values are therefore generated by a backend domain projection, never invented in MapLibre components.

The normal simulated cycle has a configurable green interval, yellow interval, and all-red clearance interval. Assign approaches to a deterministic, alternating pair of movement groups in route/intersection order; pedestrian phases are green only when the conflicting vehicle group is red. This is a visual explanatory abstraction, not lane-level signalling. Green Wave state overrides the cycle only for the emergency route's approach: `CLEARING` prepares the corridor, `PRIORITY_GREEN` gives that approach green, and conflicting vehicles/pedestrians red; `RECOVERY` returns to the normal cycle.

The frontend receives a compact list of phase indicators with their kind (`VEHICLE` / `PEDESTRIAN`), colour, accessible label, and display position/approach identity. The backend must gracefully return an empty phase list for route intersections without enough geometric metadata; the map then renders no invented marker.

## Constraints and acceptance criteria

- Existing runs without the new explicit selection preserve current enabled Green Wave behaviour.
- A disabled run emits no ITS priority dispatch event and has no active corridor state.
- Disabled intersection crossings add deterministic cautious clearance and speed-limited distance; enabled crossing behaviour remains unchanged.
- A fixed route/settings/mode produces repeatable positions, phase samples, elapsed time, and events.
- The final total time reflects actual simulated arrival time for the selected mode.
- Phase details are hidden below the defined zoom threshold, visible above it, accessible, and labelled simulated.
- Schema changes are exported from Pydantic and regenerated in both contract artifacts.
- Backend and frontend checks in `AGENTS.md` pass, with focused tests proving all new mode and rendering behaviours.

## Builder calls

- Choose names for settings and helper objects consistent with the existing `SimulationSettings`, motion, and telemetry modules.
- Choose the high-zoom threshold and marker layout after inspecting current MapLibre layer conventions; keep it stable and testable.
- Preserve the frozen stream envelope/version unless an additive schema change is required; document any new schema decision in the relevant ADR/design material.
- Treat the chosen default controlled-crossing distance and normal phase durations as PoC modelling assumptions, with comments and settings names that make that limitation explicit.

## Open issue resolved by this design

The request referred to an on/off toggle in both directions. The product uses the unambiguous modes **ER Green Wave Enabled** and **ER Green Wave Disabled**. Enabled is the existing priority behaviour; Disabled is standard simulated traffic with cautious emergency red-light crossing.
