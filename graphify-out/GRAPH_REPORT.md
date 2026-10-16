# Graph Report - GreenWave  (2026-10-16)

## Corpus Check
- 129 files · ~53,163 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 11 file(s) not represented in the graph (top: (none) 9, .ico 1, .css 1)

## Summary
- 1311 nodes · 3912 edges · 60 communities (46 shown, 14 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 269 edges (avg confidence: 0.93)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `bb39d602`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- pytest
- helpers.py
- manifest.py
- build_graph
- graph_pipeline.py
- prepare.py
- neighbours_pipeline.py
- json
- test_intersections.py
- test_signals.py
- intersections.py
- profile_osm.py
- profile.py
- attach_signals
- cluster_map.py
- shapely
- intersections_pipeline.py
- signals.py
- simulation-provider.tsx
- MapContainer.tsx
- components.json
- dashboard.tsx
- numpy
- junctions.py
- test_junctions.py
- profile_signals.py
- mock-simulation-adapter.ts
- compilerOptions
- ER-GreenWave: Emergency Response GreenWave System
- package.json
- _panel
- OverrideFile
- telemetry.ts
- DrivableWay
- test_profile.py
- dependencies
- devDependencies
- button.tsx
- test_near_misses.py
- profile_roads.py
- DispatchForm.tsx
- scripts
- ThemeToggle.tsx
- ER-GreenWave: agent entry point
- normalise_street_name
- ER-GreenWave backend
- format_intersection_id
- eslint.config.mjs
- next
- ER-GreenWave frontend
- frontend/AGENTS.md
- postcss.config.mjs
- .prettierrc.json
- greenwave-backend

## God Nodes (most connected - your core abstractions)
1. `build_graph()` - 72 edges
2. `load_dataset()` - 60 edges
3. `DrivableWay` - 49 edges
4. `run_intersections()` - 42 edges
5. `Layout` - 39 edges
6. `run()` - 33 edges
7. `scan_osm()` - 27 edges
8. `build_signals()` - 27 edges
9. `attach_signals()` - 26 edges
10. `OsmScan` - 26 edges

## Surprising Connections (you probably didn't know these)
- `Simulation contracts and state` --references--> `useSimulationState()`  [INFERRED]
  frontend/src/types/README.md → frontend/src/components/simulation-provider.tsx
- `Simulation contracts and state` --references--> `SimulationProvider()`  [INFERRED]
  frontend/src/types/README.md → frontend/src/components/simulation-provider.tsx
- `Simulation contracts and state` --references--> `useSimulationDispatch()`  [INFERRED]
  frontend/src/types/README.md → frontend/src/components/simulation-provider.tsx
- `worker_load()` --calls--> `artifact_hashes()`  [INFERRED]
  backend/scripts/benchmark.py → backend/src/greenwave/artifacts.py
- `worker_load()` --calls--> `load_dataset()`  [INFERRED]
  backend/scripts/benchmark.py → backend/src/greenwave/dataset/loader.py

## Import Cycles
- None detected.

## Communities (60 total, 14 thin omitted)

### Community 0 - "pytest"
Cohesion: 0.05
Nodes (50): main(), load_dataset(), DatasetSettings, create_app(), health(), lifespan(), HealthResponse, built_layout() (+42 more)

### Community 1 - "helpers.py"
Cohesion: 0.06
Nodes (36): artifact_hashes(), ArtifactHashMismatchError, CountMismatchError, DatasetError, MalformedArtifactError, ManifestMismatchError, MissingArtifactError, ReferentialIntegrityError (+28 more)

### Community 2 - "manifest.py"
Cohesion: 0.07
Nodes (37): build_manifest(), main(), update_report_section(), InputIntegrityError, IssueKind, load_manifest(), Manifest, ManifestEntry (+29 more)

### Community 3 - "build_graph"
Cohesion: 0.08
Nodes (41): build_graph(), _dedupe_consecutive(), GraphBuild, _parse_lanes(), WayIssue, OnewayResolution, resolve_oneway(), resolve_speed() (+33 more)

### Community 4 - "graph_pipeline.py"
Cohesion: 0.07
Nodes (27): analyse_connectivity(), _bucket(), ComponentSummary, ConnectivityReport, _summaries(), GraphBuildReport, GraphSection, run_graph() (+19 more)

### Community 5 - "prepare.py"
Cohesion: 0.09
Nodes (31): _distance_buckets(), find_near_misses(), NearMissReport, prepare_scan(), PreparedScan, _Candidate, _count(), _insert_position() (+23 more)

### Community 6 - "neighbours_pipeline.py"
Cohesion: 0.10
Nodes (32): approach_edges(), ApproachEdge, _edge_table(), _EdgeInfo, find_neighbours(), _is_u_turn(), neighbour_frame(), NeighbourPair (+24 more)

### Community 7 - "json"
Cohesion: 0.11
Nodes (24): best_edge(), environment(), free_port(), hash_tree(), machine_state(), main(), now_iso(), proc_status() (+16 more)

### Community 8 - "test_intersections.py"
Cohesion: 0.15
Nodes (40): SignalPoint, at(), _chain(), crossing_road(), _crossings(), four_corner_ring(), run(), signal() (+32 more)

### Community 9 - "test_signals.py"
Cohesion: 0.15
Nodes (26): SignalsResult, at(), north_of(), test_prepare_scan_welds_the_ways_every_later_step_sees(), test_tertiary_plus_list_shows_what_the_weld_step_did_to_each_case(), way(), _analyse(), test_conventions_are_reported_side_by_side_without_choosing() (+18 more)

### Community 10 - "intersections.py"
Cohesion: 0.13
Nodes (22): approach_frame(), assign_approaches(), Assignment, best_incident_class(), build_intersections(), capped_case_details(), capped_case_sensitivity(), CappedCase (+14 more)

### Community 11 - "profile_osm.py"
Cohesion: 0.12
Nodes (15): iter_osm_records(), MalformedRecord, OsmFeature, _parse_feature(), _geometry_profile(), _handle_linestring_with_highway(), _lon_lat_in_range(), OsmScan (+7 more)

### Community 12 - "profile.py"
Cohesion: 0.12
Nodes (20): _check_ulice_matches_metric_crs(), _claims(), profile_krakow(), Bbox, ClaimCheck, ClusteringProfile, CsvProfile, GeometryProfile (+12 more)

### Community 13 - "attach_signals"
Cohesion: 0.17
Nodes (23): node_key(), attach_signals(), _piece_geometry(), _Request, _resolve_controlled_edges(), _split_edge(), _twin_edge_id(), at() (+15 more)

### Community 14 - "cluster_map.py"
Cohesion: 0.11
Nodes (15): _cluster_pairs(), _fmt(), JunctionSpec, locate_junction(), _matching_ways(), _missing_note(), _panel_svg(), render_cluster_map() (+7 more)

### Community 15 - "shapely"
Cohesion: 0.11
Nodes (10): project_lines(), project_points(), unproject_points(), _row(), RouteCheck, RouteCheckResult, run_route_checks(), locate() (+2 more)

### Community 16 - "intersections_pipeline.py"
Cohesion: 0.15
Nodes (19): AssignmentDistribution, distance_distribution(), kind_delay_seconds(), name_report(), NameReport, _file_sha256(), IntersectionsSection, _notes() (+11 more)

### Community 17 - "signals.py"
Cohesion: 0.12
Nodes (11): main(), SignalHandling, crossing_kind(), PointFeature, build_signals(), _nearest_distance_meters(), _optional(), RejectEntry (+3 more)

### Community 18 - "simulation-provider.tsx"
Cohesion: 0.13
Nodes (18): geistMono, geistSans, metadata, RootLayout(), SimulationDispatchContext, SimulationProvider(), SimulationStateContext, useSimulationDispatch() (+10 more)

### Community 19 - "MapContainer.tsx"
Cohesion: 0.15
Nodes (19): AmbulanceMarker(), AmbulanceMarkerProps, DestinationEndpoint, DispatchEndpoint, MapCoordinates, OriginEndpoint, createEndpointMarker(), EndpointMarkers() (+11 more)

### Community 20 - "components.json"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 21 - "dashboard.tsx"
Cohesion: 0.22
Nodes (16): Home(), Dashboard(), DashboardHeader(), DashboardHeaderProps, DashboardMode, ModeButton(), ModeButtonProps, RoutePreview() (+8 more)

### Community 22 - "numpy"
Cohesion: 0.16
Nodes (5): single_linkage_labels(), test_clustering_boundary_below_at_above_radius(), test_clustering_chain_is_one_cluster_even_when_ends_exceed_radius(), test_clustering_singleton_and_empty(), _xy()

### Community 23 - "junctions.py"
Cohesion: 0.17
Nodes (10): prepare_rings(), _dangling_internal_nodes(), find_junction_nodes(), nearest_junctions(), nearest_of(), number_rings(), override_rings(), Ring (+2 more)

### Community 24 - "test_junctions.py"
Cohesion: 0.26
Nodes (17): undirected_adjacency(), at(), crossing_graph(), key(), ring_ways(), _ring_with_chord(), test_an_internal_edge_is_neither_ring_nor_arm_and_must_join_ring_nodes(), test_an_unknown_internal_edge_id_skips_the_entry() (+9 more)

### Community 25 - "profile_signals.py"
Cohesion: 0.18
Nodes (11): CrossingsProfile, DistanceSummary, SignalsProfile, RoadAnalysis, analyse_signals(), cluster_profile(), _count_within(), _distance_summary() (+3 more)

### Community 26 - "mock-simulation-adapter.ts"
Cohesion: 0.20
Nodes (14): createMockRoute(), createMockSimulationAdapter(), createMockTick(), MockSession, estimateMockNormalTravelTimeSeconds(), MOCK_GREENWAVE_TRAVEL_TIME_SECONDS, MOCK_NORMAL_TRAVEL_TIME_SECONDS, MOCK_ROUTE_DISTANCE_METERS (+6 more)

### Community 27 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 28 - "ER-GreenWave: Emergency Response GreenWave System"
Cohesion: 0.11
Nodes (18): 1. Glossary and Acronyms, 1. Normal travel time (without priority), 2. Architecture and Technology Stack, 2. ER-GreenWave travel time (with priority), 3. Mathematical Models and Core Logic, 4. Data Flow and JSON Protocols, 5. Proof-of-Concept Scope and Safety Note, 6. Resolved Architecture Decisions (Formerly Open Questions) (+10 more)

### Community 29 - "package.json"
Cohesion: 0.11
Nodes (17): engines, node, name, private, version, openapi-typescript, prettier, react-dom (+9 more)

### Community 30 - "_panel"
Cohesion: 0.21
Nodes (5): _arrow(), _panel(), to_px(), _polyline(), render_override_map()

### Community 31 - "OverrideFile"
Cohesion: 0.25
Nodes (7): draft_override_entries(), load_overrides(), OverrideFile, RoundaboutOverride, write_overrides(), test_override_file_roundtrip_and_missing_file(), test_override_overlapping_a_tagged_ring_is_skipped()

### Community 32 - "telemetry.ts"
Cohesion: 0.24
Nodes (10): SIGNAL_COLORS, SignalMarkersProps, positionOnRoute(), route, AmbulanceTelemetry, IntersectionTelemetry, KpiMetrics, Position (+2 more)

### Community 33 - "DrivableWay"
Cohesion: 0.27
Nodes (7): DrivableWay, analyse_roundabouts(), _group_rings(), _histogram(), _Ring, RoundaboutRing, RoundaboutsSection

### Community 34 - "test_profile.py"
Cohesion: 0.42
Nodes (11): _compact(), _line(), _point(), _polygon(), test_road_length_is_in_meters_and_coverage_is_weighted_by_length(), test_scan_counts_types_and_reports_invalid_geometry(), test_scan_drivable_filter_uses_class_and_access(), test_scan_separates_signal_nodes_from_signalised_crossings() (+3 more)

### Community 35 - "dependencies"
Cohesion: 0.15
Nodes (13): dependencies, @base-ui/react, class-variance-authority, clsx, lucide-react, maplibre-gl, next, next-themes (+5 more)

### Community 36 - "devDependencies"
Cohesion: 0.15
Nodes (13): devDependencies, eslint, eslint-config-next, openapi-typescript, prettier, tailwindcss, @tailwindcss/postcss, @tailwindcss/turbopack (+5 more)

### Community 37 - "button.tsx"
Cohesion: 0.21
Nodes (8): Button(), buttonVariants, cn(), @base-ui/react, class-variance-authority, clsx, tailwind-merge, vitest

### Community 38 - "test_near_misses.py"
Cohesion: 0.55
Nodes (10): at(), run(), shifted(), test_a_way_is_not_a_near_miss_of_itself(), test_end_just_short_of_another_way_s_body_is_a_segment_near_miss(), test_ends_farther_apart_than_the_tolerance_are_not_reported(), test_tolerance_boundary_is_inclusive(), test_two_way_ends_a_metre_apart_without_a_shared_vertex_are_reported_once() (+2 more)

### Community 39 - "profile_roads.py"
Cohesion: 0.25
Nodes (5): analyse_roads(), build_topology(), _class_profile(), RoadTopology, tag_present()

### Community 40 - "DispatchForm.tsx"
Cohesion: 0.22
Nodes (10): DispatchForm(), DispatchFormProps, Estimate(), NodeSelect(), NodeSelectProps, DESTINATION_ENDPOINTS, DestinationEndpointId, ORIGIN_ENDPOINTS (+2 more)

### Community 41 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, format, format:check, generate:types, lint, start (+2 more)

### Community 42 - "ThemeToggle.tsx"
Cohesion: 0.31
Nodes (7): getClientSnapshot(), getServerSnapshot(), subscribe(), themeOptions, ThemeToggle(), ThemeProviderProps, next-themes

### Community 43 - "ER-GreenWave: agent entry point"
Cohesion: 0.29
Nodes (6): Available Skills, Commands, ER-GreenWave: agent entry point, Layout, Read first, Working with two contributors and two agents

### Community 45 - "ER-GreenWave backend"
Cohesion: 0.33
Nodes (5): Commands (run from `backend/`), Data pipeline (offline ETL), Data Sources & Attribution, ER-GreenWave backend, Running the server needs built data

### Community 47 - "eslint.config.mjs"
Cohesion: 0.50
Nodes (3): eslintConfig, eslint, eslint-config-next

## Knowledge Gaps
- **13 isolated node(s):** `greenwave-backend`, `react-dom`, `shadcn`, `tw-animate-css`, `@tailwindcss/postcss` (+8 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 417 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `build_graph()` connect `build_graph` to `DrivableWay`, `helpers.py`, `graph_pipeline.py`, `prepare.py`, `test_near_misses.py`, `neighbours_pipeline.py`, `test_intersections.py`, `test_signals.py`, `attach_signals`, `cluster_map.py`, `shapely`, `intersections_pipeline.py`, `signals.py`, `numpy`, `test_junctions.py`, `OverrideFile`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `build_graph()` (e.g. with `DrivableWay` and `UnrecognisedTagError`) actually correct?**
  _`build_graph()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `greenwave-backend`, `react-dom`, `shadcn` to the rest of the system?**
  _13 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `pytest` be split into smaller, more focused modules?**
  _Cohesion score 0.05222286934575811 - nodes in this community are weakly interconnected._
- **Why does `load_dataset()` connect `pytest` to `helpers.py`, `manifest.py`, `json`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Are the 35 inferred relationships involving `load_dataset()` (e.g. with `section_routing()` and `worker_load()`) actually correct?**
  _`load_dataset()` has 35 INFERRED edges - model-reasoned connections that need verification._
- **Should `helpers.py` be split into smaller, more focused modules?**
  _Cohesion score 0.06160506160506161 - nodes in this community are weakly interconnected._