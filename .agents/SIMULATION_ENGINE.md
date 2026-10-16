# Simulation engine: plan and steps for coding agents

Status: **DRAFT** by the lead analyst, 2026-10-15, revised after the backend cleanup. Nothing here is
approved until the human says so. Items marked **OPEN** need a human decision. Do not decide them by
guessing.

**Do not start S0 until the human says so.** The human and the frontend contributor first share their
work and agree how the two parts connect; this document is then revised to match that plan.

Scope: everything after the data pipeline: route search, route analysis, the 1 Hz simulation, the
mocked ITS gateway, the API and stream, and the integration with the dashboard. This file adds to
`.agents/INSTRUCTIONS.md` and `.agents/DATA_PIPELINE.md`; it does not replace them. Where they
disagree, stop and tell the human. Implement only the step you are asked to, do not start the next
step without approval, and do not commit or push unless asked.

## 1. What is already built (do not redo)

The data pipeline (T0-T8) is finished. The server loads `backend/data/processed/` once at startup
(`greenwave.dataset.load_dataset`, run in the FastAPI lifespan, result on `app.state.dataset`;
`create_app(dataset=...)` lets tests inject one). It refuses to start when an artifact is missing,
stale or from a different run. Paths: `GREENWAVE_PROCESSED_DIR`, `GREENWAVE_RAW_MANIFEST_PATH`.

Package layout (after the cleanup): `greenwave/dataset/` holds `loader.py` (only `load_dataset`),
`models.py` (the model classes and `ProcessedDataset`), `helpers.py`, `constants.py`, `errors.py` and
`settings.py`. `greenwave/artifacts.py` holds the artifact file names and hashing shared by the ETL
and the loader. The public API is `greenwave.dataset`. Engine and API code import from there and
never from `greenwave.etl` (see section 3).

`ProcessedDataset` holds (values are for the pinned snapshot only):

| Field | Content |
|---|---|
| `graph` | `networkx.MultiDiGraph`, 34,777 nodes, 68,619 directed edges, structure frozen (`nx.freeze`). Node attributes `lon, lat, x_m, y_m` (x_m/y_m are EPSG:2178 metres). Edge attributes `edge_id, base_edge_id, length_m, highway, speed_kmh, speed_source, oneway_source, lanes, name, junction, geometry (shapely, EPSG:2178), reverse_twin, source_line, segment_index`. The edge key is `edge_id`. 475 node pairs have parallel edges. |
| `intersections` | 534 rows `INT-0001`..`INT-0534`: 428 `signalised_junction`, 52 `midblock_signal`, 54 `pedestrian_crossing`. Has `kind`, `name`, `lon`, `lat`, `delay_seconds` (35.0 for every row today). |
| `signal_approaches` | 1,044 rows, one per counted signal or crossing node. `controlled_edge_ids` are the edges ARRIVING at the signal: the stop line is at the END of the edge. `intersection_id` is null for the 1 unsnapped row (Skwerowa crossing). Its `delay_seconds` belongs to the node and must never be summed along a route. |
| `approach_neighbours` | 1,293 candidate pairs with a stop-line to stop-line drive of at most 250 m. A candidate set only. |
| `cascade_threshold_m`, `allow_u_turns` | 250.0 (inclusive), False. |
| `provenance` | Manifest hash and the manifest entries (licence and attribution as recorded). |

Edge ids look like `W<line>.<segment>+|-`; edges split at a signal get `<edge id>~<n>` and keep
`base_edge_id`. Only 32,669 of the 34,777 nodes are in the largest strongly connected component;
the rest are islands and one-way traps, so routes must start and end inside it.

Measured by T8 (ONE run, development PC, CPU clock varied 2.0-4.6 GHz, not a benchmark of the demo
machine): shortest-path search median 9.5 ms, p95 47 ms, max about 61 ms over 1,000 sampled pairs
with `networkx.bidirectional_dijkstra`; `load_dataset` 0.80-0.85 s; server start to ready 1.46 s;
ETL rebuild of the server artifacts 32.8 s. The start-to-ready figure was measured BEFORE the
cleanup. Since then `import greenwave.main` fell from about 0.69 s to 0.47 s because the server no
longer imports the ETL pipeline or `geopandas`; start-to-ready has not been re-measured.
`scripts/benchmark.py` repeats these measurements (it has a `--quick` mode).
**No latency budget is approved yet** (see D11).

## 2. Sources of truth and known contract gaps

- `GreenWave_ARCHITECTURE.md` is authoritative for the state machine, thresholds (the ITS trigger,
  the hold duration, the multiplier range, the v_avg smoothing), the endpoints and the payloads.
  This file does not restate them. If a copy here disagrees, the architecture doc wins: tell the
  human.
- The Pydantic models in `backend/src/greenwave/schemas/` are the contract. `contracts/openapi.json`
  and `frontend/src/types/api.generated.ts` are generated; CI fails on drift. Today only
  `HealthResponse` exists.
- Branch `feature/frontend-dashboard` (the other contributor) already contains the whole dashboard
  on MOCK data, with a temporary `frontend/src/types/telemetry.ts`. Verify each point below against
  the architecture doc first; some may already be resolved there. S0 must reconcile the rest:
  1. The frontend `SignalState` includes `CLEARING_CASCADE`; the architecture proposes cascade as a
     boolean flag, not a state.
  2. The tick carries no coordinates for intersections, but the map needs them.
  3. The ITS console shows log lines, but no field carries them.
  4. `ambulance.status` is a free string in the frontend.
  5. The start response gives only the ids in `intersections_on_route`; the UI needs name, kind and
     coordinates.
  6. `simulation_id` echo, `schema_version`, `is_simulated`, and the stream and stop endpoints were
     added to the architecture doc on `feature/data-pipeline`; the frontend mock predates them.

## 3. Rules for this phase

- Simulation only. No real controller commands, ever. Every outbound value that could be mistaken for
  a physical signal state is labelled simulated, as the architecture defines.
- Engine code lives in `greenwave` modules with no FastAPI imports (suggested package
  `greenwave/engine/`). Handlers only translate between HTTP and the engine.
- All distances in EPSG:2178 metres; convert lat/lng once at the boundary, with the converter from
  D13 (not `greenwave.etl.geo`). Names carry units (`_meters`, `_seconds`).
- Dependency direction: engine and API code import `greenwave.dataset` (and `greenwave.artifacts`
  if needed), never `greenwave.etl`. The cleanup removed the ETL and `geopandas` from server
  startup; importing them again would bring the cost back and couple the runtime to the ETL.
- Time is injected (a clock or ticker). Simulation time and wall time are different things. Tests
  never sleep.
- Never fabricate a route and never repair bad input silently. Unreachable or out-of-area input is a
  typed error mapped to a 4xx.
- Delay rule (DATA_PIPELINE decision 8): D is paid ONCE per unique `INT-xxxx` whose controlled
  approach the route passes. Read it from `intersections.delay_seconds`; do not hardcode 35 and do
  not sum approach delays.
- INT ids are valid for this snapshot and configuration only. Tests must not hardcode them except
  through fixtures. `tests/support/pipeline_fixtures.py` builds tiny raw data,
  `tests/support/processed.py` builds a tiny processed directory, and the lazy session fixture
  `tiny_dataset` in `tests/conftest.py` gives a loaded `ProcessedDataset`.
- No new dependency without approval (an SSE library, for example). Prefer Starlette's
  `StreamingResponse`.
- Do not change ETL output or the loader contract without approval.
- Do not invent a performance budget. Use measured numbers, recommend, and ask.

## 4. Steps

Each step ends with tests, `ruff`, `mypy`, `pytest`, and a short report (INSTRUCTIONS.md section 10).
Stop after each step for approval.

**S0. Reconcile and propose the contract (no engine code).**
- Read the current architecture doc in full. Produce a table: every field of every payload, the
  proposed Pydantic model, and where its value comes from (dataset column, computed, or config).
  List every gap from section 2 and every OPEN decision from section 5 with your recommendation. Stop.
- After approval: write the Pydantic models in `schemas/`, register the stream and event payloads in
  OpenAPI so they generate, run `export_openapi.py` and `npm run generate:types`, add contract tests.
  No endpoints yet.
- Done when: the schemas are approved, generated files are in sync, the drift check passes, and the
  list of frontend differences is ready for the human to hand to the frontend agent.

**S1. Snap and route search.**
- lat/lng to EPSG:2178 with the converter from D13, nearest node inside the largest strongly
  connected component (maximum snap distance: D1), search with `networkx` using the weight from D3.
  Return an edge-id path or a typed error.
- Tests on a synthetic graph: outside the area, origin equals destination, node outside the
  component, parallel edges, one-way streets, unreachable. A real-data smoke test that skips when
  `data/processed` is absent.
- Done when: routes between several real Kraków pairs are sane (the ETL route checks used a detour
  ratio of 1.0-1.6 against straight-line distance) and the search time is reported in the T8 style.

**S2. Route analysis.**
- From the edge path produce: the polyline (GeoJSON `LineString`, `[lng, lat]` order), total
  distance, the ordered unique intersections crossed with the along-route distance to the stop line
  of the FIRST controlled approach (the end of the first controlled edge on the route), and
  `T_normal` and `T_greenwave` exactly as in the architecture (once per unique INT, `V_ambulance(e)`,
  the multiplier).
- Cascade groups: consecutive intersections on the route whose along-route stop-line distance is at
  most 250 m (inclusive). `approach_neighbours` may pre-check or validate; it never provides the
  distance.
- Edge cases to test: split edges (`~n`, use `base_edge_id` for names); route starts or ends inside
  an intersection; a signal that controls one direction only (a route using the other direction
  pays no delay and does not list that INT); two controlled edges of one INT on a route (counted
  once); rings; boundary distances 249.9, 250.0 and 250.1 m.
- Done when: each formula has a unit test with a worked example, and one real route reproduces by
  hand.

**S3. Simulation core (pure and deterministic).**
- Per tick: position along the route, speed (`V_ambulance(e)` on the current edge), `v_avg` as
  defined in the architecture, TTI per intersection, the per-intersection state machine and the
  cascade flag exactly as the architecture defines, the time-saved KPI (D5), end of route.
- One tick is exactly one second of simulation time (D7). A stop or cancel returns every
  intersection to a valid state by a documented path.
- Done when: scripted scenarios on a synthetic graph give the exact expected tick sequences: a single
  intersection, a cascade pair at 249 m and 251 m, a stop in the middle of clearing, a start inside
  the ITS-trigger window (D4).

**S4. ItsGateway and its mock.**
- An `ItsGateway` interface in the domain and a `MockItsGateway` that records requests and returns
  acknowledgements. No network. Payloads follow the architecture but use OUR `INT-` ids. The request
  goes out when the architecture's TTI trigger is met. Each request and acknowledgement becomes an
  event for the stream (D10).
- Done when: one request per group per trigger, no duplicates on later ticks, the right group in
  cascade mode.

**S5. API and transport.**
- The start, stream and stop endpoints as the architecture defines. The simulation task lives in
  the FastAPI lifespan; one active simulation (policy per the architecture); bounded queues; client
  disconnects handled; nothing blocking in the loop. Typed errors: invalid coordinates 422, no route
  (status OPEN), conflict 409.
- CORS only for the explicit dashboard origin (D12), never a wildcard.
- Tick duration measured and logged; missed deadlines counted.
- Done when: API tests (TestClient or httpx plus a stream consumer test), OpenAPI and frontend
  types regenerated, and a measurement-only benchmark of the start request and of one tick.

**S6. Dashboard integration (frontend branch, frontend agent).**
- Replace the mock hook with the real stream using the generated types and runtime validation of
  incoming JSON. Show real intersection names and coordinates. Add visible attribution (OSM ODbL
  "© OpenStreetMap contributors" and the Kraków wording recorded in `MANIFEST.json`;
  DATA_PIPELINE decision 7). Do not touch `backend/` in this step.
- Done when: an end-to-end run on the demo machine; frontend lint, typecheck (Node 22, see
  `.nvmrc`), format check, tests and build pass.

**S7. Demo hardening.**
- Prepare scenarios: a cascade route (the pipeline report names INT-0360 and INT-0366, two
  consecutive junctions on Aleja 29 Listopada about 152 m apart; confirm against the current
  `intersection_ids.json`), a route without cascade, an unreachable-point error, a stop in the
  middle of a run.
- Run `scripts/benchmark.py` and the end-to-end run on the demo machine; the human approves budgets.
- README quick start with exact commands; known limitations visible to the user.

## 5. Decisions (OPEN until the human answers; recommendations are mine)

- **D1. Snap tolerance for origin and destination.** Start from 150 m (the ETL analysis value
  `ROUTE_SNAP_TOLERANCE_METERS`); farther gives 422 with the distance in the message.
- **D2. One route or two.** The contract has one `route_geometry` and two time estimates.
  Recommend one route, with the "normal" time computed on the same path, and the KPI worded so that
  it does not claim a different normal route.
- **D3. Search weight.** Recommend ambulance drive time `length_m / V_ambulance(e)`. `D_min` is a
  constant 3 s per intersection, so it barely changes the ranking, and exact times are computed
  after the search. Delay-aware search only if the demo shows odd routes.
- **D4. Start inside the ITS-trigger window.** Recommend: trigger on the first tick.
- **D5. `current_time_saved_sec`.** Recommend `T_normal(s) - elapsed`, where `T_normal(s)` is the
  normal-model time to reach the ambulance's current distance `s` (edge times plus `D_u` for the
  intersections already passed). It is consistent with the formulas.
- **D6. Traffic multiplier.** Confirm it scales only the normal estimate, not the route choice nor
  the ambulance.
- **D7. Tick scheduling.** Recommend exactly 1 s of simulation time per tick, no burst catch-up after
  a late tick, and a logged and counted missed deadline.
- **D8. Reconnect.** Recommend: the server sends the current snapshot on (re)connect, no replay.
- **D9. Start response additions.** Per intersection on the route: id, name, kind, lat, lng,
  `distance_along_route_m`, cascade group. The map needs them. This is a contract change.
- **D10. ITS events on the stream.** The console needs request and acknowledgement lines. Recommend
  a separate event type on the same stream. A contract change.
- **D11. Latency budgets.** Proposed, not approved: route search p95 <= 100 ms and max <= 250 ms;
  `load_dataset` <= 3 s; server start to ready <= 5 s; the 1 Hz loop budget is set once it exists.
  They apply to the demo machine, which must be measured (the human's PC or an M3 MacBook).
- **D12. Dashboard origin and API base URL** for CORS and for the frontend setting.
- **D13. Coordinate conversion and dependencies.** The only converter today is `etl/geo.py`, which
  uses `geopandas`; the engine must not import it (section 3). `pyproj` is installed but no code
  imports it directly, and `numpy` is imported directly by the ETL, the benchmark and the tests but
  is not declared in `pyproject.toml`. Recommend: declare `pyproj` and `numpy`, and write a small
  `greenwave/geo.py` with a `pyproj.Transformer` (EPSG:4326 and EPSG:2178, `always_xy=True`) used by
  the engine. A dependency change, so it needs approval. Do not change `etl/geo.py` in the same step.

## 6. Known limitations to carry (README and UI, not hidden)

- No turn restrictions in the graph: a route may use turns that are illegal in reality.
- Roads connect only where the OSM data shares an exact vertex. Some real links may be missing and
  some real roads disconnected; layers, bridges and tunnels are not connected.
- About 2,100 nodes are outside the main component and are unreachable.
- Speeds are posted limits or class defaults (`speed_source` says which). No live traffic; the
  multiplier is a user input.
- Signals come from OpenStreetMap tags, not from an official city signal layer (DATA_PIPELINE
  decision 5). Blinker, tram-priority and tram or rail crossings are excluded; one crossing is
  unsnapped.
- INT ids are valid for this snapshot and configuration only.
- Everything is simulated; nothing here is a verified physical signal state.

## 7. Branches and merge order

1. `feature/data-pipeline` (it includes the backend cleanup commits) goes to `main` first; the
   backend gate is green: ruff, mypy, pytest. The pre-push frontend check needs Node 22
   (`frontend/.nvmrc`); never push with `--no-verify`.
2. `feature/frontend-dashboard` is then rebased on `main`. Expect conflicts in `.agents/`,
   `contracts/openapi.json` and `frontend/src/types/api.generated.ts`. Regenerate the generated files;
   never merge them by hand.
3. Engine work happens on a new short-lived branch from `main` (for example
   `feature/simulation-engine`), one branch per task (AGENTS.md).
4. Housekeeping the team has to settle (not engine work):
   - **uv version.** `uv.lock` is at `revision = 5`, but uv 0.12.3 (the version CI pins) rewrites it
     to `revision = 3` when a dependency is added. Pick one uv version for everyone; until then,
     whoever adds a dependency uses the version that wrote the current lock and checks that the lock
     diff only adds entries.
   - **Git hooks** are not installed by default; each contributor runs `pre-commit install` (and the
     pre-push hook type) once.

## 8. Definition of done for the phase

- A live end-to-end run on the demo machine: choose two points, see the route, watch the 1 Hz stream,
  see the cascade and the mocked ITS requests, stop it.
- Contract in sync (CI drift check green); backend and frontend gates green.
- Measured numbers reported with hardware and method; budgets approved by the human.
- Limitations and attribution visible to the user; everything labelled simulated.
- The human has signed off every step.
