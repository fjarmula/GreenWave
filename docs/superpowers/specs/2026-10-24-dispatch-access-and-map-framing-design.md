# Dispatch access and map framing: design

Status: approved in conversation 2026-10-24 (human). Four sub-projects, one plan each:

| Plan | Sub-project | Layer |
|---|---|---|
| `plans/2026-10-24-p5-station-choice.md` | A. Station choice | frontend |
| `plans/2026-10-24-p6-map-chrome-and-driver-map.md` | B. Map chrome, route framing, driver labels | frontend |
| `plans/2026-10-24-p7-emergency-access-ways.md` | C. Emergency access ways in the road network | ETL |
| `plans/2026-10-24-p8-on-foot-incident-access.md` | D. On-foot access to off-road incidents | backend + contract + frontend |

Order: A → B → C → D. D builds on A (each candidate carries its own access point) and is measured after C (fewer incidents need a walk once more roads are routable).

## A. Station choice

Problem: the dispatch panel lists the three fastest stations but always dispatches the first; the list is informational only.

- The dispatcher picks any listed candidate. The fastest stays pre-selected.
- Selection is by `station_id`, held in the incident-dispatch store. Every re-rank (incident, vehicle type) resets it to the fastest. A selection that is not among the current candidates falls back to the fastest.
- The selected candidate drives everything `candidates[0]` drives today: the start request origin, comparison origin, preflight estimate, run labels, chosen-station map marker. The other candidates are the map's runners-up.
- Rows are native radio inputs (one `name` per form) so keyboard and screen-reader behaviour come for free. Each row: station name, source kind, time (or km in mock mode), and for non-fastest rows the delta copy `+{n} s` (road-time ranking) or `+{x.x} km` (mock). The fastest row carries the badge `Fastest`.
- Fieldset legend: `Dispatch from`. Rows are at least 44 px tall on coarse pointers.
- No backend or contract change: `SimulationStartRequest.origin` is already a position. Real unit availability is out of scope.

## B. Map chrome, route framing, driver labels

Problems: (1) the attribution line repeats "All signal states are simulated" on every screen; (2) the route fit ignores the top navigation bar and the driver bottom sheet, so routes are cut off; (3) driver-mode junction labels (`INT-0270 · Aleja … · NORMAL`) cover much of a phone map.

Decisions:

- **Attribution:** remove `"All signal states are simulated"` from the MapLibre custom attribution. Data and basemap attribution are unchanged (desktop: the full line; narrow maps: MapLibre's compact control, collapsed at load as today). The persistent label is the existing provenance chip (`Simulated · all signal states`), which stays visible in every workspace, as `docs/engineering/domain-invariants.md` requires. The setup consoles keep their full sentence.
- **Occluder-aware framing:** each floating overlay over the map is marked `data-map-occluder`: the workspace header (navigation + actions), the inspector / desktop compact card, the phone bottom sheet panel, the driver status overlay, the provenance chip, the Focus exit button. MapLibre's bottom-right control group is also counted. The fit padding comes from their measured rectangles:
  - an occluder that does not intersect the map, or has zero area, is ignored;
  - for each remaining occluder, compute how far it intrudes from each map edge (top: `rect.bottom − map.top`; bottom: `map.bottom − rect.top`; left: `rect.right − map.left`; right: `map.right − rect.left`) and reserve it on the edge with the smallest intrusion relative to its axis (top/bottom divided by the map height, left/right by the width), so a full-width sheet is always reserved at the bottom; ties go top, bottom, left, right;
  - padding per edge = max reservation on that edge + `ROUTE_FIT_MARGIN_PX` (32);
  - if `top + bottom` exceeds 60 % of the map height (or `left + right` 60 % of the width), both are scaled down proportionally to that limit.
- Both the route fit (run start, "Show route") and the endpoint fit (station + incident before a run) use this padding. The hard-coded `mapPadding` / `detailsOpen` path and the endpoint-fit constants are removed.
- **Refit:** after the run-start fit, the camera refits when occluders change (details toggled, sheet snapped, overlay resized), but only while the camera is in `overview` and the user has not panned or zoomed since the last fit. "Show route" clears that flag.
- **Driver labels** (driver workspace only; other workspaces unchanged):
  - only the next two upcoming route intersections are labelled: the first two in the tick's `intersections` with `tti_seconds !== null`. Every other intersection is a dot without label;
  - label text is the distinguishing street name: split the intersection name on ` / `, drop parts that also appear in the previous or next route intersection's name; if nothing is left, use the first part. A null name or a coordinate name (`50.07118, 20.00717`) gets no label;
  - no ID and no state word (the dot colour carries state). Sans 11 px, medium weight, one line, max width 11 rem, ellipsis;
  - the ARIA label stays the full `coarseMarkerLabels` text.
- The tab bar in driver mode is unchanged.

## C. Emergency access ways

Problem: an incident more than 150 m from a routable node is rejected. Measured on the snapshot: Błonia and Park Jordana interiors contain only `footway` / `path` / `steps` (no track, no emergency-tagged way), so C does **not** fix Błonia; D does. C fixes forest and outskirts locations (2,278 `highway=track` ways city-wide) and about 100 `access=no|private` ways tagged for emergency vehicles.

- A way becomes routable as an **access way** when either:
  - `highway=track`, `access` not in `{private, no}`, and `tracktype` absent or in `{grade1, grade2, grade3}`; or
  - `emergency` in `{yes, designated, official}` and `highway` in the drivable classes ∪ `{track, pedestrian}`, whatever its `access` value.
- Ways that are already drivable stay drivable; access ways are only the extra ones. The T1 profile (`drivable ways` baseline 50,107) is unchanged: access ways are kept in a separate scan list and merged in `prepare_scan`.
- Class default speeds (placeholders, uncalibrated): `track` 15 km/h, `pedestrian` 10 km/h. The ambulance speed clamp (`ambulance_min_speed_kmh`) still applies.
- `data/processed/` is rebuilt; the change is reviewed with the ETL equivalence harness.

## D. On-foot access to off-road incidents

- Unchanged when the incident snaps normally (≤ `max_snap_distance_meters`, 150 m).
- Otherwise the destination becomes an **access node**: a main-component node whose on-foot distance to the incident is at most `max_on_foot_meters` (**800 m**, setting `GREENWAVE_SIM_MAX_ON_FOOT_METERS`). On-foot distance = straight line × `on_foot_detour_factor` (1.3); on-foot time = distance / `on_foot_speed_meters_per_second` (1.4). All three are PoC placeholders.
- The access node is chosen per origin to minimise **ambulance drive time + on-foot time**, ties by node key. It is not the nearest node by straight line.
- No access node within the limit → `DESTINATION_OFF_NETWORK`, message `Incident is farther than {limit} m on foot from any vehicle access point`.
- `plan_route` owns the fallback, so `/simulation/start`, `/simulation/compare` and `/dispatch/rank` behave the same. The client keeps sending the incident position.
- Ranking uses one seeded reversed Dijkstra (each access node seeded with its on-foot seconds) for the shortlist, then the real pipeline per station; candidates are ordered by `greenwave_seconds + on_foot.seconds`.
- The simulation ends at the access node. `time_saved` and both estimates cover the drive only; the walk is identical in both modes and shown separately.
- Contract (additive, `schema_version` stays `"1.0"`): new `OnFootLeg {access_point: Position, distance_m ≥ 0, seconds ≥ 0}`; `RankedCandidate.on_foot: OnFootLeg | null = null`; `SimulationStartResponse.destination_on_foot: OnFootLeg | null = null`. For an off-road incident, `destination_snapped` / `incident_snapped` is the access node with `snap_distance_m` = the straight-line distance.
- UI: the ranking row shows the total, with the sub-line `incl. {distance} on foot`; the map draws the incident→access connector dotted and in the beacon colour instead of the snap dash; the driver's terminal line reads `Arrived at access point in {duration} · {distance} on foot`; the rank error copy reads `No vehicle access within 800 m of this location`.
- Known limit: the straight-line walk ignores barriers (river, rail, fences). Documented, not modelled.
- Records: ADR `0009-on-foot-incident-access.md` (Proposed); architecture invariant 10, the dispatch section and the error table are updated after the human is told.
