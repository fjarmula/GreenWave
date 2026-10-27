# ER-GreenWave backend

FastAPI service: spatial ETL, simulation engine and telemetry API.
See `../GreenWave_ARCHITECTURE.md` for the design, `../AGENTS.md` for contributor rules and
`../docs/engineering/data-pipeline.md` for data-pipeline constraints.

## Commands (run from `backend/`)

```bash
uv sync                                        # install
uv run uvicorn greenwave.main:app --reload     # run locally (http://127.0.0.1:8000/docs)
uv run ruff check . && uv run ruff format --check .
uv run mypy
uv run pytest
uv run python scripts/export_openapi.py        # regenerate ../contracts/openapi.json
```

## Data pipeline (offline ETL)

Raw files live in `data/raw/` (gitignored; `data/raw/MANIFEST.json` records their sha256, source and
licence and is committed). Processed artifacts go to `data/processed/` (gitignored, rebuilt from the
raw data). The hand-made `data/overrides/roundabouts.json` is committed.

```bash
uv run python scripts/build_manifest.py --check  # raw files match data/raw/MANIFEST.json
uv run python scripts/run_etl.py profile         # T1: etl_report.json (section profile)
uv run python scripts/run_etl.py signals         # T2: signals.parquet
uv run python scripts/run_etl.py graph           # T3: road_nodes/road_edges.parquet + checks
uv run python scripts/run_etl.py override-map    # check page for data/overrides/roundabouts.json
uv run python scripts/run_etl.py intersections   # T4: network_*, intersections, signal_approaches, ids
uv run python scripts/run_etl.py neighbours      # T5: approach_neighbours.parquet (candidate set only)
uv run python scripts/run_etl.py places          # stations + addresses + resources.parquet (run after intersections)
uv run python scripts/run_etl.py quality         # data_quality.json (run after neighbours and places)
```

`places` reads the OSM extract (one pass) for rescue stations and address points, then keeps only those
within 150 m of a network node (`PLACES_MAX_SNAP_DISTANCE_M`, equal to the simulation snap limit).
Beyond the road features used elsewhere it uses: `emergency=ambulance_station`, `amenity=hospital` +
`emergency=yes`, `amenity=fire_station`, `amenity=police` (points and polygons; stations of one type
and name within `STATION_DEDUP_RADIUS_M` merge, police of one name merge at any distance, keeping the
headquarters building; police and hospitals that are not 112 dispatch bases are excluded by
`POLICE_EXCLUDED_NAME_FRAGMENTS` and `AMBULANCE_EXCLUDED_NAMES`; hospitals missing `emergency=yes`
are added by exact name with `AMBULANCE_INCLUDED_NAMES`) and any feature with
`addr:street`/`addr:place` plus `addr:housenumber` (the same street and number merge only within
`ADDRESS_DEDUP_RADIUS_M`; each address gets a unique `label`, with its locality from
`addr:suburb`/`addr:quarter`/`addr:place`/`addr:city` when it is outside Kraków or repeated). It
refuses to run if the network files differ from the `intersections` report section. Places snap only to the
main strongly connected component of the road graph (as the router does), and a large polygon
station whose centre is beyond the snap limit moves to its outline point nearest the network
(`relocated_to_outline`). The `places` report section lists dropped stations, the kept police
names and the excluded names.

`places` also reads Kraków's official address points, *Punkty adresowe (EMUiA)*
(`data/raw/krakow/emuia/Adresy.geojson` and its `__Aktualnosc__.txt`, unzipped from
<https://msip.um.krakow.pl/Dane/Adresy_JSON.zip>; required). On-network EMUiA points are
reconciled with the OSM addresses (`etl/address_reconcile.py`, ADR 0013): the same street key and
house number within `ADDRESS_MATCH_MAX_M` (500 m; above `ADDRESS_MATCH_CLEAN_M`, 100 m, it is a
disagreement), never to an OSM address outside Kraków; then the same house number within
`ADDRESS_NAME_VARIANT_RADIUS_M` (50 m) when the street names share tokens, or within
`ADDRESS_NAME_VARIANT_TIGHT_M` (20 m). Each address has a `provenance` (`matched`, `municipal`,
`osm`); matched and municipal ones use the EMUiA name and coordinate. The report's
`addresses.reconciliation` holds the counts and real examples of each class. An address point is
a geocoding result, not a vehicle access point. EMUiA's district number (`numer_dzielnicy`, 1-18)
is kept as `district_number` on matched and municipal rows.

Ambulance origins are the official PRM team bases (ADR 0014), not OSM buildings. `places` reads
Tables 1a and 2a of the Małopolska PRM plan, update no. 2
(`data/raw/prm/amendments/AKTUALIZACJA_NR_2_TABELE.xlsx`; required) with a standard-library
reader (`etl/xlsx_reader.py`) and joins them on the team name (`etl/prm_roster.py`). Base
coordinates are curated in the committed `data/curated/prm_bases.json`: an EMUiA id for a Kraków
base, or a cited coordinate elsewhere (the published addresses do not geocode as free text). Each
curated base becomes a `prm_base` station named by its published address; an OSM ambulance station
within `PRM_BASE_OSM_MATCH_RADIUS_M` (200 m) keeps its `osm_ref` as the match. OSM ambulance
stations and hospital SORs without a base are no longer written (`resources.replaced_by_prm`).
`resources.parquet` lists the teams in scope (type, area TERYT codes, weekdays, readiness window in
minutes, season); region RO12/01 teams without a curated base are listed as
`resources.outside_simulation_area`. The suburban bases are not in the OSM extract, so only the 23
Kraków-based teams (8 bases) are in scope today.

`quality` reads the outputs of `graph`, `intersections`, `neighbours` and `places` (near misses,
street lengths, route checks, signal snapping, signals needing review, the bus-lane cross-check,
the `road_attributes` section and the EMUiA address reconciliation) and writes `data_quality.json`, a small deterministic summary served at
`GET /api/v1/dataset/quality`. It records the hashes of the files it read in the `quality` report
section. Re-run it after any of those steps.

`intersections` also derives road attributes per network edge (`bus_lane`, `lanes_per_direction`,
`surface_class`, `calming_count`, `tram_track` in `network_edges.parquet`), writes the
`road_attributes` report section, and writes `bus_lane_crosscheck.csv`: each row of the Kraków
bus-lane register (`krakow/Buspasy_*.csv`, exactly one file) matched by street name against OSM
bus-lane edges, with a `status` of `osm_has_bus_lane`, `osm_street_without_bus_lane`,
`street_not_found` or `unparsed`. The cross-check is analysis only; it never changes an edge.

`scripts/road_attribute_evidence.py` prints a Markdown evidence table for choosing the road-attribute
time factors: km and edge counts per attribute value, the bus-lane cross-check counts, and the
normal and GreenWave estimates for every dashboard origin x destination under each profile. It
reads the built `data/processed/` and writes nothing. A `neutral` profile is always included; add
candidates with `--profile NAME --set FIELD=VALUE ...` (any `SimulationSettings` field):

```bash
uv run python scripts/road_attribute_evidence.py --profile mild \
  --set normal_single_lane_factor=1.1 --set ambulance_bus_lane_factor=1.1
```

The routable network also contains **access ways**: usable tracks (`highway=track` not closed by
`access=private|no`, with `tracktype` absent or `grade1`-`grade3`) and ways tagged
`emergency=yes|designated|official` whose `highway` is a drivable class, `track` or `pedestrian`
(whatever their `access` tag). The scan keeps them in their own list, so the T1 profile's drivable
count is unchanged, and `prepare_scan` merges them before welding. Their class speeds (`track`
15 km/h, `pedestrian` 10 km/h) and the selection rules are uncalibrated placeholders in
`etl/config.py`. Footways, paths and steps never become access ways.

Three more steps exist as decision aids: `draft-overrides` (drafts the override file, never
overwrites an existing one), `roundabouts` (an inventory report) and `cluster-map` (a check page). See the docstring of
`scripts/run_etl.py` for what each step writes.

The ETL reads the OSM extract in about 20 s; the whole chain takes a few minutes. Real-data runs are
manual: the tests use tiny synthetic fixtures only.

Everything the ETL produces is a simulation input, not a verified physical signal state.

### ETL equivalence check (refactor guard)

`scripts/etl_equivalence.py` proves a refactor leaves every ETL output byte-identical. Use a
scratch directory outside the repository; `run` refuses one inside it.

```bash
S=$(mktemp -d)                                                       # outside the repository
uv run python scripts/etl_equivalence.py run $S/base1 $S/base1.json  # two runs on unchanged code
uv run python scripts/etl_equivalence.py run $S/base2 $S/base2.json
uv run python scripts/etl_equivalence.py compare $S/base1.json $S/base2.json  # finds volatile entries
# ...apply the refactor...
uv run python scripts/etl_equivalence.py run $S/new $S/new.json
uv run python scripts/etl_equivalence.py compare $S/base1.json $S/new.json --allow etl_report.json
```

`run` needs the committed `data/overrides/roundabouts.json` and exits before creating any scratch
state if it is missing. Restore it from git; never use the harness to generate or repair it. The
harness symlinks `data/raw/` and `data/overrides/` into the scratch directory and only reads them;
outputs go to the scratch `data/processed/`. `compare` exits 1 when any entry not named with
`--allow` differs; step timings are reported but never compared.

## Running the server needs built data

The server loads and validates `data/processed/` once at startup (`greenwave.dataset`). Build it
first (`graph`, `intersections`, `neighbours`, then `quality`, see above). If a file is missing, stale or inconsistent,
startup fails with an error that names the file and the ETL command to re-run; there is no
fallback. Paths default to `backend/data/processed` and `backend/data/raw/MANIFEST.json`; override
them with `GREENWAVE_PROCESSED_DIR` and `GREENWAVE_RAW_MANIFEST_PATH`.

Editing `data/raw/MANIFEST.json`, even metadata only, makes every processed artifact stale: re-run
`intersections`, `neighbours` and then `quality`.

## Simulation configuration

The simulation is entirely in-memory and simulated. `GREENWAVE_CORS_ORIGINS` is a comma-separated
allow-list for browser clients (default: `http://localhost:3000`); credentials are never allowed.
Simulation tunables use the `GREENWAVE_SIM_` prefix. The defaults are suitable for the PoC; useful
development overrides include `GREENWAVE_SIM_TICK_INTERVAL_SECONDS`,
`GREENWAVE_SIM_SUBSCRIBER_QUEUE_SIZE` (default 32), and
`GREENWAVE_SIM_MAX_SNAP_DISTANCE_METERS` (default 150). All values are validated at startup.

Road-attribute time factors (`routing/edge_times.py`; values approved in
`docs/adr/0005-road-attribute-time-factors.md`). Factors must be at least 1.0 and seconds at least
0; setting all six to 1.0 / 0 makes road attributes have no effect:

| Variable | Default | Effect |
|---|---:|---|
| `GREENWAVE_SIM_NORMAL_SINGLE_LANE_FACTOR` | 1.15 | normal time multiplier when `lanes_per_direction == 1` |
| `GREENWAVE_SIM_NORMAL_UNPAVED_FACTOR` | 1.3 | normal time multiplier when `surface_class == "unpaved"` |
| `GREENWAVE_SIM_NORMAL_CALMING_SECONDS` | 3.0 | normal seconds added per traffic-calming feature |
| `GREENWAVE_SIM_AMBULANCE_CALMING_SECONDS` | 2.0 | ambulance seconds added per traffic-calming feature |
| `GREENWAVE_SIM_AMBULANCE_BUS_LANE_FACTOR` | 1.05 | ambulance speed boost on `bus_lane` edges |
| `GREENWAVE_SIM_AMBULANCE_TRAM_TRACK_FACTOR` | 1.05 | ambulance speed boost on `tram_track` edges |

Bus-lane and tram boosts do not multiply: the larger one applies, before the 30-90 km/h clamp.

The stream endpoint is `GET /api/v1/simulation/{simulation_id}/stream`. It uses SSE with a
`retry: 2000` control frame followed by framed contract events. Slow clients receive bounded,
drop-oldest telemetry; terminal events are preserved.

Each ETL step records the sha256 of the files it wrote (and `neighbours` and `quality` of the files they read) in
`etl_report.json`, and the server re-checks them at startup: this is an integrity check against
artifacts from different runs, not a security measure and not a reproducible-build claim.

## Data Sources & Attribution

- **OpenStreetMap:** Road network and traffic signal geometry © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, licensed under the Open Database License (ODbL), extracted via [BBBike.org](https://extract.bbbike.org/).
- **City of Kraków Open Data:** Municipal street registry (Ulice.geojson) provided by Urząd Miasta Krakowa / Miejski System Informacji Przestrzennej (MSIP, export timestamp: 2026-10-13 00:47:34), re-used under the Polish Act on Open Data and Re-use of Public Sector Information (Dz.U. 2021 poz. 1641).
- **City of Kraków Open Data, Punkty adresowe (EMUiA):** Official address points provided by Urząd Miasta Krakowa, Wydział Geodezji / MSIP ([dataset 1492](https://msip.krakow.pl/dataset/1492), export timestamp: 2026-10-27 00:45:04), used under the MSIP terms and the Polish Act on Open Data. They are the authoritative coordinate for incident addresses, reconciled against OSM.
- **Disclaimer:** All traffic signal states, delays, and priority dispatches generated by ER-GreenWave are simulated proof-of-concept inputs and do not represent verified physical traffic signal states.

## Simulated ITS feedback

Priority submission creates REQUESTED only. A separate per-run in-process controller
accepts/rejects it and supplies reported intersection/signal snapshots. Acceptance
starts CLEARING; PRIORITY_GREEN requires supported route vehicle indications green.
Nothing connects to or actuates a real controller. The payload is illustrative.

Start requests accept `its_scenario`: NOMINAL (1 s acknowledgement), DELAYED (5 s),
REJECTED or NO_FEEDBACK (8 s timeout). All timings are simulated seconds; playback
changes wall-clock pacing only. Disabled runs normalize to NOMINAL; live comparisons use the selected scenario for the enabled member and NOMINAL for the baseline. The dispatch form preserves scenario selection across navigation.

ITS_FEEDBACK has request identity and a per-run sequence. Each tick contains the full
bounded request ledger and controller observation time for reconnect/drop recovery.
Request status is displayed separately from reported traffic, with original JSON in
diagnostics. Missing legacy feedback is labelled unavailable; ended runs show the
last report. Rejection, timeout and enforced hold expiry cancel the run explicitly,
without completion/successful comparison. Estimates are model baselines, not timing
guarantees. See proposed [ADR 0008](../docs/adr/0008-simulated-its-feedback.md).
