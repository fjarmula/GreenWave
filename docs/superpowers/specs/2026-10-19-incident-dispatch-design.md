# Incident dispatch from the fastest station: design

Status: approved by the human on 2026-10-19. Plan:
`docs/superpowers/plans/2026-10-19-incident-dispatch.md`. Runs after the road-attributes,
signal-detail and data-quality phases; touches the ETL, the dataset loader, the API contract and the
dashboard.

## Intent

Today the operator picks a start and an end from two hardcoded dropdowns of three points each
(`frontend/src/components/map/dispatch-endpoints.ts`). That is not how dispatch works: a call comes
in with a location, and the system sends the unit that gets there first. This phase makes the demo
start from the emergency, not from the depot:

1. The map shows every rescue station in Kraków, by type.
2. The operator picks the requested vehicle type and enters the incident location, by typing an
   address or clicking the map.
3. The backend ranks that type's stations by the same optimised (green-wave) travel time the
   simulation already reports, and highlights the fastest.
4. The existing simulation runs from that station to the incident, unchanged.

The station list and the address index come from the OSM extract we already ship through the ETL, so
the demo stays local and deterministic.

## Goals

1. ETL stage `stations` writes `stations.parquet`: ambulance bases, hospital emergency
   departments, fire stations and police stations from the OSM extract, deduplicated, with stable ids.
2. ETL stage `addresses` writes `addresses.parquet`: one point per (street, house number) from OSM
   `addr:*` tags.
3. Backend endpoints: list stations, search addresses, rank stations for an incident.
4. Vehicle type (`AMBULANCE`, `FIRE_TRUCK`, `POLICE_CAR`) chooses which stations count and the
   vehicle icon on the map. It also goes in the simulated ITS payload, so a fire truck is not
   reported as an ambulance. Nothing else changes per type.
5. The dashboard swaps the two dropdowns for a vehicle-type control plus one incident input
   (address search with suggestions, or map click), and shows the chosen station plus the next two
   runners-up with their times.
6. Mock mode keeps working with less: map click only, straight-line nearest from a committed station
   snapshot, labelled approximate.

## Non-goals

- Station availability, crews, multiple vehicles, or several units at once.
- Speed, routing or signal behaviour that differs by vehicle type.
- Online geocoding (Nominatim or similar) or any external call at runtime.
- Address search or road-time ranking in mock mode.
- Renaming the `ambulance` telemetry field or other contract-wide renames.
- Kraków municipal address-point data (possible later; OSM only for now).

## Anti-goals

- A chosen station whose displayed time does not match the preflight estimate the run then shows.
- A ranking that is not deterministic for the same input and dataset.
- Any real dispatch or signal integration (PoC invariant: simulation only).
- Presenting hospital emergency departments as ambulance bases without saying so: each station
  carries its source kind and the UI shows it.

## Decisions taken with the human

- Input: address search **and** map click; both produce one incident point.
- "Fastest" = the optimised travel time the system already computes (green-wave estimate), not
  straight-line distance.
- Vehicle type changes the candidate stations and the icon only.
- Ambulance candidates = OSM `emergency=ambulance_station` (3 unique KPR bases in the current
  extract) **plus** hospitals with `amenity=hospital` + `emergency=yes` (~14).
- Mock mode is a minimal PoC fallback; low effort.

## Data (ETL)

Source: the existing `data/raw/osm/planet_*.osm.geojson`, read with `iter_osm_records`. No new raw
inputs, so `MANIFEST.json` is unchanged. Counts in the current extract (raw tag hits, before dedup):
fire 33, police 34, ambulance 5, `addr:housenumber` ~118k.

### `stations.parquet`

| column | type | notes |
|---|---|---|
| `station_id` | Utf8 | `STN-A-0001`, `STN-F-0001`, `STN-P-0001`; numbered per vehicle type in order of (lat, lng, osm ref) so ids stay stable across reruns of the same extract |
| `vehicle_type` | Utf8 | `AMBULANCE` / `FIRE_TRUCK` / `POLICE_CAR` |
| `source_kind` | Utf8 | `ambulance_base`, `hospital_ed`, `fire_state` (PSP/JRG), `fire_volunteer` (OSP), `fire_other`, `police` |
| `name` | Utf8 | OSM `name`; fallback `operator`; else a generated label such as "Police station (unnamed)" |
| `lat`, `lng` | Float64 | WGS84. Point features: their coordinates. Polygons: a representative point (`point_on_surface`) |
| `osm_ref` | Utf8 | provenance, e.g. line number plus the OSM id when present |
| `snap_distance_m` | Float64 | distance to the routable network computed by the ETL |

Rules:
- Selection tags: ambulance `emergency=ambulance_station`; hospital ED `amenity=hospital` and
  `emergency=yes`; fire `amenity=fire_station`; police `amenity=police`.
- Fire `source_kind` comes from the name: `PSP`/`Jednostka Ratowniczo-Gaśnicza` → `fire_state`;
  `OSP`/`Ochotnicza` → `fire_volunteer`; else `fire_other`. All three are candidates.
- Police: all `amenity=police` features are candidates. An exclusion list (e.g. by `police:type`
  or name) goes in `etl/config.py`, labelled placeholder and empty by default; the builder reports
  the police names in the ETL report so the human can decide.
- Dedup: same `vehicle_type`, same normalised name, within `station_dedup_radius_m` (config,
  placeholder 150 m) → one row; keep the point feature over the polygon (a point usually marks the
  entrance). Same rule for unnamed features without the name match: no dedup.
- Stations farther than the router's snap limit from the network are dropped and listed in the ETL
  report with reasons, never silently removed.
- Report section `stations`: counts by vehicle type and source kind, duplicates merged, dropped
  rows, and the police names.

### `addresses.parquet`

| column | type | notes |
|---|---|---|
| `street` | Utf8 | `addr:street`, or `addr:place` when there is no street |
| `housenumber` | Utf8 | `addr:housenumber` as written |
| `search_key` | Utf8 | lowercased, diacritics folded, street prefixes (`ul.`, `al.`, `os.`) stripped; reuse `normalise_street_name` where it fits |
| `lat`, `lng` | Float64 | point or representative point |

Dedup on (normalised street, housenumber): keep the first in a stable sort. Features without both
street/place and housenumber are skipped (counted in the report). Addresses farther than the
router's snap limit (`max_snap_distance_meters`, 150 m) from the routable network are dropped and
counted in the report, so a geocode suggestion never fails ranking as off network. *Builder's call.* Expected size ~100k rows, a few
MB; it is loaded in memory.

### Loader and integrity

`ProcessedDataset` gains `stations` and `addresses` DataFrames. They are hashed and validated like
the other artifacts (required columns, dtypes, non-null keys, coordinates inside the extract
bounds). `LoadedCounts` gains both counts. Missing files fail startup with the usual clear "run the
ETL" error. `backend/README.md` lists the two new commands and the extra OSM features used
(attribution is unchanged: same source).

## Ranking

Input: incident `Position`, `vehicle_type`.

1. Snap the incident with the existing planner snap. Off network → `DESTINATION_OFF_NETWORK` (422).
2. Shortlist: one single-source Dijkstra from the incident node over the **reversed** graph, using
   the same edge weight `plan_route` minimises (`ambulance_edge_seconds`), gives the motion time
   from every station node of that type. Unreachable stations are skipped. Keep the best
   `dispatch_shortlist_size` (setting, default 5).
3. For each shortlisted station run the real pipeline (`plan_route` and the route model) and compute
   `estimate_times(...).greenwave_seconds`, i.e. motion plus the per-intersection minimum delay.
   This is the number the preflight estimate shows, so the chosen station and the run agree.
4. Rank by (`greenwave_seconds`, `station_id`). Return the winner and the next two.
5. No reachable station → `NO_STATION_REACHABLE` (422, new error code).
6. A station that snaps to the same node as the incident cannot be routed (`plan_route` raises
   `NoRoute`). It is left out of the candidates, and the response sets
   `station_at_incident: Station | null` to it. The UI shows "A station of this type is at this
   location; dispatching from the next fastest." *Builder's call.*

The shortlist cutoff is a speed shortcut. Because the per-intersection delay can change the order,
it is approximate by design; a size of 5 keeps the risk small. Tests pin that the winner equals the
brute-force best on fixtures.

## API (additive, `schema_version` stays `"1.0"`)

Pydantic schemas first, then export OpenAPI and regenerate frontend types.

- `GET /api/v1/stations` → `{schema_version, stations: [{station_id, vehicle_type, source_kind, name, position}]}`. All types; the frontend filters.
- `GET /api/v1/geocode?q=<text>&limit=<1..10, default 8>` → `{schema_version, results: [{label, position}]}`.
  `q` is 2–100 characters. Matching: normalise `q` the same way as `search_key`; split a trailing
  house-number token if present; street must start with the remaining text (then contain it, as a
  fallback); with a house number, an exact house-number match ranks first, then house numbers that
  start with it. Ties: street then house number in natural order. `label` = "Street 15".
- `POST /api/v1/dispatch/rank` with `{incident: Position, vehicle_type}` →
  `{schema_version, incident_snapped: SnappedEndpoint, candidates: [{station: Station, greenwave_seconds, distance_m}]}`,
  `station_at_incident: Station | null` (ranking step 6); `candidates` has 1–3 items, best first.
- `VehicleType` enum `AMBULANCE | FIRE_TRUCK | POLICE_CAR`.
  `SimulationStartRequest.vehicle_type: VehicleType = AMBULANCE` (optional, so old clients still
  work). `ItsDispatchPayload.vehicle_type` widens from `Literal["AMBULANCE"]` to `VehicleType` and
  carries the request's value. The `ambulance` telemetry field keeps its name (non-goal).
- Start still takes `origin` and `destination`: the frontend sends the chosen station's position as
  `origin` and the incident as `destination`. The engine is unchanged.

Widening the ITS literal touches ADR 0003 (contract v1). The plan adds a short ADR (0006) recording
the additive change; the human is told before `GreenWave_ARCHITECTURE.md` is edited.

## Dashboard

- **Remove** `dispatch-endpoints.ts` and the two `NodeSelect` dropdowns.
- **Vehicle type**: a segmented control (Ambulance / Fire / Police), default Ambulance.
- **Incident input**: one combobox. Typing ≥2 characters calls geocode (debounced ~250 ms) and
  lists suggestions; choosing one sets the incident. Hint under it: "or click the map". A map click
  sets the incident to the clicked point and fills the box with "Pinned 50.0614, 19.9366".
- **Ranking**: after the incident or vehicle type changes, call rank. Show the chosen station (name,
  source kind such as "Hospital emergency dept.", time) and two runners-up. Errors show inline
  ("Location is off the road network", "No station of this type can reach this location").
- **Start**: the existing Initialize/Start button, enabled only when a ranking exists. *Builder's
  call: the run does not auto-start; the operator sees the choice first, then presses Start.*
- **Map**: a station layer with all stations, an icon per vehicle type; types other than the
  selected one are dimmed. The incident is a pin; the chosen station is highlighted, and runners-up
  are outlined. While a run is active, map clicks do not change the incident.
- **Vehicle marker**: `AmbulanceMarker` becomes a vehicle marker with an icon per type
  (lucide icons already in the project, no new dependency).
- All UI text English. Light/dark themes preserved.

### Mock mode

- A committed `frontend/src/data/stations.snapshot.json` (~60 rows: id, type, source kind, name,
  position), generated by a backend script from `stations.parquet`. Regenerating it is a manual
  step documented next to the script.
- Map click only; the address box is disabled with "Address search needs the backend".
- Nearest = straight-line (haversine) among the selected type, with an "Approximate (mock)" label;
  no runners-up times. The existing mock route animation runs from that station.

## Constraints

- Follow `docs/engineering/data-pipeline.md` (deterministic, report everything dropped, provenance)
  and `domain-invariants.md` (simulation only).
- Keep `src/components/map/` rendering separate from HUD; the adapter boundary
  (`simulation-adapter.ts`) gains rank/geocode/stations calls in both transports.
- No new npm or Python dependencies without approval (shapely, polars, networkx already present).
- TDD; backend and frontend checks from `AGENTS.md` green per milestone.

## Left to the builder

- Module layout (e.g. `etl/stations.py`, `etl/addresses.py`, `routing/dispatch.py`,
  `api/dispatch.py`), test fixtures, and the exact report shapes.
- Natural house-number ordering, debounce timing, icon choice, and the exact styling.
- Whether the rank endpoint caches the station-to-node snaps at startup (expected: yes).

## Calls made without the human (check these)

- Ranking by the full green-wave estimate on a shortlist of 5 found by reversed Dijkstra.
- No auto-start after the station is chosen.
- All fire units (state, volunteer, works brigade) and all police features count, with a placeholder
  exclusion list.
- Vehicle type is also sent to the backend so the ITS payload is truthful.
- Police and fire dedup radius 150 m (placeholder).
- Addresses not snappable to the network are dropped in the ETL.
- A station on the incident's own node is reported as `station_at_incident` and skipped; the run
  goes from the next fastest.
