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
```

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
first (`intersections`, then `neighbours`, see above). If a file is missing, stale or inconsistent,
startup fails with an error that names the file and the ETL command to re-run; there is no
fallback. Paths default to `backend/data/processed` and `backend/data/raw/MANIFEST.json`; override
them with `GREENWAVE_PROCESSED_DIR` and `GREENWAVE_RAW_MANIFEST_PATH`.

Editing `data/raw/MANIFEST.json`, even metadata only, makes every processed artifact stale: re-run
`intersections` and then `neighbours`.

## Simulation configuration

The simulation is entirely in-memory and simulated. `GREENWAVE_CORS_ORIGINS` is a comma-separated
allow-list for browser clients (default: `http://localhost:3000`); credentials are never allowed.
Simulation tunables use the `GREENWAVE_SIM_` prefix. The defaults are suitable for the PoC; useful
development overrides include `GREENWAVE_SIM_TICK_INTERVAL_SECONDS`,
`GREENWAVE_SIM_SUBSCRIBER_QUEUE_SIZE` (default 32), and
`GREENWAVE_SIM_MAX_SNAP_DISTANCE_METERS` (default 150). All values are validated at startup.

The stream endpoint is `GET /api/v1/simulation/{simulation_id}/stream`. It uses SSE with a
`retry: 2000` control frame followed by framed contract events. Slow clients receive bounded,
drop-oldest telemetry; terminal events are preserved.

Each ETL step records the sha256 of the files it wrote (and `neighbours` of the files it read) in
`etl_report.json`, and the server re-checks them at startup: this is an integrity check against
artifacts from different runs, not a security measure and not a reproducible-build claim.

## Data Sources & Attribution

- **OpenStreetMap:** Road network and traffic signal geometry © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, licensed under the Open Database License (ODbL), extracted via [BBBike.org](https://extract.bbbike.org/).
- **City of Kraków Open Data:** Municipal street registry (Ulice.geojson) provided by Urząd Miasta Krakowa / Miejski System Informacji Przestrzennej (MSIP, export timestamp: 2026-10-13 00:47:34), re-used under the Polish Act on Open Data and Re-use of Public Sector Information (Dz.U. 2021 poz. 1641).
- **Disclaimer:** All traffic signal states, delays, and priority dispatches generated by ER-GreenWave are simulated proof-of-concept inputs and do not represent verified physical traffic signal states.
