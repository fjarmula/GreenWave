# Graph Report - GreenWave  (2026-10-16)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1285 nodes · 3891 edges · 57 communities (47 shown, 10 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 266 edges (avg confidence: 0.93)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3fc01430`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- pytest
- helpers.py
- build_graph
- numpy
- benchmark.py
- weld.py
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
- graph.py
- run_neighbours
- profile_osm.py
- test_signals.py
- json
- pathlib
- simulation-provider.tsx
- mock-simulation-adapter.ts
- DrivableWay
- components.json
- profile_roads.py
- MapContainer.tsx
- compilerOptions
- package.json
- telemetry.ts
- override_map.py
- resolve_oneway
- scan_osm
- dependencies
- devDependencies
- test_near_misses.py
- polars
- intersection_frame
- scripts
- button.tsx
- ThemeToggle.tsx
- context7
- setup-agent-env.sh
- eslint.config.mjs
- next
- postcss.config.mjs
- .prettierrc.json
- test_setup_agent_env.sh
- greenwave-backend

## God Nodes (most connected - your core abstractions)
1. `build_graph()` - 72 edges
2. `load_dataset()` - 60 edges
3. `DrivableWay` - 49 edges
4. `run_intersections()` - 42 edges
5. `Layout` - 39 edges
6. `run()` - 33 edges
7. `build_signals()` - 27 edges
8. `scan_osm()` - 27 edges
9. `OsmScan` - 26 edges
10. `attach_signals()` - 26 edges

## Surprising Connections (you probably didn't know these)
- `load_dataset()` --uses--> `IdsDocument`  [INFERRED]
  backend/src/greenwave/dataset/loader.py → backend/src/greenwave/dataset/models.py
- `load_dataset()` --uses--> `IntersectionsSection`  [INFERRED]
  backend/src/greenwave/dataset/loader.py → backend/src/greenwave/dataset/models.py
- `load_dataset()` --uses--> `NeighboursSection`  [INFERRED]
  backend/src/greenwave/dataset/loader.py → backend/src/greenwave/dataset/models.py
- `Provenance` --uses--> `ManifestEntry`  [INFERRED]
  backend/src/greenwave/dataset/models.py → backend/src/greenwave/etl/manifest.py
- `_crossings()` --uses--> `SignalPoint`  [INFERRED]
  backend/tests/etl/test_intersections.py → backend/src/greenwave/etl/network.py

## Import Cycles
- None detected.

## Communities (57 total, 10 thin omitted)

### Community 0 - "pytest"
Cohesion: 0.06
Nodes (48): load_dataset(), DatasetSettings, create_app(), health(), lifespan(), HealthResponse, built_layout(), layout() (+40 more)

### Community 1 - "helpers.py"
Cohesion: 0.07
Nodes (33): ArtifactHashMismatchError, CountMismatchError, DatasetError, MalformedArtifactError, ManifestMismatchError, MissingArtifactError, ReferentialIntegrityError, check_artifact_hashes() (+25 more)

### Community 2 - "build_graph"
Cohesion: 0.08
Nodes (41): analyse_connectivity(), _bucket(), ComponentSummary, ConnectivityReport, _summaries(), build_graph(), _dedupe_consecutive(), GraphBuild (+33 more)

### Community 3 - "numpy"
Cohesion: 0.08
Nodes (20): single_linkage_labels(), SignalHandling, ClusteringProfile, crossing_kind(), PointFeature, cluster_profile(), _count_within(), _distance_summary() (+12 more)

### Community 4 - "benchmark.py"
Cohesion: 0.11
Nodes (24): best_edge(), environment(), free_port(), hash_tree(), machine_state(), main(), now_iso(), proc_status() (+16 more)

### Community 5 - "weld.py"
Cohesion: 0.11
Nodes (28): _distance_buckets(), find_near_misses(), _Candidate, _count(), _insert_position(), level_signature(), _rounded(), SkippedWeld (+20 more)

### Community 6 - "graph_pipeline.py"
Cohesion: 0.08
Nodes (20): GraphBuildReport, GraphSection, run_graph(), RouteCheck, compare_streets(), top(), graph_street_lengths(), StreetComparison (+12 more)

### Community 7 - "test_neighbours.py"
Cohesion: 0.13
Nodes (30): approach_edges(), ApproachEdge, _edge_table(), _EdgeInfo, find_neighbours(), _is_u_turn(), NeighbourPair, neighbours_report() (+22 more)

### Community 8 - "profile.py"
Cohesion: 0.11
Nodes (23): _check_ulice_matches_metric_crs(), _claims(), _geometry_profile(), profile_krakow(), Bbox, ClaimCheck, CrossingsProfile, CsvProfile (+15 more)

### Community 9 - "sha256_of_file"
Cohesion: 0.11
Nodes (20): build_manifest(), main(), InputIntegrityError, load_manifest(), Manifest, ManifestEntry, ManifestIssue, sha256_of_file() (+12 more)

### Community 10 - "test_intersections.py"
Cohesion: 0.21
Nodes (32): GroupingSettings, at(), crossing_road(), _crossings(), four_corner_ring(), run(), signal(), test_a_named_ring_leads_the_intersection_name() (+24 more)

### Community 11 - "attach_signals"
Cohesion: 0.17
Nodes (24): node_key(), attach_signals(), _piece_geometry(), _Request, _resolve_controlled_edges(), SignalPoint, _split_edge(), _twin_edge_id() (+16 more)

### Community 12 - "intersections_pipeline.py"
Cohesion: 0.14
Nodes (20): main(), name_report(), NameReport, _file_sha256(), IntersectionsSection, _notes(), _ring_report(), RingReport (+12 more)

### Community 13 - "build_intersections"
Cohesion: 0.11
Nodes (22): assign_approaches(), Assignment, AssignmentDistribution, best_incident_class(), build_intersections(), capped_case_details(), capped_case_sensitivity(), CappedCase (+14 more)

### Community 14 - "test_junctions.py"
Cohesion: 0.15
Nodes (24): undirected_adjacency(), draft_override_entries(), load_overrides(), OverrideFile, RoundaboutOverride, write_overrides(), at(), crossing_graph() (+16 more)

### Community 15 - "dashboard.tsx"
Cohesion: 0.13
Nodes (26): Home(), Dashboard(), DashboardHeader(), DashboardHeaderProps, DashboardMode, ModeButton(), ModeButtonProps, RoutePreview() (+18 more)

### Community 16 - "intersections.py"
Cohesion: 0.12
Nodes (15): prepare_rings(), reach_within(), coordinate_name(), _dangling_internal_nodes(), find_junction_nodes(), format_intersection_id(), nearest_junctions(), nearest_of() (+7 more)

### Community 17 - "cluster_map.py"
Cohesion: 0.12
Nodes (12): _cluster_pairs(), _fmt(), JunctionSpec, locate_junction(), _missing_note(), _panel_svg(), render_cluster_map(), test_render_writes_self_contained_html_and_reports_missing() (+4 more)

### Community 18 - "graph.py"
Cohesion: 0.14
Nodes (8): project_points(), unproject_points(), _row(), RouteCheckResult, run_route_checks(), locate(), _snap_candidates(), _to_wgs84()

### Community 19 - "run_neighbours"
Cohesion: 0.15
Nodes (15): update_report_section(), _recorded_t4_hashes(), run_neighbours(), StaleArtifactError, _build_t4(), test_neighbours_step_reads_the_processed_artifacts_and_refuses_a_stale_manifest(), test_pipeline_output_is_deterministic(), test_pipeline_writes_all_artifacts_and_ties_ids_to_the_manifest() (+7 more)

### Community 20 - "profile_osm.py"
Cohesion: 0.14
Nodes (11): iter_osm_records(), MalformedRecord, OsmFeature, _parse_feature(), _lon_lat_in_range(), _point_lon_lat(), _record_invalid(), _validate_non_point() (+3 more)

### Community 21 - "test_signals.py"
Cohesion: 0.21
Nodes (19): SignalSettings, SignalsResult, _analyse(), test_conventions_are_reported_side_by_side_without_choosing(), test_named_rondo_without_ring_tag_is_listed(), test_ring_ways_sharing_vertices_form_one_ring_with_its_arms(), test_signal_beyond_association_distance_is_not_at_the_ring(), _build() (+11 more)

### Community 22 - "json"
Cohesion: 0.18
Nodes (11): main(), at(), north_of(), test_prepare_scan_welds_the_ways_every_later_step_sees(), test_tertiary_plus_list_shows_what_the_weld_step_did_to_each_case(), way(), _feature(), line() (+3 more)

### Community 23 - "pathlib"
Cohesion: 0.13
Nodes (3): artifact_hashes(), IssueKind, NeighboursSection

### Community 24 - "simulation-provider.tsx"
Cohesion: 0.14
Nodes (17): geistMono, geistSans, metadata, RootLayout(), SimulationDispatchContext, SimulationProvider(), SimulationStateContext, ThemeProvider() (+9 more)

### Community 25 - "mock-simulation-adapter.ts"
Cohesion: 0.16
Nodes (18): useSimulationDispatch(), createMockRoute(), createMockSimulationAdapter(), createMockTick(), MockSession, DEFAULT_TRAFFIC_DENSITY_MULTIPLIER, estimateMockNormalTravelTimeSeconds(), MOCK_GREENWAVE_TRAVEL_TIME_SECONDS (+10 more)

### Community 26 - "DrivableWay"
Cohesion: 0.17
Nodes (11): _matching_ways(), DrivableWay, _handle_linestring_with_highway(), tag(), is_routable_way(), analyse_roundabouts(), _group_rings(), _histogram() (+3 more)

### Community 27 - "components.json"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 28 - "profile_roads.py"
Cohesion: 0.15
Nodes (10): project_lines(), RoadClassProfile, TagCoverage, analyse_roads(), build_topology(), _class_profile(), RoadAnalysis, RoadTopology (+2 more)

### Community 29 - "MapContainer.tsx"
Cohesion: 0.18
Nodes (16): AmbulanceMarker(), AmbulanceMarkerProps, DestinationEndpoint, OriginEndpoint, createEndpointMarker(), EndpointMarkers(), EndpointMarkersProps, KRAKOW_CENTER (+8 more)

### Community 30 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 31 - "package.json"
Cohesion: 0.11
Nodes (17): engines, node, name, private, version, openapi-typescript, prettier, react-dom (+9 more)

### Community 32 - "telemetry.ts"
Cohesion: 0.18
Nodes (12): SIGNAL_COLORS, SignalMarkers(), SignalMarkersProps, positionOnRoute(), route, AmbulanceTelemetry, IntersectionTelemetry, KpiMetrics (+4 more)

### Community 33 - "override_map.py"
Cohesion: 0.18
Nodes (5): _arrow(), _panel(), to_px(), _polyline(), render_override_map()

### Community 34 - "resolve_oneway"
Cohesion: 0.18
Nodes (10): OnewayResolution, resolve_oneway(), resolve_speed(), SpeedResolution, UnrecognisedTagError, test_other_junction_values_do_not_imply_oneway(), test_resolve_oneway(), test_resolve_oneway_rejects_unknown_value_instead_of_guessing() (+2 more)

### Community 35 - "scan_osm"
Cohesion: 0.33
Nodes (12): scan_osm(), _compact(), _line(), _point(), _polygon(), test_road_length_is_in_meters_and_coverage_is_weighted_by_length(), test_scan_counts_types_and_reports_invalid_geometry(), test_scan_drivable_filter_uses_class_and_access() (+4 more)

### Community 36 - "dependencies"
Cohesion: 0.15
Nodes (13): dependencies, @base-ui/react, class-variance-authority, clsx, lucide-react, maplibre-gl, next, next-themes (+5 more)

### Community 37 - "devDependencies"
Cohesion: 0.15
Nodes (13): devDependencies, eslint, eslint-config-next, openapi-typescript, prettier, tailwindcss, @tailwindcss/postcss, @tailwindcss/turbopack (+5 more)

### Community 38 - "test_near_misses.py"
Cohesion: 0.55
Nodes (10): at(), run(), shifted(), test_a_way_is_not_a_near_miss_of_itself(), test_end_just_short_of_another_way_s_body_is_a_segment_near_miss(), test_ends_farther_apart_than_the_tolerance_are_not_reported(), test_tolerance_boundary_is_inclusive(), test_two_way_ends_a_metre_apart_without_a_shared_vertex_are_reported_once() (+2 more)

### Community 39 - "polars"
Cohesion: 0.29
Nodes (3): read_graph(), write_graph(), neighbour_frame()

### Community 40 - "intersection_frame"
Cohesion: 0.24
Nodes (7): approach_frame(), _delay_of(), intersection_frame(), intersection_index(), IntersectionRecord, kind_delay_seconds(), test_delay_by_kind_comes_from_config_and_an_unknown_kind_raises()

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
Nodes (5): graphify, npx, context7, graphify, @upstash/context7-mcp

### Community 45 - "setup-agent-env.sh"
Cohesion: 0.60
Nodes (5): check_tools(), install_missing_tools(), install_tool(), setup-agent-env.sh script, usage()

### Community 46 - "eslint.config.mjs"
Cohesion: 0.50
Nodes (3): eslintConfig, eslint, eslint-config-next

## Knowledge Gaps
- **16 isolated node(s):** `openapi-typescript`, `prettier`, `react-dom`, `shadcn`, `tailwindcss` (+11 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 392 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `build_graph()` connect `build_graph` to `resolve_oneway`, `numpy`, `weld.py`, `graph_pipeline.py`, `test_near_misses.py`, `test_neighbours.py`, `test_intersections.py`, `attach_signals`, `intersections_pipeline.py`, `test_junctions.py`, `graph.py`, `json`, `DrivableWay`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `build_graph()` (e.g. with `DrivableWay` and `UnrecognisedTagError`) actually correct?**
  _`build_graph()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `openapi-typescript`, `prettier`, `react-dom` to the rest of the system?**
  _16 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `pytest` be split into smaller, more focused modules?**
  _Cohesion score 0.061748195669607056 - nodes in this community are weakly interconnected._
- **Why does `load_dataset()` connect `pytest` to `helpers.py`, `build_graph`, `benchmark.py`, `sha256_of_file`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Are the 35 inferred relationships involving `load_dataset()` (e.g. with `section_routing()` and `worker_load()`) actually correct?**
  _`load_dataset()` has 35 INFERRED edges - model-reasoned connections that need verification._
- **Should `helpers.py` be split into smaller, more focused modules?**
  _Cohesion score 0.07459207459207459 - nodes in this community are weakly interconnected._