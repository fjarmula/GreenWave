# ER-GreenWave backend

FastAPI service: spatial ETL, simulation engine and telemetry API.
See `../GreenWave_ARCHITECTURE.md` for the design, `../AGENTS.md` for contributor rules and
`../.agents/DATA_PIPELINE.md` for the data pipeline (steps, decisions, open questions).

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

Three more steps exist as decision aids: `draft-overrides` (drafts the override file, never
overwrites an existing one), `roundabouts` (an inventory report) and `cluster-map` (a check page). See the docstring of
`scripts/run_etl.py` for what each step writes.

The ETL reads the OSM extract in about 20 s; the whole chain takes a few minutes. Real-data runs are
manual: the tests use tiny synthetic fixtures only.

Everything the ETL produces is a simulation input, not a verified physical signal state.
