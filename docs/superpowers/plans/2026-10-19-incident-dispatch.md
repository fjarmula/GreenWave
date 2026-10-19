# Incident Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The operator picks a vehicle type and enters an incident location (address or map click).
The backend ranks that type's stations by the green-wave estimate, and the existing simulation runs
from the fastest station to the incident.

**Architecture:** A new ETL step `places` reads the OSM extract once and writes `stations.parquet`
and `addresses.parquet`, which the dataset loader validates like the existing artifacts. The
runtime adds an address index, a station ranker (reversed Dijkstra shortlist, then the real
`plan_route` + route model + `estimate_times`) and three endpoints. The dashboard swaps its two
dropdowns for a vehicle-type control, an incident combobox and a station map layer. The engine is
unchanged apart from the ITS `vehicle_type`.

**Tech Stack:** Python 3 / FastAPI / Pydantic / polars / networkx / shapely (backend); Next.js /
React / MapLibre / vitest (frontend). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-19-incident-dispatch-design.md`

## Global Constraints

- Simulation only; never add real signal actuation or any outbound call at runtime.
- No new npm or Python dependencies; no lockfile change.
- Pydantic schemas are canonical. After a schema change: `cd backend && uv run python scripts/export_openapi.py && cd ../frontend && npm run generate:types`. Never hand-edit `contracts/openapi.json` or `api.generated.ts`.
- Contract change is additive; `schema_version` stays `"1.0"`.
- `VehicleType` values: `AMBULANCE`, `FIRE_TRUCK`, `POLICE_CAR`. Station ids: `STN-A-0001`, `STN-F-0001`, `STN-P-0001`.
- `source_kind` values: `ambulance_base`, `hospital_ed`, `fire_state`, `fire_volunteer`, `fire_other`, `police`.
- Snap limit everywhere: 150 m (`SimulationSettings.max_snap_distance_meters`). Station dedup radius: 150 m (placeholder). Shortlist size: 5. Candidates returned: up to 3.
- Geocode: `q` 2–100 chars, `limit` 1–10, default 8.
- Deterministic: same extract + same input → same ids, same ranking, same geocode order.
- All UI text English; preserve light/dark themes; map rendering stays in `src/components/map/`.
- UI copy (exact): "or click the map", "Address search needs the backend", "Approximate (mock)",
  "Location is off the road network", "No station of this type can reach this location",
  "A station of this type is at this location; dispatching from the next fastest.",
  "Hospital emergency dept." (label for `hospital_ed`).
- Checks per milestone. `backend/`: `uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`. `frontend/`: `npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`.
- Git: stage explicit paths; subject `<category>: <message>`; end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push or branch operations.
- Tell the human before editing `GreenWave_ARCHITECTURE.md` or `AGENTS.md`.

## Plan-level decisions (deviations from spec wording)

- The spec's "stages `stations` and `addresses`" become **one** CLI step, `places`, so the 310 MB
  extract is read once (~20 s). It writes one report section, `places`, with `stations` and
  `addresses` sub-objects.
- `places` runs after `intersections`. It snaps to `network_nodes.parquet` and records the hashes of
  the network files it consumed, following the `neighbours` pattern.

## Review Focus

1. A polygon-only station (no point feature) → represented by `point_on_surface` and kept, never dropped for lacking a point. Pinned in Task 1.
2. A geocode query with Polish diacritics or a prefix ("Floriańska", "florianska 1", "ul. Floriańska 15") → the same results in the same order. Pinned in Task 6.
3. An incident clicked exactly on a station's node → that station goes in `station_at_incident`, the run goes from the next one, and Start stays enabled. Pinned in Tasks 7 and 11.
4. Switching vehicle type or incident while a rank request is in flight → the older response is discarded and never overwrites the newer one. Pinned in Task 10.
5. An unknown or empty `vehicle_type` on an old client's start request → defaults to `AMBULANCE`, and the ITS payload says `AMBULANCE`. Pinned in Task 5.

---

## Milestone 1 — Data (ETL + loader)

### Task 1: Station extraction

**Files:**
- Create: `backend/src/greenwave/etl/feature_points.py`, `backend/src/greenwave/etl/stations.py`
- Modify: `backend/src/greenwave/etl/config.py` (add constants), `backend/tests/support/osm_fixtures.py` (add `polygon`)
- Test: `backend/tests/etl/test_stations.py`

**Interfaces:**
- Produces:
  - `feature_point(feature: OsmFeature) -> tuple[float, float] | None` returns (lon, lat): the Point itself; `point_on_surface` for Polygon/MultiPolygon; None otherwise.
  - `classify_station(properties: Mapping[str, object]) -> tuple[str, str] | None` returns (vehicle_type, source_kind).
  - `@dataclass(frozen=True) StationCandidate(vehicle_type: str, source_kind: str, name: str, lon: float, lat: float, osm_ref: str, is_point: bool)`
  - `extract_station_candidates(features: Iterable[OsmFeature]) -> list[StationCandidate]`
  - `dedupe_stations(candidates: Sequence[StationCandidate], radius_m: float) -> tuple[list[StationCandidate], int]` returns (kept, merged_count).
  - `assign_station_ids(candidates: Sequence[StationCandidate]) -> pl.DataFrame` with columns `station_id, vehicle_type, source_kind, name, lat, lng, osm_ref`.
  - config: `STATION_DEDUP_RADIUS_M = 150.0` (placeholder), `POLICE_EXCLUDED_NAMES: tuple[str, ...] = ()` (placeholder), labelled per `data-pipeline.md`.
  - fixture: `polygon(ring: list[tuple[float, float]], **tags: str) -> str` in `osm_fixtures.py`.

- [ ] **Step 1: Write failing tests** in `test_stations.py`:
  - `test_classify_tags`: `{"emergency": "ambulance_station"}` → `("AMBULANCE", "ambulance_base")`. `{"amenity": "hospital", "emergency": "yes"}` → `("AMBULANCE", "hospital_ed")`. `{"amenity": "hospital"}` → `None`. `{"amenity": "police"}` → `("POLICE_CAR", "police")`.
  - `test_fire_source_kind`: names "Jednostka Ratowniczo-Gaśnicza PSP nr 1 w Krakowie" → `fire_state`, "Ochotnicza Straż Pożarna w Tyńcu" → `fire_volunteer`, "OSP Wolica" → `fire_volunteer`, "Zakładowa Straż Pożarna ArcelorMittal Poland S.A." → `fire_other`.
  - `test_name_fallbacks`: no `name` but has `operator` → the operator; neither → "Police station (unnamed)", "Fire station (unnamed)" or "Ambulance station (unnamed)".
  - `test_polygon_only_station_is_kept`: a single polygon fire station → one candidate whose point lies inside the polygon (Review Focus 1).
  - `test_dedupe_prefers_point_within_radius`: same name, point and polygon 60 m apart → one kept, `is_point=True`, merged 1. Same name 400 m apart → both kept. Different names 10 m apart → both kept. Unnamed pair 10 m apart → both kept.
  - `test_police_exclusion_list`: with `POLICE_EXCLUDED_NAMES` monkeypatched to `("Biuro",)` a police feature named "Biuro" is not a candidate.
  - `test_ids_stable_and_per_type`: ids are `STN-F-0001…` ordered by (lat, lng, osm_ref) within a type; shuffling the input gives the same frame.
- [ ] **Step 2: Run** `uv run pytest tests/etl/test_stations.py -v` → FAIL (module missing).
- [ ] **Step 3: Implement** both modules. Measure dedup distance in metres with `project_points` (EPSG:2178). Compare names with `normalise_street_name` folding (case and diacritics). `osm_ref` = `f"line:{line_number}"`, plus `|osm:{@id}` when the properties carry an OSM id key.
- [ ] **Step 4: Run** the tests → PASS.
- [ ] **Step 5: Commit** `feat: extract rescue stations from OSM features`.

### Task 2: Address extraction

**Files:**
- Create: `backend/src/greenwave/etl/addresses.py`
- Test: `backend/tests/etl/test_addresses.py`

**Interfaces:**
- Consumes: `feature_point` (Task 1); `normalise_street_name` (`etl/street_names.py`).
- Produces:
  - `address_search_key(street: str) -> str` = `normalise_street_name(street)`. One function, used by both the ETL and the runtime index (Task 6).
  - `@dataclass(frozen=True) AddressCandidate(street: str, housenumber: str, lon: float, lat: float)`
  - `extract_addresses(features: Iterable[OsmFeature]) -> tuple[pl.DataFrame, int]` returns (frame `street, housenumber, search_key, lat, lng` deduplicated on (`search_key`, lowercased `housenumber`), skipped_count).

- [ ] **Step 1: Write failing tests:**
  - `test_street_or_place`: `addr:street` used when present; else `addr:place`; neither → skipped (count 1).
  - `test_missing_housenumber_skipped`.
  - `test_search_key_folds`: `address_search_key("ul. Floriańska") == address_search_key("Florianska")`.
  - `test_dedup_keeps_first_in_stable_sort`: two features "Floriańska 15" at different points → one row; the same input in reversed order gives the same row (sort by `search_key, housenumber, lat, lng` before dedup).
  - `test_building_polygon_address`: polygon with addr tags → one row inside the polygon.
- [ ] **Step 2: Run** `uv run pytest tests/etl/test_addresses.py -v` → FAIL.
- [ ] **Step 3: Implement.** If importing `greenwave.etl.street_names` would pull ETL pipeline modules into the server import graph, move `normalise_street_name` and its helpers to `greenwave/text.py` and re-export them from `street_names`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: extract OSM addresses for local geocoding`.

### Task 3: `places` ETL step

**Files:**
- Create: `backend/src/greenwave/etl/places_pipeline.py`
- Modify: `backend/src/greenwave/artifacts.py` (add `STATIONS_FILENAME = "stations.parquet"`, `ADDRESSES_FILENAME = "addresses.parquet"`, `PLACES_ARTIFACT_FILENAMES`), `backend/scripts/run_etl.py` (subcommand `places`), `backend/src/greenwave/etl/config.py` (`PLACES_MAX_SNAP_DISTANCE_M = 150.0`, with a comment that it must equal the `SimulationSettings` default), `backend/tests/support/pipeline_fixtures.py` (stations and addresses near the tiny network), `backend/tests/support/processed.py` (`build_layout` also runs `run_places`), `backend/README.md` (command plus the extra OSM features used)
- Test: `backend/tests/etl/test_places_pipeline.py`

**Interfaces:**
- Consumes: Tasks 1–2; `iter_osm_records`; `network_nodes.parquet`; the `intersections` section's `artifact_sha256`.
- Produces:
  - `class StationsReport(BaseModel)`: `by_vehicle_type: dict[str, int]`, `by_source_kind: dict[str, int]`, `duplicates_merged: int`, `dropped: list[DroppedPlace]` (name, vehicle_type, reason, snap_distance_m), `police_names: list[str]`.
  - `class AddressesReport(BaseModel)`: `rows: int`, `skipped_missing_tags: int`, `dropped_off_network: int`.
  - `class PlacesSection(BaseModel)`: `manifest_sha256: str`, `consumed_sha256: dict[str, str]` (network nodes and edges), `artifact_sha256: dict[str, str]`, `stations: StationsReport`, `addresses: AddressesReport`.
  - `run_places(raw_dir: Path, processed_dir: Path) -> PlacesSection` writes both parquet files. `stations.parquet` gains `snap_distance_m: Float64`.

- [ ] **Step 1: Write failing tests:**
  - `test_places_writes_artifacts_and_section`: on `make_raw` + intersections, both files exist; the section's `artifact_sha256` matches the files on disk; `consumed_sha256` matches the intersections section's recorded hashes.
  - `test_far_station_dropped_and_reported`: a station 500 m from every node → absent from parquet, present in `dropped` with reason `"off_network"`.
  - `test_far_address_dropped_counted`: an address 500 m away → `dropped_off_network == 1`.
  - `test_snap_limit_matches_settings`: `PLACES_MAX_SNAP_DISTANCE_M == SimulationSettings().max_snap_distance_meters`.
  - `test_rerun_identical`: two runs → identical file hashes.
- [ ] **Step 2: Run** `uv run pytest tests/etl/test_places_pipeline.py -v` → FAIL.
- [ ] **Step 3: Implement** a single pass over `iter_osm_records` feeding both extractors. Snap with a shapely `STRtree` over projected network nodes. Refuse to run (clear error naming the intersections step) when the network files' hashes differ from the intersections section, as `run_neighbours` does. `run_etl.py places` writes the section via `update_report_section(report, "places", …)`.
- [ ] **Step 4: Run** → PASS; then the full `uv run pytest` (fixtures changed).
- [ ] **Step 5: Run on real data** with `uv run python scripts/run_etl.py places`. Record the counts by type and source kind in the commit body. Expected roughly 3 `ambulance_base`, ~14 `hospital_ed`, ~17 fire, ≤34 police, ~100k addresses. Flag anything far off.
- [ ] **Step 6: Commit** `feat: add places ETL step for stations and addresses`.

### Task 4: Loader

**Files:**
- Modify: `backend/src/greenwave/dataset/constants.py` (`PRODUCED_BY`, `REQUIRED_COLUMNS` for both files), `loader.py`, `integrity.py`, `models.py`
- Test: `backend/tests/dataset/test_loader.py`

**Interfaces:**
- Produces: `ProcessedDataset.stations: pl.DataFrame`, `ProcessedDataset.addresses: pl.DataFrame`; `LoadedCounts.stations: int`, `LoadedCounts.addresses: int`.

- [ ] **Step 1: Write failing tests:**
  - `test_loads_stations_and_addresses`: counts match the fixture.
  - `test_missing_places_artifact_names_step`: delete `stations.parquet` → `DatasetError` whose message contains `run_etl.py places`.
  - `test_places_hash_mismatch_rejected`: edit `addresses.parquet` → error.
  - `test_station_outside_bounds_rejected`: a station lat 10° outside the network node bbox (padded by 0.01°) → error.
  - `test_unknown_vehicle_type_rejected`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** following the `neighbours` checks. **Step 4: Run** the full backend checks → PASS.
- [ ] **Step 5: Commit** `feat: load and validate stations and addresses`.

**Milestone 1 checkpoint:** backend checks green; report the real-data counts and the `police_names` list to the human, so they can decide on exclusions.

## Milestone 2 — Backend contract and services

### Task 5: Schemas, contract and ADR

**Files:**
- Create: `backend/src/greenwave/schemas/dispatch.py`, `docs/adr/0006-incident-dispatch-contract.md`
- Modify: `backend/src/greenwave/schemas/__init__.py`, `schemas/simulation.py`, `simulation/dispatch.py`, `simulation/engine.py`, `simulation/assembly.py`; regenerate `contracts/openapi.json` and `frontend/src/types/api.generated.ts`
- Test: `backend/tests/schemas/test_dispatch_schemas.py`, `backend/tests/simulation/test_dispatch.py` (existing or new)

**Interfaces:**
- Produces (in `schemas/dispatch.py`):
  - `class VehicleType(StrEnum)`: `AMBULANCE`, `FIRE_TRUCK`, `POLICE_CAR`
  - `class StationSourceKind(StrEnum)`: the six values
  - `Station(station_id: str (pattern ^STN-[AFP]-\d{4}$), vehicle_type, source_kind, name, position: Position)`
  - `StationsResponse(schema_version, stations: list[Station])`
  - `GeocodeResult(label: str, position: Position)`; `GeocodeResponse(schema_version, results: list[GeocodeResult])`
  - `DispatchRankRequest(incident: Position, vehicle_type: VehicleType)`
  - `RankedCandidate(station: Station, greenwave_seconds: float (≥0), distance_m: float (≥0))`
  - `DispatchRankResponse(schema_version, incident_snapped: SnappedEndpoint, candidates: list[RankedCandidate] (1..3), station_at_incident: Station | None)`
  - `ErrorCode.NO_STATION_REACHABLE`
  - `SimulationStartRequest.vehicle_type: VehicleType = VehicleType.AMBULANCE`; `ItsDispatchPayload.vehicle_type: VehicleType`
  - `build_dispatch_payload(..., vehicle_type: VehicleType)`. `SimulationEngine` takes `vehicle_type` from `plan_simulation(request)`.

- [ ] **Step 1: Write failing tests:**
  - `test_start_request_defaults_vehicle_type`: a body without `vehicle_type` → `AMBULANCE` (Review Focus 5). A body with `"vehicle_type": "TANK"` → validation error.
  - `test_its_payload_carries_vehicle_type`: an engine run with `FIRE_TRUCK` emits ITS events with `vehicle_type == "FIRE_TRUCK"`.
  - `test_rank_response_bounds`: 0 or 4 candidates → validation error.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; export OpenAPI and regenerate types; fix frontend type fallout only where it is compile-required (`mock-session.ts` keeps `"AMBULANCE"` until Task 10).
- [ ] **Step 4: Write ADR 0006** (template `0001-template.md`): additive endpoints, widened ITS `vehicle_type`, `ambulance` field name kept, `schema_version` 1.0. Status Accepted, pending human review.
- [ ] **Step 5: Run** backend and frontend checks → PASS; the OpenAPI drift check is clean.
- [ ] **Step 6: Commit** `feat: add dispatch contract and vehicle type`.

### Task 6: Address index and geocode endpoint

**Files:**
- Create: `backend/src/greenwave/places/__init__.py`, `backend/src/greenwave/places/address_index.py`, `backend/src/greenwave/api/dispatch.py`
- Modify: `backend/src/greenwave/main.py` (build the index in the lifespan into `app.state.address_index`; `include_router`)
- Test: `backend/tests/places/test_address_index.py`, `backend/tests/api/test_dispatch_api.py`

**Interfaces:**
- Consumes: `address_search_key` (Task 2), `ProcessedDataset.addresses`.
- Produces: `class AddressIndex` with `from_frame(frame: pl.DataFrame) -> AddressIndex` and `search(query: str, limit: int) -> list[GeocodeResult]`. Route `GET /api/v1/geocode`.

Matching (spec): normalise `q` with `address_search_key`. If the last token matches `^\d+[a-z]?(/\d+[a-z]?)?$`, it is the house number. Street candidates: `search_key.startswith(rest)`, then (only if there are fewer than `limit`) `rest in search_key`. With a house number: exact match first, then house numbers starting with it; without one, all house numbers. Order: (match tier, street, natural house number), where natural = (leading int, remainder). `label` = `f"{street} {housenumber}"`.

- [ ] **Step 1: Write failing tests** (fixture of ~10 rows):
  - `test_diacritics_and_prefix_equivalent`: "Floriańska", "florianska", "ul. Floriańska" → identical result lists (Review Focus 2).
  - `test_house_number_exact_first`: "floriańska 1" → "Floriańska 1" first, then "Floriańska 1a", "Floriańska 10", "Floriańska 15"; "Floriańska 2" absent.
  - `test_natural_order`: without a number → 1, 2, 10, 15 (not 1, 10, 15, 2).
  - `test_contains_fallback`: fixture streets "Długa" and "Przy Długiej"; query "dlu" → all "Długa" rows (starts-with) before "Przy Długiej" rows (contains).
  - `test_limit_respected`.
  - API: `q` of 1 char → 422; `limit=11` → 422; normal query → 200 with `schema_version "1.0"`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: add local address geocoding endpoint`.

### Task 7: Station ranking

**Files:**
- Create: `backend/src/greenwave/routing/station_ranking.py`
- Modify: `backend/src/greenwave/routing/errors.py` (`NoStationReachable`), `backend/src/greenwave/simulation_settings.py` (`dispatch_shortlist_size: int = Field(default=5, ge=1)`), `backend/tests/support/route_fixtures.py` (stations on the tiny network)
- Test: `backend/tests/routing/test_station_ranking.py`

**Interfaces:**
- Consumes: `RoutingIndex`, `plan_route`, `build_route_model(route, index, settings, False)`, `estimate_times`, `_edge_weight` (make it public as `edge_weight` in `planner.py`, keeping one definition).
- Produces:
  - `@dataclass(frozen=True) StationNode(station: Station, node_key: str)`
  - `build_station_nodes(stations: pl.DataFrame, index: RoutingIndex) -> tuple[StationNode, ...]`: snaps each station; skips unsnappable ones with a WARNING.
  - `@dataclass(frozen=True) RankedStation(station: Station, greenwave_seconds: float, distance_m: float)`
  - `@dataclass(frozen=True) StationRanking(incident_snap: SnappedRouteEndpoint, candidates: tuple[RankedStation, ...], station_at_incident: Station | None)`
  - `rank_stations(index: RoutingIndex, stations: Sequence[StationNode], incident: Position, vehicle_type: VehicleType, settings: SimulationSettings) -> StationRanking`. Raises `DestinationOffNetwork` or `NoStationReachable`.

Algorithm:
```
incident_snap = snap incident (destination semantics)
same = [s for s of type if s.node_key == incident node]; station_at_incident = min(same, key=id) or None
times = nx.single_source_dijkstra_path_length(index.graph.reverse(copy=False), incident node,
                                              weight=edge_weight(...))
shortlist = sorted(reachable stations of type not in same, key=(times[node], id))[:shortlist_size]
for each: route = plan_route(index, station.position, incident, settings)  # skip on NoRoute
          estimates = estimate_times(route, build_route_model(route, index, settings, False), 1.0, settings)
rank by (greenwave_seconds, station_id); return top 3; none → NoStationReachable
```

- [ ] **Step 1: Write failing tests:**
  - `test_winner_matches_bruteforce`: on fixtures, for several incidents, the winner equals the minimum `greenwave_seconds` over all stations of the type computed by brute force.
  - `test_displayed_time_matches_preflight`: the winner's `greenwave_seconds` equals `plan_simulation(...)`'s start response greenwave estimate for origin = station, destination = incident.
  - `test_filters_by_vehicle_type`.
  - `test_station_at_incident_reported_and_skipped` (Review Focus 3).
  - `test_off_network_incident_raises`; `test_no_station_reachable_raises` (a station in a disconnected component).
  - `test_deterministic_tie_break`: equal times → lower `station_id` first.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: rank stations by green-wave estimate`.

### Task 8: Stations and rank endpoints

**Files:**
- Modify: `backend/src/greenwave/api/dispatch.py`, `backend/src/greenwave/main.py` (`app.state.station_nodes` built in the lifespan)
- Test: `backend/tests/api/test_dispatch_api.py`

**Interfaces:**
- Produces: `GET /api/v1/stations` → `StationsResponse` (all snapped stations, sorted by `station_id`). `POST /api/v1/dispatch/rank` → `DispatchRankResponse`. Off network → 422 `DESTINATION_OFF_NETWORK`; nothing reachable → 422 `NO_STATION_REACHABLE`.

- [ ] **Step 1: Write failing API tests** for the 200 bodies and both 422s (`ErrorResponse` shape, as in `test_simulation_api.py`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; re-export OpenAPI and regenerate types. **Step 4: Run** backend checks → PASS.
- [ ] **Step 5: Snapshot script**: create `backend/scripts/export_station_snapshot.py`, which writes `frontend/src/data/stations.snapshot.json` (`StationsResponse` JSON, sorted). Test `backend/tests/scripts/test_export_station_snapshot.py` checks that the output validates as `StationsResponse`. Run it on real data; commit the JSON.
- [ ] **Step 6: Commit** `feat: add stations and dispatch rank endpoints`.

**Milestone 2 checkpoint:** backend checks green; with `curl` on a local server, rank an incident near Rynek Główny for each vehicle type and report the winners.

## Milestone 3 — Dashboard

### Task 9: Adapter extensions

**Files:**
- Create: `frontend/src/lib/dispatch-adapter.ts`, `frontend/src/lib/mock-dispatch.ts`
- Modify: `frontend/src/lib/transport/backend-simulation-adapter.ts` (or a sibling `backend-dispatch-adapter.ts` reusing its fetch/error helpers), `frontend/src/lib/transport/validate.ts`, `frontend/src/types/telemetry.ts` (aliases)
- Test: `frontend/src/lib/mock-dispatch.test.ts`, `frontend/src/lib/transport/backend-dispatch-adapter.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DispatchAdapter = {
    capabilities: { geocode: boolean; roadTimeRanking: boolean };
    listStations(): Promise<Station[]>;
    geocode(query: string, signal?: AbortSignal): Promise<GeocodeResult[]>;
    rank(request: DispatchRankRequest, signal?: AbortSignal): Promise<DispatchRankResponse>;
  };
  export const dispatchAdapter: DispatchAdapter; // chosen like simulationAdapter
  ```
  Mock: `capabilities = {geocode: false, roadTimeRanking: false}`. `listStations` reads `stations.snapshot.json`. `geocode` rejects. `rank` picks the haversine-nearest station of the type and returns a single candidate (`greenwave_seconds: 0`, `distance_m` = haversine) with `incident_snapped` = the input at 0 m.
  Errors map to `SimulationAdapterError` with the backend `error_code`.

- [ ] **Step 1: Write failing tests:** mock nearest by haversine per type; backend adapter validates bodies (rejects a malformed `candidates`) and maps the 422 codes; aborting a request rejects with an abort error, not a domain error.
- [ ] **Step 2: Run** `npm test -- dispatch` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: add dispatch adapter for stations, geocode and ranking`.

### Task 10: Dispatch state and start request

**Files:**
- Create: `frontend/src/lib/useIncidentDispatch.ts`
- Modify: `frontend/src/lib/start-request.ts`, `frontend/src/lib/mock-session.ts` (ITS `vehicle_type` from the request)
- Test: `frontend/src/lib/useIncidentDispatch.test.ts`, `frontend/src/lib/start-request.test.ts`

**Interfaces:**
- Produces:
  - `type Incident = { position: Position; label: string; source: "address" | "map" }`
  - `useIncidentDispatch(adapter: DispatchAdapter) -> { vehicleType, setVehicleType, incident, setIncident, ranking: DispatchRankResponse | null, rankStatus: "idle" | "loading" | "ready" | "error", rankError: string | null }`. Re-ranks on every vehicleType/incident change and aborts the previous request.
  - `buildStartRequest(origin: Station, incident: Incident, vehicleType: VehicleType, settings: DispatchSettings, simulationId: string): SimulationStartRequest`
  - Error copy: `DESTINATION_OFF_NETWORK` → "Location is off the road network"; `NO_STATION_REACHABLE` → "No station of this type can reach this location".

- [ ] **Step 1: Write failing tests:**
  - `test_stale_rank_discarded`: change the incident twice; resolve the first response last → the state holds the second (Review Focus 4).
  - `test_vehicle_type_change_reranks`.
  - `test_error_copy` for both codes.
  - `buildStartRequest`: origin = station position, destination = incident position, `vehicle_type` set.
  - Mock ITS event carries the request's `vehicle_type`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: add incident dispatch state`.

### Task 11: Dispatch form

**Files:**
- Create: `frontend/src/components/hud/dispatch/VehicleTypeControl.tsx`, `IncidentInput.tsx`, `StationRanking.tsx`
- Modify: `frontend/src/components/hud/DispatchForm.tsx`, `frontend/src/components/dashboard.tsx`
- Delete: `frontend/src/components/hud/dispatch/NodeSelect.tsx` (if unused elsewhere), `frontend/src/components/map/dispatch-endpoints.ts`
- Test: `frontend/src/components/hud/DispatchForm.snapshot.test.tsx` (update), `frontend/src/components/hud/dispatch/IncidentInput.test.tsx`, `StationRanking.test.tsx`

**Interfaces:**
- Consumes: `useIncidentDispatch` (Task 10).
- Produces: `DispatchForm` props swap `originId/destinationId/on*Change` for `dispatch: ReturnType<typeof useIncidentDispatch>` and `capabilities`. `onInitialize` builds the request via `buildStartRequest` with `ranking.candidates[0].station`.

- [ ] **Step 1: Write failing tests:**
  - `IncidentInput`: typing 1 char → no call; 2+ chars → one geocode call after the 250 ms debounce (fake timers); choosing a suggestion calls `setIncident` with `source: "address"`; with `capabilities.geocode=false` the input is disabled and shows "Address search needs the backend"; the hint "or click the map" is shown.
  - `StationRanking`: the winner plus 2 runners-up with formatted times (`format-duration`); `hospital_ed` shows "Hospital emergency dept."; `station_at_incident` shows the exact notice copy; mock shows "Approximate (mock)" and no times.
  - `DispatchForm`: Start is disabled until `rankStatus === "ready"` with ≥1 candidate, and enabled when `station_at_incident` is set and candidates exist (Review Focus 3).
  - Snapshots updated for both transports.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; remove the endpoint lists and fix their importers (`simulation-copy.ts`, the golden test, fixtures). **Step 4: Run** the frontend checks → PASS.
- [ ] **Step 5: Commit** `feat: replace endpoint dropdowns with incident dispatch form`.

### Task 12: Map layers and vehicle marker

**Files:**
- Create: `frontend/src/components/map/StationLayer.tsx`, `frontend/src/components/map/IncidentMarker.tsx`, `frontend/src/components/map/vehicle-icons.ts`
- Modify: `frontend/src/components/map/EndpointMarkers.tsx` (or fold it into the two new components; the origin = chosen station, the destination = incident), `MapContainer.tsx` (map click → `onMapClick(position)`, ignored while `live`), rename `AmbulanceMarker.tsx` → `VehicleMarker.tsx` with a `vehicleType` prop
- Test: `frontend/src/components/map/vehicle-icons.test.ts`, `frontend/src/components/map/station-layer.test.ts` (pure feature-building helpers)

**Interfaces:**
- Produces:
  - `vehicleIcon(type: VehicleType): LucideIcon` (lucide `Ambulance`, `FlameKindling` or `Siren`; the builder picks icons that exist in the installed lucide version).
  - `stationFeatures(stations: Station[], selected: VehicleType, chosenId: string | null, runnerUpIds: string[]) -> GeoJSON.FeatureCollection` with properties `dimmed`, `role: "chosen" | "runner_up" | "other"`.

- [ ] **Step 1: Write failing tests:** `stationFeatures` marks other types `dimmed`, the chosen one `role: "chosen"`, and runners-up `runner_up`; `vehicleIcon` covers all three types.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; a map click sets the incident with label `Pinned ${lat.toFixed(4)}, ${lng.toFixed(4)}`; while `live`, clicks are ignored. **Step 4: Run** the frontend checks → PASS.
- [ ] **Step 5: Commit** `feat: show stations, incident pin and per-type vehicle icon`.

### Task 13: End-to-end check and docs

**Files:**
- Modify: `backend/README.md` (if not yet complete), `docs/engineering/frontend-dashboard.md` (one line about the mock dispatch limits), `GreenWave_ARCHITECTURE.md` (**tell the human first**: dispatch flow, new endpoints)
- Test: Playwright via the `playwright-cli` skill; output only under `.tmp/playwright/`

- [ ] **Step 1: Backend transport E2E:** start the backend and the frontend; choose Fire; type "Floriańska 1"; pick the suggestion; see a fire station highlighted with two runners-up; press Start; the vehicle marker shows the fire icon and the run completes. Screenshot to `.tmp/playwright/`.
- [ ] **Step 2: Map-click E2E:** Ambulance; click near a hospital ED → the ranking appears; a click during the run does not change the incident.
- [ ] **Step 3: Mock transport E2E:** the address box is disabled with the exact copy; a map click picks a station with "Approximate (mock)"; the run animates.
- [ ] **Step 4:** All backend and frontend checks green; `graphify update .`.
- [ ] **Step 5: Commit** `docs: document incident dispatch flow`.

**Final checkpoint:** verify every spec goal (1–6) and anti-goal against the tasks above; report deviations (the single `places` step and its single report section) and the police-exclusion decision to the human.
