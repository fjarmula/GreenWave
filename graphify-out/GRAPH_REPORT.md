# Graph Report - GreenWave  (2026-10-16)

## Corpus Check
- 159 files · ~67,031 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 13 file(s) not represented in the graph (top: (none) 10, .toml 1, .ico 1)

## Summary
- 1525 nodes · 4301 edges · 91 communities (67 shown, 24 thin omitted)
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 340 edges (avg confidence: 0.93)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `074653d9`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- pytest
- helpers.py
- build_graph
- signals.py
- json
- test_weld.py
- graph_pipeline.py
- test_neighbours.py
- profile.py
- sha256_of_file
- test_intersections.py
- attach_signals
- intersections_pipeline.py
- build_intersections
- test_junctions.py
- dashboard.tsx
- intersections.py
- cluster_map.py
- shapely
- run_neighbours
- ingest_osm.py
- test_signals.py
- create_app
- pathlib
- simulation-provider.tsx
- mock-simulation-adapter.ts
- profile_osm.py
- components.json
- profile_roads.py
- MapContainer.tsx
- compilerOptions
- package.json
- telemetry.ts
- override_map.py
- greenwave/schemas/__init__.py
- test_profile.py
- dependencies
- devDependencies
- test_near_misses.py
- test_simulation_schemas.py
- scripts
- button.tsx
- ThemeToggle.tsx
- context7
- setup-agent-env.sh
- eslint.config.mjs
- layout.tsx
- postcss.config.mjs
- .prettierrc.json
- test_setup_agent_env.sh
- greenwave-backend
- Getting Started
- scan_osm
- analyse_connectivity
- numpy
- api/simulation.py
- ProcessedDataset
- ErrorResponse
- SimulationStreamEvent
- ER-GreenWave: Emergency Response GreenWave System
- Phase 2 · 00 — Contract Freeze, Ownership and Merge Protocol (shared, both people)
- File structure (all new unless marked)
- useSimulationStream.ts
- Agent Readiness Phase 1 Implementation Plan
- ER-GreenWave: agent rules (Claude Code + Codex; CLAUDE.md imports this)
- test_simulation_stub_openapi.py
- NNNN: Short decision title
- 0002: Agent workflow setup
- README Getting Started Implementation Plan
- bug_report.md
- PULL_REQUEST_TEMPLATE.md
- artifact_hashes
- test_real_processed_data_loads
- test_importing_the_app_module_loads_no_data
- CLAUDE.md
- adr/README.md
- frontend/AGENTS.md
- check-agent-readiness.sh
- SECURITY.md
- test_agent_cleanup.sh
- test_graphify_ci.sh
- test_phase3_docs.sh

## God Nodes (most connected - your core abstractions)
1. `build_graph()` - 72 edges
2. `load_dataset()` - 61 edges
3. `DrivableWay` - 49 edges
4. `Layout` - 45 edges
5. `run_intersections()` - 42 edges
6. `run()` - 33 edges
7. `scan_osm()` - 27 edges
8. `build_signals()` - 27 edges
9. `project_points()` - 26 edges
10. `attach_signals()` - 26 edges

## Surprising Connections (you probably didn't know these)
- `Task B2: Planner — snap, route, polyline` --references--> `unproject_points()`  [INFERRED]
  docs/superpowers/plans/2026-10-16-phase2-backend-simulation-engine.md → backend/src/greenwave/etl/geo.py
- `Contract shape` --references--> `tick()`  [INFERRED]
  docs/adr/0003-simulation-contract-v1.md → backend/tests/schemas/test_simulation_schemas.py
- `Task F2: Adapter interface and reducer for a real network` --references--> `tick()`  [INFERRED]
  docs/superpowers/plans/2026-10-16-phase2-frontend-backend-integration.md → backend/tests/schemas/test_simulation_schemas.py
- `Phase 3: Simulated ITS Dispatch (Internal `ItsGateway` Interface)` --references--> `tick()`  [INFERRED]
  GreenWave_ARCHITECTURE.md → backend/tests/schemas/test_simulation_schemas.py
- `Task B7: API wiring, SSE framing, CORS` --references--> `load_dataset()`  [INFERRED]
  docs/superpowers/plans/2026-10-16-phase2-backend-simulation-engine.md → backend/src/greenwave/dataset/loader.py

## Import Cycles
- None detected.

## Communities (91 total, 24 thin omitted)

### Community 0 - "pytest"
Cohesion: 0.16
Nodes (31): load_dataset(), edit_json(), edit_parquet(), record_hash(), test_a_file_modified_after_the_build_is_detected(), test_a_report_hash_for_one_file_missing_names_that_file(), test_changed_manifest_fails_all_three_places(), test_count_mismatch_against_the_report() (+23 more)

### Community 1 - "helpers.py"
Cohesion: 0.09
Nodes (31): ArtifactHashMismatchError, CountMismatchError, DatasetError, MalformedArtifactError, ManifestMismatchError, MissingArtifactError, ReferentialIntegrityError, check_artifact_hashes() (+23 more)

### Community 2 - "build_graph"
Cohesion: 0.08
Nodes (41): build_graph(), _dedupe_consecutive(), GraphBuild, _parse_lanes(), WayIssue, OnewayResolution, resolve_oneway(), resolve_speed() (+33 more)

### Community 3 - "signals.py"
Cohesion: 0.16
Nodes (13): SignalHandling, crossing_kind(), PointFeature, tag(), vertices_of(), is_routable_way(), build_signals(), _nearest_distance_meters() (+5 more)

### Community 4 - "json"
Cohesion: 0.11
Nodes (24): best_edge(), environment(), free_port(), hash_tree(), machine_state(), main(), now_iso(), proc_status() (+16 more)

### Community 5 - "test_weld.py"
Cohesion: 0.12
Nodes (27): _distance_buckets(), find_near_misses(), _Candidate, _count(), _insert_position(), _rounded(), SkippedWeld, weld_ways() (+19 more)

### Community 6 - "graph_pipeline.py"
Cohesion: 0.08
Nodes (21): GraphBuildReport, write_graph(), GraphSection, run_graph(), name_report(), compare_streets(), top(), graph_street_lengths() (+13 more)

### Community 7 - "test_neighbours.py"
Cohesion: 0.13
Nodes (31): approach_edges(), ApproachEdge, _edge_table(), _EdgeInfo, find_neighbours(), _is_u_turn(), neighbour_frame(), NeighbourPair (+23 more)

### Community 8 - "profile.py"
Cohesion: 0.09
Nodes (26): _check_ulice_matches_metric_crs(), _claims(), profile_krakow(), ClaimCheck, ClusteringProfile, CrossingsProfile, CsvProfile, DistanceSummary (+18 more)

### Community 9 - "sha256_of_file"
Cohesion: 0.11
Nodes (20): build_manifest(), main(), InputIntegrityError, load_manifest(), Manifest, ManifestEntry, ManifestIssue, sha256_of_file() (+12 more)

### Community 10 - "test_intersections.py"
Cohesion: 0.15
Nodes (40): SignalPoint, at(), _chain(), crossing_road(), _crossings(), four_corner_ring(), run(), signal() (+32 more)

### Community 11 - "attach_signals"
Cohesion: 0.17
Nodes (23): node_key(), attach_signals(), _piece_geometry(), _Request, _resolve_controlled_edges(), _split_edge(), _twin_edge_id(), at() (+15 more)

### Community 12 - "intersections_pipeline.py"
Cohesion: 0.12
Nodes (22): main(), AssignmentDistribution, GroupingReport, kind_delay_seconds(), NameReport, _file_sha256(), IntersectionsSection, _notes() (+14 more)

### Community 13 - "build_intersections"
Cohesion: 0.13
Nodes (19): approach_frame(), assign_approaches(), Assignment, best_incident_class(), build_intersections(), capped_case_details(), capped_case_sensitivity(), CappedCase (+11 more)

### Community 14 - "test_junctions.py"
Cohesion: 0.15
Nodes (25): override_rings(), undirected_adjacency(), draft_override_entries(), load_overrides(), OverrideFile, RoundaboutOverride, write_overrides(), at() (+17 more)

### Community 15 - "dashboard.tsx"
Cohesion: 0.12
Nodes (28): Task F6: UX for real-world states, Home(), Dashboard(), DashboardHeader(), DashboardHeaderProps, DashboardMode, ModeButton(), ModeButtonProps (+20 more)

### Community 16 - "intersections.py"
Cohesion: 0.12
Nodes (14): prepare_rings(), reach_within(), coordinate_name(), _dangling_internal_nodes(), find_junction_nodes(), format_intersection_id(), nearest_junctions(), nearest_of() (+6 more)

### Community 17 - "cluster_map.py"
Cohesion: 0.11
Nodes (14): _cluster_pairs(), _fmt(), JunctionSpec, locate_junction(), _matching_ways(), _missing_note(), _panel_svg(), render_cluster_map() (+6 more)

### Community 18 - "shapely"
Cohesion: 0.16
Nodes (8): project_points(), unproject_points(), RouteCheck, RouteCheckResult, run_route_checks(), _snap_candidates(), _to_wgs84(), Global Constraints

### Community 19 - "run_neighbours"
Cohesion: 0.13
Nodes (17): read_graph(), update_report_section(), _recorded_t4_hashes(), run_neighbours(), StaleArtifactError, _build_t4(), test_neighbours_step_reads_the_processed_artifacts_and_refuses_a_stale_manifest(), test_pipeline_output_is_deterministic() (+9 more)

### Community 20 - "ingest_osm.py"
Cohesion: 0.29
Nodes (7): iter_osm_records(), MalformedRecord, OsmFeature, _parse_feature(), test_reports_malformed_lines_instead_of_dropping_them(), test_yields_features_and_skips_header_footer_and_trailing_comma(), _write()

### Community 21 - "test_signals.py"
Cohesion: 0.14
Nodes (26): SignalSettings, at(), north_of(), test_prepare_scan_welds_the_ways_every_later_step_sees(), test_tertiary_plus_list_shows_what_the_weld_step_did_to_each_case(), way(), _analyse(), test_conventions_are_reported_side_by_side_without_choosing() (+18 more)

### Community 22 - "create_app"
Cohesion: 0.09
Nodes (15): main(), DatasetSettings, create_app(), health(), lifespan(), HealthResponse, test_dataset_and_directory_are_mutually_exclusive(), test_default_paths_come_from_settings() (+7 more)

### Community 23 - "pathlib"
Cohesion: 0.14
Nodes (3): IssueKind, NeighboursSection, at()

### Community 24 - "simulation-provider.tsx"
Cohesion: 0.25
Nodes (11): SimulationDispatchContext, SimulationProvider(), SimulationStateContext, initialSimulationState, SimulationAction, simulationReducer(), SimulationState, request (+3 more)

### Community 25 - "mock-simulation-adapter.ts"
Cohesion: 0.19
Nodes (14): createMockRoute(), createMockSimulationAdapter(), createMockTick(), MockSession, DEFAULT_TRAFFIC_DENSITY_MULTIPLIER, estimateMockNormalTravelTimeSeconds(), MOCK_GREENWAVE_TRAVEL_TIME_SECONDS, MOCK_NORMAL_TRAVEL_TIME_SECONDS (+6 more)

### Community 26 - "profile_osm.py"
Cohesion: 0.13
Nodes (9): _row(), DrivableWay, analyse_roundabouts(), _group_rings(), _histogram(), _Ring, RoundaboutRing, RoundaboutsSection (+1 more)

### Community 27 - "components.json"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 28 - "profile_roads.py"
Cohesion: 0.18
Nodes (8): project_lines(), RoadClassProfile, analyse_roads(), build_topology(), _class_profile(), RoadAnalysis, RoadTopology, tag_present()

### Community 29 - "MapContainer.tsx"
Cohesion: 0.17
Nodes (18): Task F7: Map uses real geometry, AmbulanceMarker(), AmbulanceMarkerProps, DestinationEndpoint, OriginEndpoint, createEndpointMarker(), EndpointMarkers(), EndpointMarkersProps (+10 more)

### Community 30 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 31 - "package.json"
Cohesion: 0.11
Nodes (17): engines, node, name, private, version, openapi-typescript, prettier, react-dom (+9 more)

### Community 32 - "telemetry.ts"
Cohesion: 0.19
Nodes (10): SIGNAL_COLORS, SignalMarkersProps, positionOnRoute(), route, AmbulanceTelemetry, KpiMetrics, Position, RouteGeometry (+2 more)

### Community 33 - "override_map.py"
Cohesion: 0.20
Nodes (5): _arrow(), _panel(), to_px(), _polyline(), render_override_map()

### Community 34 - "greenwave/schemas/__init__.py"
Cohesion: 0.19
Nodes (21): AmbulanceStatus, AmbulanceTelemetry, CancelReason, ErrorCode, IntersectionKind, IntersectionState, IntersectionTelemetry, ItsDispatchEvent (+13 more)

### Community 35 - "test_profile.py"
Cohesion: 0.42
Nodes (11): _compact(), _line(), _point(), _polygon(), test_road_length_is_in_meters_and_coverage_is_weighted_by_length(), test_scan_counts_types_and_reports_invalid_geometry(), test_scan_drivable_filter_uses_class_and_access(), test_scan_separates_signal_nodes_from_signalised_crossings() (+3 more)

### Community 36 - "dependencies"
Cohesion: 0.15
Nodes (13): dependencies, @base-ui/react, class-variance-authority, clsx, lucide-react, maplibre-gl, next, next-themes (+5 more)

### Community 37 - "devDependencies"
Cohesion: 0.15
Nodes (13): devDependencies, eslint, eslint-config-next, openapi-typescript, prettier, tailwindcss, @tailwindcss/postcss, @tailwindcss/turbopack (+5 more)

### Community 38 - "test_near_misses.py"
Cohesion: 0.55
Nodes (10): at(), run(), shifted(), test_a_way_is_not_a_near_miss_of_itself(), test_end_just_short_of_another_way_s_body_is_a_segment_near_miss(), test_ends_farther_apart_than_the_tolerance_are_not_reported(), test_tolerance_boundary_is_inclusive(), test_two_way_ends_a_metre_apart_without_a_shared_vertex_are_reported_once() (+2 more)

### Community 40 - "test_simulation_schemas.py"
Cohesion: 0.15
Nodes (22): architecture_examples(), example(), start_request(), test_a_fifth_state_is_rejected(), test_an_unknown_event_type_is_rejected(), test_architecture_examples_round_trip_without_losing_fields(), test_architecture_examples_validate_against_their_models(), test_cancel_reasons() (+14 more)

### Community 41 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, format, format:check, generate:types, lint, start (+2 more)

### Community 42 - "button.tsx"
Cohesion: 0.29
Nodes (7): Button(), buttonVariants, cn(), @base-ui/react, class-variance-authority, clsx, tailwind-merge

### Community 43 - "ThemeToggle.tsx"
Cohesion: 0.53
Nodes (5): getClientSnapshot(), getServerSnapshot(), subscribe(), themeOptions, ThemeToggle()

### Community 44 - "context7"
Cohesion: 0.33
Nodes (5): graphify-mcp, npx, context7, graphify, @upstash/context7-mcp

### Community 45 - "setup-agent-env.sh"
Cohesion: 0.57
Nodes (6): check_tools(), graphify_mcp_ready(), install_missing_tools(), install_tool(), setup-agent-env.sh script, usage()

### Community 46 - "eslint.config.mjs"
Cohesion: 0.50
Nodes (3): eslintConfig, eslint, eslint-config-next

### Community 47 - "layout.tsx"
Cohesion: 0.18
Nodes (9): nextConfig, geistMono, geistSans, metadata, RootLayout(), ThemeProvider(), ThemeProviderProps, next (+1 more)

### Community 57 - "Getting Started"
Cohesion: 0.08
Nodes (20): Commands (run from `backend/`), Data pipeline (offline ETL), Data Sources & Attribution, ER-GreenWave backend, Running the server needs built data, Contract changes, Contributing, Handoff protocol (+12 more)

### Community 58 - "scan_osm"
Cohesion: 0.17
Nodes (10): _geometry_profile(), Bbox, InvalidGeometrySample, _handle_linestring_with_highway(), _lon_lat_in_range(), OsmScan, _point_lon_lat(), _record_invalid() (+2 more)

### Community 59 - "analyse_connectivity"
Cohesion: 0.20
Nodes (10): analyse_connectivity(), _bucket(), ComponentSummary, ConnectivityReport, _summaries(), at(), test_empty_graph_is_an_error(), test_islands_and_largest_strong_component_are_reported() (+2 more)

### Community 60 - "numpy"
Cohesion: 0.19
Nodes (5): single_linkage_labels(), test_clustering_boundary_below_at_above_radius(), test_clustering_chain_is_one_cluster_even_when_ends_exceed_radius(), test_clustering_singleton_and_empty(), _xy()

### Community 61 - "api/simulation.py"
Cohesion: 0.17
Nodes (5): _not_implemented(), start_simulation(), stop_simulation(), stream_simulation(), StopResponse

### Community 62 - "ProcessedDataset"
Cohesion: 0.17
Nodes (6): ProcessedDataset, built_layout(), layout(), tiny_dataset(), test_tiny_dataset_fixture_loads(), Task B1: Settings and RoutingIndex (startup build)

### Community 63 - "ErrorResponse"
Cohesion: 0.13
Nodes (16): ErrorResponse, 3. Phase 0 tasks (on `main`, Piotr drives, Filip reviews; target: one sitting), Task 0.1: ADR and architecture update, Task 0.3: Stub endpoints with final signatures, Task 0.4: Regenerate, verify, commit, branch, File structure, Task F2: Adapter interface and reducer for a real network, Task F3: Wire validation (D23) (+8 more)

### Community 64 - "SimulationStreamEvent"
Cohesion: 0.15
Nodes (12): SimulationStreamEvent, 0003: Simulation contract v1, Alternatives considered, Consequences, Context, Contract shape, Decision, Decisions not on the approved list (made while writing the contract) (+4 more)

### Community 65 - "ER-GreenWave: Emergency Response GreenWave System"
Cohesion: 0.14
Nodes (13): 1. Glossary and Acronyms, 1. Normal travel time (without priority), 2. Architecture and Technology Stack, 2. ER-GreenWave travel time (with priority), 3. Mathematical Models and Core Logic, 5. Proof-of-Concept Scope and Safety Note, 6. Resolved Architecture Decisions (Formerly Open Questions), Architectural Decisions: Why? (+5 more)

### Community 66 - "Phase 2 · 00 — Contract Freeze, Ownership and Merge Protocol (shared, both people)"
Cohesion: 0.18
Nodes (10): 2. Decision register (all confirmed and ticked; final values recorded; ADR 0003 mirrors them), 4. Ownership map — the actual conflict-prevention mechanism, 5. Contract change protocol (if a branch discovers the contract is wrong), 6. Merge order and Phase 3 (together), Contract shape, Integration plumbing, Ownership, Phase 2 · 00 — Contract Freeze, Ownership and Merge Protocol (shared, both people) (+2 more)

### Community 67 - "File structure (all new unless marked)"
Cohesion: 0.18
Nodes (10): File structure (all new unless marked), Phase 2 · Backend — Simulation Engine, Routing and Streaming API (Piotr), Review Focus, Task B2: Planner — snap, route, polyline, Task B3: RouteModel and estimates, Task B4: Intersection state machine (pure), Task B5: Engine step (pure, deterministic), Task B6: ITS gateway and session manager (asyncio) (+2 more)

### Community 68 - "useSimulationStream.ts"
Cohesion: 0.20
Nodes (8): Global Constraints, Phase 2 · Frontend — Contract Migration and Backend Transport (Filip), Review Focus, What you hand to Piotr during the branch (messages only), useSimulationDispatch(), simulationAdapter, useSimulationStream(), Simulation contracts and state

### Community 69 - "Agent Readiness Phase 1 Implementation Plan"
Cohesion: 0.25
Nodes (7): Agent Readiness Phase 1 Implementation Plan, Global Constraints, Review Focus, Self-Review, Task 1: Bootstrap script, Task 2: MCP configuration and graph CI validation, Task 3: Graph artifact restoration

### Community 70 - "ER-GreenWave: agent rules (Claude Code + Codex; CLAUDE.md imports this)"
Cohesion: 0.29
Nodes (6): Checks, Contracts, ER-GreenWave: agent rules (Claude Code + Codex; CLAUDE.md imports this), Read when relevant, Rules, Skills

### Community 71 - "test_simulation_stub_openapi.py"
Cohesion: 0.48
Nodes (5): client(), test_error_responses_are_documented(), test_openapi_contains_the_three_paths_and_every_model(), test_stream_route_registers_the_event_union_under_event_stream(), test_stubs_return_501()

### Community 72 - "NNNN: Short decision title"
Cohesion: 0.29
Nodes (6): Alternatives considered, Consequences, Context, Decision, NNNN: Short decision title, Validation

### Community 73 - "0002: Agent workflow setup"
Cohesion: 0.29
Nodes (6): 0002: Agent workflow setup, Alternatives considered, Consequences, Context, Decision, Validation

### Community 74 - "README Getting Started Implementation Plan"
Cohesion: 0.40
Nodes (4): Global Constraints, README Getting Started Implementation Plan, Review Focus, Task 1: Root onboarding document

### Community 75 - "bug_report.md"
Cohesion: 0.50
Nodes (3): Actual behavior, Expected behavior, Reproduction

### Community 76 - "PULL_REQUEST_TEMPLATE.md"
Cohesion: 0.50
Nodes (3): Contract or safety impact, Summary, Verification

## Knowledge Gaps
- **16 isolated node(s):** `graphify-mcp`, `npx`, `@upstash/context7-mcp`, `greenwave-backend`, `react-dom` (+11 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 514 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **24 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Task F1: Migrate to the v1 contract (mock keeps working)` connect `greenwave/schemas/__init__.py` to `SimulationStreamEvent`, `telemetry.ts`, `dashboard.tsx`, `simulation-provider.tsx`, `MapContainer.tsx`, `ErrorResponse`?**
  _High betweenness centrality (0.105) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `build_graph()` (e.g. with `DrivableWay` and `UnrecognisedTagError`) actually correct?**
  _`build_graph()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `graphify-mcp`, `npx`, `@upstash/context7-mcp` to the rest of the system?**
  _16 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `helpers.py` be split into smaller, more focused modules?**
  _Cohesion score 0.08766803039158387 - nodes in this community are weakly interconnected._
- **Why does `1. Where the project actually is (verified on `main` @ `43faa75`, 2026-10-16)` connect `create_app` to `Phase 2 · 00 — Contract Freeze, Ownership and Merge Protocol (shared, both people)`, `useSimulationStream.ts`, `ProcessedDataset`?**
  _High betweenness centrality (0.088) - this node is a cross-community bridge._
- **Are the 36 inferred relationships involving `load_dataset()` (e.g. with `section_routing()` and `worker_load()`) actually correct?**
  _`load_dataset()` has 36 INFERRED edges - model-reasoned connections that need verification._
- **Should `build_graph` be split into smaller, more focused modules?**
  _Cohesion score 0.08287961282516637 - nodes in this community are weakly interconnected._