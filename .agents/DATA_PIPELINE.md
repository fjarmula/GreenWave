# Data pipeline: plan and steps for coding agents

Scope: the offline ETL that turns raw datasets into the processed artifacts the simulation loads
at startup (`backend/data/processed/`). This file adds to `.agents/INSTRUCTIONS.md`; it does not
replace it. Where they disagree, stop and tell the human.

Do not invent answers to the open questions in section 6. Implement only the step you are asked
to, do not start the next step without approval (INSTRUCTIONS.md 4.3), and do not commit or push.

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
- `highway=crossing` + `crossing=traffic_signals` (signalised pedestrian crossings): **1,507**
  nodes. 1,435 lie within 30 m of a junction signal; **72 are standalone**.
- 50,107 drivable ways, 211,082 vertices. Road tags (`maxspeed`, `oneway`, `lanes`) exist but
  coverage by road class has not been measured yet (step T1).

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
   - It ignores the 1,507 signalised crossings (tagged `highway=crossing`).
3. We need to own the signal-to-intersection logic anyway (section 3), so a library
   convenience does not save the hard part.

What OSMnx is still good for: building the graph once, offline, from a local file. See T3.

## 3. Modelling rules (so every agent does the same thing)

- **Raw signal node is not an intersection.** Build an `Intersection` entity by clustering
  signal nodes. The radius is a configuration value (`signal_cluster_radius_meters`), default
  to be agreed (see 6.2). Do not hardcode 250 m (that is the corridor batching distance, a
  different concept).
- Keep per-approach information: store the original node coordinates, the
  `traffic_signals:direction` value and the OSM tag variant on each member.
- Treat `blinker` (flashing, no red phase) and `tram_priority` as non-blocking, not as normal
  signals. Whether to include them in `D_v` delay is an open decision (6.3). Never drop them
  silently: write them to a rejects report with a reason.
- Signalised pedestrian crossings: keep as a separate type. The 72 standalone ones are mid-block
  stops that affect travel time; the other 1,435 duplicate junction signals.
- Do all distance work in EPSG:2178 (metres). Convert WGS84 once at ingestion
  (INSTRUCTIONS.md 6.3).
- Every record that is dropped, merged or repaired must be counted and reported. No silent fixes.
- All outputs are simulation inputs. Do not label any derived value as a verified physical signal state.

## 4. Target layout

```
backend/
  data/raw/                       # gitignored; large files never committed
    osm/planet_19_792_50_012_71450a13_osm.geojson
    krakow/Ulice.geojson, Buspasy_*.csv, Linie_KMK_*.csv, __Aktualnosc__.txt
    MANIFEST.json                 # source, URL, download date, sha256, size, licence
  data/processed/                 # artifacts loaded by the server
    signals.parquet               # one row per signal node (+ cluster id)
    intersections.parquet         # one row per cluster
    road_graph.gpickle|graphml    # directed NetworkX graph, EPSG:2178 geometry
    etl_report.json               # counts, rejects, versions, input hashes
  src/greenwave/etl/              # no FastAPI imports here
    ingest_osm.py  ingest_krakow.py  signals.py  graph.py  io.py  config.py
  scripts/run_etl.py              # CLI entry: raw -> processed
  tests/etl/                      # tiny fixtures, never the 310 MB file
```

Check the actual tree and `.gitignore` first. Raw data stays out of git; a small sampled
fixture (a few hundred features around one junction, e.g. Aleje / Czarnowiejska) may be committed.

## 5. Steps

Each step ends with tests, `ruff`, `mypy`, `pytest`, and a short report (INSTRUCTIONS.md 10).
Stop after each step for approval.

**T0. Data foundation**
- Place raw files under `backend/data/raw/`, confirm they are gitignored, write `MANIFEST.json`
  (sha256, size, retrieval date, licence/attribution: OSM is ODbL and requires attribution).
- Add deps with `uv add` only if justified (candidates: `pyarrow` for parquet; `osmnx` only if T3 uses it).
- Done when: manifest exists and a test verifies hashes.

**T1. Profile and validate (read-only)**
- Stream the OSM GeoJSON (one feature per line; do not load 310 MB into memory naively).
- Produce `etl_report.json` section `profile`: feature counts by type, drivable-way count, coverage of
  `maxspeed`, `oneway`, `lanes`, `name`, `junction`, `bus:lanes`/`busway` tags **by road class and by length**;
  invalid geometries; bounding box; points outside the city outline.
- Verify the claims in section 1 independently (do not trust this file blindly) and note differences.
- Done when: the report exists, and the numbers needed to decide 6.1 to 6.5 are in it.

**T2. Signals module**
- Extract `highway=traffic_signals` points and signalised crossings; normalise tag variants.
- Cluster to `Intersection` (radius from config). Output `signals.parquet`, `intersections.parquet`.
- Rejects report: tag `blinker`/`tram_priority`/`controller`/`disabled`, points off the drivable network.
- Tests: cluster boundary at radius minus/equal/plus epsilon, singleton, chained clusters (A-B and B-C
  within radius but A-C not: define and test the behaviour), CRS/units.

**T3. Road graph**
- Build one directed graph from the same snapshot, offline. Preferred: obtain the same BBBike extract as
  `.osm.pbf` or OSM XML and feed OSMnx (`graph_from_xml`) so node ids and shared nodes are exact. Fallback:
  reconstruct topology from shared vertex coordinates in the GeoJSON (works for exact 7-decimal matches,
  has no node ids and no turn restrictions). Pick one and document why.
- Keep tagged signal nodes in the graph (no simplification that removes them).
- Edge attributes: `length_m`, `highway`, `maxspeed_kmh` (null if unknown, never a made-up number),
  `oneway`, `lanes`, `name`, `geometry`.
- Report: weakly/strongly connected components, share of length in the largest component,
  unreachable signals. Do not fabricate routes across components.
- Do not apply speed defaults here; that is a decision (6.4).

**T4. Attach signals to graph and name intersections**
- Snap each signal node to the nearest graph node/edge within a configured tolerance, using
  `traffic_signals:direction` when present to pick the directed edge.
- Name intersections from the two or more distinct street names around the cluster
  (`Aleje / Czarnowiejska` style used in the telemetry example). Cross-check names against `Ulice.geojson`
  (`nazwa_ulicy`, normalised: case, diacritics, "ul."/"al." prefixes) and report the match rate.
- Assign stable intersection ids (see 6.6) and write the mapping used by the ITS request (`MSIP-SIG-*`).

**T5. Corridor batching precompute**
- For each intersection, precompute neighbours along the graph (network distance, not straight line)
  below the cascade threshold d < 250 m. Test below/at/above the threshold.

**T6. Kraków open data enrichment (optional, after T1 to T5)**
- Bus lanes: first measure how many bus lanes can be derived from OSM tags. Use the CSV only to
  validate or fill gaps by matching normalised street names from `Opis` to graph edges. Report match rate;
  unmatched rows stay unmatched. Whether emergency vehicles may use bus lanes, and how that changes
  speed or `traffic_density_multiplier`, is a legal and modelling assumption to confirm with the human.
- KMK tram lines: skip unless tram-priority signals become in scope.

**T7. Loader and API hook**
- A small loader in `greenwave` that reads `data/processed/` at startup and fails loudly if files are
  missing or the `etl_report.json` input hashes do not match the manifest. No ETL code in request handlers.

**T8. Benchmark**
- Measure ETL runtime and graph load time and shortest-path latency on the real graph. Report hardware and
  method. Do not state budgets that were not measured.

## 6. Open decisions for the human (do not guess)

1. Source of truth for the graph: PBF/XML through OSMnx, or reconstruct from the GeoJSON (T3).
2. Signal clustering radius. Data: 682 groups at 30 m, 377 at 50 m. Needs a visual check on known
   junctions (Rondo Mogilskie, Aleje/Czarnowiejska) before choosing.
3. Treatment of `blinker`, `tram_priority`, and standalone pedestrian-crossing signals in `D_v`.
4. Speed model when `maxspeed` is missing, plus `V_ambulance`.
5. Is there an official Kraków (MSIP/ZDMK) layer of signal locations? Our search did not confirm one.
   If it exists, it would be the better authority and OSM becomes the fallback and cross-check.
6. Intersection id scheme and its relation to `MSIP-SIG-*` (architecture doc, open question 2).
7. Licence and attribution wording for OSM (ODbL) and the Kraków open data in the app and README.
