# Data pipeline: plan and steps for coding agents

Scope: the offline ETL that turns raw datasets into the processed artifacts the simulation loads
at startup (`backend/data/processed/`). This file adds to `.agents/INSTRUCTIONS.md`; it does not
replace it. Where they disagree, stop and tell the human.

Do not invent answers to the open decisions in section 6 (the list marks which are open). Implement
only the step you are asked to, do not start the next step without approval (INSTRUCTIONS.md 4.3),
and do not commit or push.

## 1. Datasets received (assessed 2026-10-13)

| File | What it really is | Geometry / CRS | Verdict |
|---|---|---|---|
| `planet_19_792_50_012_71450a13_osm.geojson` (310 MB, BBBike) | Full OpenStreetMap extract of Kraków, **not** only traffic lights. 1,022,742 features: 458,955 lines, 316,164 points, 247,623 multipolygons. No OSM ids. | WGS84 (EPSG:4326), 7 decimals | **Primary source** for signals and road network |
| `Ulice.geojson` (3.2 MB, Kraków open data) | 3,036 street-name features (2,799 LineString, 237 MultiLineString), about 1,596 km. Fields: `objectid`, `nazwa_ulicy`, `kod_teryt`, `nazwa_dzielnicy`, `numer_dzielnicy`, `data_importu`. No road class, speed, direction or connectivity. | EPSG:2178 (metres) | **Not routable.** Use for street/district names and the open-data requirement |
| `Buspasy_wyświetlenie_*.csv` (Kraków open data) | About 300 bus lane / priority-corridor records: `Kategoria`, `Znak` (sign), free-text `Opis`, `Zasady` (time rules), `Organizacja` (permanent/temporary), `Długość [m]`. **No geometry.** Some `Opis` text has typos and "STARE" markers. | none | Secondary: needs text-to-network matching. Optional feature |
| `Linie_KMK_*.csv` (Kraków open data) | 54 rows, tram lines only: terminals and `Shape__Length`. **No geometry.** | none | Low value for the PoC. Park it |
| `__Aktualnosc__.txt` | Kraków export timestamp: 2026-10-13 00:47:34 | n/a | Record in the manifest |

Key measurements from the OSM extract:

- `highway=traffic_signals` points: **997**, all inside the Kraków bounding box.
- Tag `traffic_signals` on those: empty 779, `signal` 169, `traffic_lights` 34, `blinker` 10,
  `tram_priority` 3, `controller` 2. `traffic_signals:direction` is set on only 281 nodes.
  No `name`/`ref`. No `check_date`.
- Of 976 signals on a drivable-road vertex, only **168 sit at a junction** (vertex shared by 2+
  ways). **808 are mid-link**: OSM maps signals per approach near the stop line, not at the
  junction centre.
- Clustering signal nodes: 891 groups at 15 m, **682 at 30 m**, 377 at 50 m. So the 997 nodes are
  not 997 intersections, and the grouping radius is a real modelling decision.
- Points tagged `crossing=traffic_signals` that are not themselves `highway=traffic_signals`:
  **1,507** nodes (verified in T1). By kind: **1,318** `highway=crossing` (signalised pedestrian
  crossings) and **189** railway/tram crossings (180 `railway=tram_crossing`, 4 `railway=crossing`,
  2 `railway=level_crossing`, 2 `railway=tram_level_crossing`, 1 with no highway/railway tag).
  Another 14 nodes are both `highway=traffic_signals` and `crossing=traffic_signals`; they are
  counted once, as signals.
- Proximity of those 1,507 crossings to signal nodes: within 15 m **999**, 30 m **1,418**, 50 m
  **1,450** of any signal node; within 15 m **182**, 30 m **413**, 50 m **456** of a signal node
  on a junction vertex. So at 30 m, **89 of the 1,507 nodes (any kind) are standalone**. Restricted
  to the 1,318 road pedestrian crossings it is **59** (any signal node) or **60** (counted signal
  nodes only; a crossing next to a blinker still counts). The earlier figures (1,435 near a junction
  signal, 72 standalone) were wrong and are replaced.
- 50,108 drivable ways, 211,084 distinct vertices (provisional definition in `etl/config.py`;
  the earlier 50,107 / 211,082 differ by one way and two vertices). Road tags (`maxspeed`, `oneway`, `lanes`) exist but
  coverage by road class was measured in T1 (`etl_report.json`, `profile.roads`).

## 2. Decision: signals source (BBBike snapshot vs `osmnx` query)

Both are OpenStreetMap. The choice is between a pinned file and a live query, not between two data sources.

**Decision: use the BBBike snapshot as the single pinned source of truth. Do not call
`ox.graph_from_place` at build time.**

Reasons:

1. Reproducibility. A live Overpass query returns different data each day, so tests and demo
   results drift. The demo must also work without internet.
2. The snippet `nodes[nodes["highway"] == "traffic_signals"]` is lossy even if the data were
   identical:
   - OSMnx simplifies the graph by default. Degree-2 nodes are normally removed, and 808 of 976
     signals are mid-link. Verify this on the OSMnx version in use (a 5-line test); if confirmed,
     the snippet would silently lose most signals unless `simplify=False` (or an option that
     keeps tagged nodes) is used.
   - After merging, `highway` can be a list, so `==` misses rows.
   - It ignores the 1,507 signalised crossings (1,318 tagged `highway=crossing`, 189 on tram/rail).
3. We need to own the signal-to-intersection logic anyway (section 3), so a library
   convenience does not save the hard part.

What OSMnx is still good for: building the graph once, offline, from a local file. See T3.

## 3. Modelling rules (so every agent does the same thing)

- **Raw signal node is not an intersection.** The intersection is a graph junction node with counted
  signals, grouped by the T4 rules (decisions 2, 8, 9, 11). Plain distance clustering chains (T1:
  135 m span at 50 m), so it is only a provisional aid (`SIGNAL_CLUSTER_RADIUS_METERS`, T2 output).
  Do not hardcode 250 m (that is the cascade threshold, a different concept).
- Keep per-approach information: the original node coordinates, the `traffic_signals:direction`
  value and the OSM tag variant of every signal (`signals.parquet`, `signal_approaches.parquet`).
- `blinker` and `tram_priority` signals are non-blocking and are excluded from `D_v`; `controller`
  counts and is flagged for review (decision 3). Nothing is dropped silently: excluded and flagged
  nodes are listed with a reason in the `signals` report section.
- Signalised pedestrian crossings (`highway=crossing`) are a separate type. The 60 with no counted
  signal node within 30 m are mid-block stops that count in `D_v`; the other 1,258 sit next to a
  signal and duplicate it. Tram/rail crossings (189) are not pedestrian crossings and are excluded
  (decision 3).
- Do all distance work in EPSG:2178 (metres). Convert WGS84 once at ingestion
  (INSTRUCTIONS.md 6.3).
- Every record that is dropped, merged or repaired must be counted and reported. No silent fixes.
- All outputs are simulation inputs. Do not label any derived value as a verified physical signal state.

## 4. Layout

```
backend/
  data/raw/                       # gitignored except MANIFEST.json and .gitkeep
    osm/planet_19.792_50.012_71450a13.osm.geojson
    krakow/Ulice.geojson, Buspasy_*.csv, Linie_KMK_*.csv, __Aktualnosc__.txt
    MANIFEST.json                 # source, URL, retrieval date, sha256, size, licence (committed)
  data/overrides/roundabouts.json # hand-made, committed: roundabout rings the OSM tags miss
  data/processed/                 # gitignored, rebuilt by scripts/run_etl.py
    etl_report.json               # one section per step: profile, signals, graph, roundabouts,
                                  #   intersections, neighbours (counts, rejects, hashes; T7b: the
                                  #   sha256 of each artifact a step wrote, and of what T5 read)
    signals.parquet               # T2: one row per signal/crossing node, handling, provisional cluster
    road_nodes.parquet            # T3 base graph (before signals), parquet not a pickle
    road_edges.parquet            #   directed edges, EPSG:2178 geometry as WKB
    network_nodes.parquet         # T4: the graph the server loads (signals attached, edges split)
    network_edges.parquet
    intersections.parquet         # T4: INT-0001..., kind, delay_seconds (D_v), name, ring, member nodes
    signal_approaches.parquet     # T4: one row per counted signal node: snap, controlled edges, delay
    intersection_ids.json         # T4: id -> node, valid for the manifest hash stored inside
    approach_neighbours.parquet   # T5: candidate neighbour pairs (not an along-route distance)
    welds.csv, near_misses.csv, near_misses_tertiary_plus.csv   # T4: weld log and near-miss reports
    street_length_comparison.csv, route_sanity_checks.geojson   # T3 checks
    roundabout_override_check.html, signal_cluster_map.html     # check pages for the human
  src/greenwave/etl/              # no FastAPI imports here
    config.py                     # every tunable value, with units
    manifest.py                   # raw-input manifest and integrity check
    ingest_osm.py prepare.py weld.py near_misses.py   # scan, weld near-miss way ends
    profile*.py                   # T1 (profile_osm/roads/signals/krakow + profile_models, profile)
    signals.py clustering.py      # T2
    graph.py graph_io.py graph_pipeline.py connectivity.py street_comparison.py street_names.py
    route_checks.py road_rules.py geo.py             # T3 and shared rules
    network.py junctions.py intersections.py intersections_pipeline.py overrides.py   # T4
    override_map.py cluster_map.py roundabouts.py    # check pages and an analysis report
    neighbours.py neighbours_pipeline.py             # T5
    io.py                         # etl_report.json sections
  src/greenwave/dataset/          # T7: startup loader (loader.py, errors.py, settings.py)
  scripts/run_etl.py              # CLI: one subcommand per step (see its docstring)
  scripts/build_manifest.py       # write/check data/raw/MANIFEST.json
  tests/etl/                      # tiny synthetic fixtures, never the 310 MB file
  tests/dataset/                  # T7: loader and startup tests; the real-data smoke test skips
                                  #   where data/processed/ is absent
```

Raw data stays out of git. Real-data ETL runs are manual; the tests never read the raw files
(one test checks them against the manifest and skips where they are absent).

## 5. Steps

Each step ends with tests, `ruff`, `mypy`, `pytest`, and a short report (INSTRUCTIONS.md 10).
Stop after each step for approval.

**T0. Data foundation** (done)
- Place raw files under `backend/data/raw/`, confirm they are gitignored, write `MANIFEST.json`
  (sha256, size, retrieval date, licence/attribution: OSM is ODbL and requires attribution).
- Add deps with `uv add` only if justified (candidates: `pyarrow` for parquet; `osmnx` only if T3 uses it).
- Done when: manifest exists and a test verifies hashes.

**T1. Profile and validate (read-only)** (done, approved)
- Stream the OSM GeoJSON (one feature per line; do not load 310 MB into memory naively).
- Produce `etl_report.json` section `profile`: feature counts by type, drivable-way count, coverage of
  `maxspeed`, `oneway`, `lanes`, `name`, `junction`, `bus:lanes`/`busway` tags **by road class and by length**;
  invalid geometries; bounding box; points outside the city outline.
- Verify the claims in section 1 independently (do not trust this file blindly) and note differences.
- Done when: the report exists, and the numbers needed to decide 6.1 to 6.5 are in it.

**T2. Signals module** (reduced scope; done, approved)
- Extract `highway=traffic_signals` points and signalised crossings; normalise tag variants and
  crossing kinds; apply the handling policy from config (counted / excluded / manual review).
- Provisional distance clusters only (radius from config), as a grouping aid. Output `signals.parquet`
  with a provisional `cluster_id`. **No `intersections.parquet` here**: final intersections are
  produced after T3/T4 from graph junction nodes.
- Rejects report: tag `blinker`/`tram_priority`/`controller`/`disabled`, tram/rail crossings, points
  off the drivable network.
- Tests: cluster boundary at radius minus/equal/plus epsilon, singleton, chained clusters (A-B and B-C
  within radius but A-C not: chains into one cluster, tested), CRS/units.

**T3. Road graph** (done, approved)
- Graph source (decision 6.1): the pinned GeoJSON, topology from exactly shared 7-decimal vertices.
  No PBF. **Limitations, accepted:** no turn restrictions; no OSM node ids (node key is the rounded
  coordinate `"lon,lat"` with 7 decimals); ways that cross without a shared vertex (bridges,
  tunnels) are not connected, and a missed shared vertex would silently disconnect a road.
- Ways are split at vertices shared by 2+ ways (or revisited by one way) and at their ends. Every
  edge keeps all original vertices. Edge id: `W<source line>.<segment>+|-` (`-` is the reverse
  direction); parallel edges are allowed (`MultiDiGraph`). Length is in EPSG:2178 metres.
- **Deviation from the earlier plan:** signal nodes are *not* kept as graph nodes in T3 (the GeoJSON
  has no vertex tags and T4 owns signal attachment). T4 splits an edge at the exact signal vertex or
  at the snapped position; no geometry is lost.
- Direction and speed use the approved rules (`etl/road_rules.py`): implied one-way, explicit
  `oneway` wins, `reversible` ways are excluded and reported (not guessed). Speed is `speed_kmh`
  with `speed_source` (`osm_maxspeed`, `class_default`, `class_default_unparsed_maxspeed`).
- Report (`etl_report.json`, section `graph`): build counts, strongly/weakly connected components,
  largest strongly connected component by length, islands, one-way trap fragments, per-street length
  comparison with `Ulice.geojson` (`street_length_comparison.csv`), 5 shortest-path sanity checks
  (`route_sanity_checks.geojson`). Unreachable signals are reported in T4, after attachment.
- Parquet pair instead of a pickle: inspectable and cannot execute code on load (T7 rebuilds the graph).

**T4. Attach signals to graph and name intersections** (done, approved; decisions 8-13 applied)
- Counted nodes from T2 (984 signals + 60 standalone pedestrian crossings) are attached by splitting
  edges (`etl/network.py`); the new edges are `<edge id>~<n>` and keep `base_edge_id`. A signal on an
  existing node uses it; one on an interior vertex splits the edge there; one off the network snaps to
  the nearest edge within `SIGNAL_SNAP_TOLERANCE_METERS` (30 m, approved; unsnapped signals are
  listed: one crossing, Skwerowa, stays excluded). The controlled edges are the ones *arriving* at the
  signal node. `traffic_signals:direction` (`forward` = along the way's digitised direction) picks the
  edge for split signals; absent or `both` controls both directions; a direction with no matching edge
  is reported as unresolved, not guessed. At an existing junction node the tag cannot pick an edge, so
  every arriving edge is controlled and the report counts these.
- **Welding (approved).** Way ends within `WELD_TOLERANCE_METERS` (1 m) of another way's end or body
  get a shared vertex, never across different layer, bridge or tunnel. Every weld and every skipped
  candidate is logged (`welds.csv`, report section `intersections.welds`; 7 welded, 48 skipped for a
  layer/bridge/tunnel difference). All ETL steps after the scan use the welded ways
  (`etl/prepare.py`). The 19 near-misses involving a tertiary-or-above road are in
  `near_misses_tertiary_plus.csv` with their weld status, for human review (decision 12).
- **Intersection = graph junction node with counted signals**, grouped as follows:
  1. each approach goes to its nearest junction along the road (undirected, metres);
  2. an approach farther than `ASSIGNMENT_LIMIT_METERS` (50 m) becomes a standalone mid-block signal
     (`kind=midblock_signal`, its own `INT-` id);
  3. a ring is one intersection (decision 6.8); rings come from `junction=roundabout|circular` and the
     hand-made `backend/data/overrides/roundabouts.json`;
  4. the remaining junction nodes within `MERGE_DISTANCE_METERS` (30 m) along the road merge, closest
     pairs first, unless the merged group's diameter would exceed `MERGE_MAX_GROUP_DIAMETER_METERS`
     (65 m); every refused merge is in `grouping.capped_cases` (none at 65 m; the largest merged
     group is 64.2 m, Aleje / Czarnowiejska; at a 60 m cap that one merge would be refused);
  5. standalone pedestrian crossings are `kind=pedestrian_crossing` intersections; crossings within
     `CROSSING_MERGE_DISTANCE_METERS` (15 m, its own key) along the road merge under the same
     diameter cap (59 crossing nodes become 54 intersections).
- Result on the pinned snapshot: **534 intersections** = 428 signalised junctions + 52 mid-block
  signals + 54 pedestrian crossings (`etl_report.json`, `intersections.grouping`).
- **D_v (35 s, per type via config) is applied once per unique intersection `INT-xxxx` whose
  controlled approach the route passes;** a route crossing two approaches of one intersection pays it
  once. `signal_approaches.delay_seconds` is a property of the signal node and must not be summed
  along a route. `intersections.parquet` has a `delay_seconds` column: D_v of the intersection by
  `kind` (`signalised_junction` and `midblock_signal` use `SIGNAL_DELAY_SECONDS`, `pedestrian_crossing`
  uses `PEDESTRIAN_CROSSING_DELAY_SECONDS`; a kind with no mapping raises). The two values used are
  in the report section `intersections` (`delay_seconds_by_kind`). `config.py` states the same rule.
- Ids `INT-0001...`: signalised junctions first, then mid-block signals, then pedestrian crossings;
  each by group-centroid position (south to north, then west to east). Stored in `intersection_ids.json`
  with the manifest hash; valid for the pinned snapshot and this configuration only. No `MSIP-SIG-*`
  ids are generated; the mock ITS gateway uses our ids. Contract wording changes wait for the human
  (decision 6).
- Names come from the distinct street names around the member nodes, most important road class first
  (a ring's own name leads); never invented; coordinates if there is no name. Cross-checked against
  `Ulice.geojson` (match rate in the report).
- Roundabout overrides (decision 13): Mogilskie, Maczka, Barei verified. Matecznego: the bypass link
  W380811.0+ (`primary_link`, same name, joins two ring nodes) is not part of the ring; it is an
  `internal_edge_ids` entry of the intersection (neither ring nor entry arm, not dangling) and the
  entry stays unverified until the human confirms. Approaches on an internal edge join the ring.
  Piekarza Ochwata is removed and is an ordinary intersection. `run_etl.py override-map` writes the
  check page.

**T5. Corridor batching precompute** (done, approved)
- `uv run python scripts/run_etl.py neighbours` reads the processed network and signal approaches and
  writes `approach_neighbours.parquet` plus the report section `neighbours`. It refuses to run when
  the processed artifacts were built from a different manifest.
- An *approach* is a (signal, controlled edge) pair; its stop line is at the end of the controlled
  edge, so a signal controlling both directions gives two directed approaches. A pair (A -> B) means a
  vehicle that has just crossed A's stop line reaches B's stop line by driving forward along directed
  edges, with a shortest drive of at most `CASCADE_THRESHOLD_METERS` (250 m, inclusive `<=`, the same
  threshold as the architecture doc's along-route stop-line distance `d <= 250 m`).
  Each row has the distance, the two approach edges, both intersection ids and the shortest-path
  edge ids (the edges driven after A's stop line, ending with B's controlled edge).
- No pair is made inside one intersection. U-turns (reversing straight back along the edge just
  driven) are not allowed (`CASCADE_ALLOW_U_TURNS = False`) because the graph has no turn
  restrictions and U-turns would make the opposing approach of the next signal look like a neighbour;
  the report counts the pairs the other setting would give.
- Result: 1,339 approach edges give **1,293 pairs** (518 directed intersection pairs); the median
  distance is 158 m, the maximum 249.9 m (`etl_report.json`, `neighbours`).
- **This table is only the candidate set.** The distance is a shortest path between two stop lines.
  The simulation must use the along-route distance on the actual route, and must not read this
  distance as the distance between two signals on its route.

**T6. Kraków open data enrichment** (skipped / parked for PoC, approved)
- The Kraków open-data requirement is already satisfied by `Ulice.geojson` in T3 (`street_length_comparison.csv`) and T4 (intersection street-name cross-check).
- `Buspasy_wyświetlenie_*.csv` and `Linie_KMK_*.csv` have no geometry and are parked for the PoC. Proceed directly to T7.

**T7. Loader and API hook** (done, approved; real-data check 2026-10-15)
- `greenwave.dataset.load_dataset` reads `data/processed/` once at startup (FastAPI lifespan) and
  returns one read-only `ProcessedDataset`. It raises a `DatasetError` subclass that names the file
  and the ETL command to re-run when: an artifact is missing or unreadable; the manifest sha256 differs
  from the one recorded in `intersection_ids.json` or the `etl_report.json` sections `intersections`
  and `neighbours`; references between artifacts dangle; or row counts differ from the report. No
  fallback, no partial load, no ETL code in request handlers. Paths come from `DatasetSettings`
  (`GREENWAVE_PROCESSED_DIR`, `GREENWAVE_RAW_MANIFEST_PATH`).
- Real-data check, 2026-10-15, after a full rebuild from the committed manifest: loaded in 0.8 s;
  534 intersections, 1,044 signal approaches, 1,293 neighbour pairs (1,339 approach edges), graph
  34,777 nodes / 68,619 edges, `cascade_threshold_m` 250.0, `allow_u_turns` False; all match the ETL
  report. `GET /api/v1/health` returned 200. A dangling `INT-9999`, a deleted artifact and a modified
  manifest each stopped uvicorn startup with a specific error. Gate: 246 passed, 0 skipped (the
  real-data smoke test ran and passed).
- The 0.8 s load time is one observation, not a benchmark (T8). The residual risk of mixed runs
  under one manifest is addressed by T7b.

**T7b. Per-artifact hashes and D_v per intersection** (done, approved; real-data check 2026-10-15)
- Purpose: detect processed artifacts from different runs (same manifest, changed config, partial
  re-run). It is an integrity check against mixed runs, not a security measure; hashes are compared
  only with the record of the same run, and no reproducible-build claim is made. `etl_report.json`
  itself is not hashed.
- `run_intersections` records `artifact_sha256` (network_nodes, network_edges, intersections,
  signal_approaches, intersection_ids.json) in the section `intersections`. `run_neighbours` records
  `artifact_sha256` for approach_neighbours.parquet and `consumed_sha256`, the hashes of the T4
  files it read (computed from disk just before reading), and raises `StaleArtifactError` if they
  differ from the record in section `intersections` or if the record is missing.
- The loader hashes the six files (`sha256_of_file`, streaming) and raises
  `ArtifactHashMismatchError` (file name, recorded and actual hash, the command to re-run) when a
  file differs from its record or when `consumed_sha256` differs from the T4 record. Processed data
  without the new fields (or without `delay_seconds`) fails with a message to re-run `intersections`
  and then `neighbours`, never a `KeyError`.
- D_v per intersection: `intersections.parquet` gets `delay_seconds` by `kind` from the two config
  keys (no literal value, no default for an unknown kind); the loader requires the column (Float64)
  and rejects null, negative or non-finite values. `signal_approaches.delay_seconds` is unchanged. No
  other value changed.
- Real-data check, 2026-10-15, after a full rebuild (manifest check, `intersections`, `neighbours`):
  loaded in 0.80 s with the extra hashing (one observation, not a benchmark); 534 intersections,
  1,044 signal approaches, 1,293 neighbour pairs, 1,339 approach edges, graph 34,777 nodes / 68,619
  edges; manifest hash `a5e4176136345d4c...`. `delay_seconds` is 35.0 for all 534 intersections (428
  signalised junctions, 52 mid-block signals, 54 pedestrian crossings). `/api/v1/health` returned
  200. On scratch copies, a flipped byte in `signal_approaches.parquet` stopped startup with
  `ArtifactHashMismatchError` (file, both hashes, re-run `intersections` and then `neighbours`), and
  an `etl_report.json` without `artifact_sha256` stopped it with `MalformedArtifactError` ("written
  by an older ETL version; re-run `intersections` and then `neighbours`"). Gate: 274 passed, 0
  skipped. The mixed-run scenario was tested on synthetic fixtures only.

**T8. Benchmark** (not started)
- Measure ETL runtime and graph load time and shortest-path latency on the real graph. Report hardware and
  method. Do not state budgets that were not measured.

## 6. Decisions

One list. **Open** items need the human; everything else is decided and applied. Config keys are in
`backend/src/greenwave/etl/config.py`. Numbers 1-8 keep their original numbering (code comments
cite them).

1. **Graph source.** Decided: build from the pinned GeoJSON (shared exact vertices), no PBF.
   Limitations: no turn restrictions, no OSM node ids (node key = rounded coordinate), a missed shared
   vertex silently disconnects a road.
2. **Signal clustering.** Decided: provisional 40 m radius (`SIGNAL_CLUSTER_RADIUS_METERS`), a grouping
   aid only; the intersection is a graph junction node (see 8, 9).
3. **Signals in D_v.** Decided: untagged, `signal`, `traffic_lights` and `controller` (flagged, listed
   with coordinates) count; `blinker`, `tram_priority` and tram/rail crossings are excluded and
   listed; standalone `highway=crossing` crossings (no counted signal within
   `STANDALONE_CROSSING_DISTANCE_METERS` = 30 m) count as a separate type. D_v is 35 s per type
   (`SIGNAL_DELAY_SECONDS`, `PEDESTRIAN_CROSSING_DELAY_SECONDS`).
4. **Speed model.** Decided: routable ways exclude `service=driveway|parking_aisle|drive-through` and
   `access=private|no`; implied one-way (motorway, roundabout) applies; a missing `maxspeed` uses a
   class default with `speed_source` (`CLASS_DEFAULT_SPEED_KMH`; primary 50; `trunk_link` and `road`
   50 are placeholders, 0.02 km and 0.05 km). Ambulance speed on edge $e$ is
   `V_ambulance(e) = min(max(1.3 * speed_kmh, 30.0), 90.0)` km/h, with `D_min = 3` s per intersection.
5. **Official Kraków signal layer.** Decided: no separate MSIP traffic-signal layer is used. The pinned BBBike OSM extract is the final source for signals and road topology, and Kraków's `Ulice.geojson` is the verified municipal open-data source.
6. **Intersection ids.** Decided: `INT-0001` through `INT-0534` generated by kind then position,
   stored with the manifest hash, valid for the pinned snapshot and configuration only. No `MSIP-SIG-*`
   ids are generated from OSM data; mock ITS payloads use our `INT-` ids. Contract wording is closed
   and aligned with the architecture doc.
7. **Licence and attribution wording.** Decided 2026-10-15; recorded per file in
   `backend/data/raw/MANIFEST.json` (written by `scripts/build_manifest.py`).
   - OSM: ODbL 1.0, "© OpenStreetMap contributors".
   - Kraków open data (`Ulice.geojson`, `Buspasy_*.csv`, `Linie_KMK_*.csv`): Polish Open Data Act
     (Ustawa z dnia 11 sierpnia 2021 r. o otwartych danych i ponownym wykorzystywaniu informacji
     sektora publicznego, Dz.U. 2021 poz. 1641), free re-use with source attribution; source URL
     https://msip.krakow.pl/ (`Ulice.geojson`: https://msip.krakow.pl/dataset/1379); per-file
     attribution text in the manifest. `__Aktualnosc__.txt` has the same licence value and records
     the export timestamp only.
   - Combined app/README text: "Road network and traffic signal geometry © OpenStreetMap
     contributors, licensed under the Open Database License (ODbL), extracted via BBBike.org.
     Municipal street registry (Ulice.geojson) provided by Urząd Miasta Krakowa / Miejski System
     Informacji Przestrzennej (MSIP, export timestamp: 2026-10-13 00:47:34), re-used under the
     Polish Act on Open Data and Re-use of Public Sector Information (Dz.U. 2021 poz. 1641). All
     traffic signal states, delays, and priority dispatches are simulated proof-of-concept inputs
     and do not represent verified physical traffic signal states."
   - Evidence, checked 2026-10-15 (as supplied by the human): the export metadata file
     `backend/data/raw/krakow/__Aktualnosc__.txt` (export timestamp 2026-10-13 00:47:34); the Act
     of 11 August 2021 (Dz.U. 2021 poz. 1641) and the Kraków BIP/MSIP terms for re-use of public
     sector information (source attribution, timestamp, notice of modification); the OpenStreetMap
     Legal FAQ and ODbL 1.0 terms for the BBBike extract (retrieved 2026-10-13). Owner reply: none;
     the statutory re-use terms are taken to apply directly. No dataset-specific licence page was
     recorded.
8. **Roundabouts and D_v.** Decided: a ring is one intersection. D_v (35 s, per type via config) is
   applied once per unique intersection `INT-xxxx` whose controlled approach the route passes; a
   route crossing two approaches of one intersection pays it once. `signal_approaches.delay_seconds`
   is a property of the signal node and must not be summed along a route.
9. **Assignment and merging.** Decided: an approach farther than 50 m from its nearest junction along
   the road is a standalone mid-block signal (`ASSIGNMENT_LIMIT_METERS`); junction nodes with counted
   signals within 30 m along the road merge (`MERGE_DISTANCE_METERS`) unless the group's diameter
   would exceed 65 m (`MERGE_MAX_GROUP_DIAMETER_METERS`); every refusal is reported.
10. **Snapping and crossings.** Decided: snap tolerance 30 m (`SIGNAL_SNAP_TOLERANCE_METERS`);
    standalone pedestrian crossings get `INT-` ids with `kind=pedestrian_crossing`; Skwerowa (52.7 m
    from any edge) stays excluded and listed.
11. **Crossing merge.** Decided: crossings within 15 m along the road merge
    (`CROSSING_MERGE_DISTANCE_METERS`, its own key), under the same diameter cap.
12. **Welding.** Decided: way ends within 1 m of another way's end or body are welded
    (`WELD_TOLERANCE_METERS`), never across different layer, bridge or tunnel; every weld logged.
    Human review of the 19 near-misses involving a tertiary-or-above road (`near_misses_tertiary_plus.csv`) is complete and approved: the 9 sub-metre skips are valid grade separations, the 2 welds on Marii Dąbrowskiej are valid, and the 8 cases between 1.02 m and 1.30 m (Igołomska stub, Kąpielowa vs. A4 motorway, and Walerego Sławka parallel carriageways) must remain unwelded. The 1 m rule is confirmed and unchanged.
13. **Roundabout overrides.** Decided: Mogilskie, Maczka and Barei verified; Piekarza Ochwata removed
    (ordinary intersection); the Matecznego bypass link is an internal edge, not ring. Matecznego is successfully verified
14. **Cascade candidate set.** Decided: neighbour pairs at distance <= 250 m
    (`CASCADE_THRESHOLD_METERS`, inclusive; the architecture doc says along-route stop-line distance
    `d <= 250 m`, also inclusive), in travel
    direction, no pair inside one intersection, no U-turns (`CASCADE_ALLOW_U_TURNS`). The table is only
    a candidate set; the simulation uses along-route distance.
