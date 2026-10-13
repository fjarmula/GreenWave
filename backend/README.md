# ER-GreenWave backend

FastAPI service: spatial ETL, simulation engine and telemetry API.
See `../GreenWave_ARCHITECTURE.md` for the design and `../AGENTS.md` for contributor rules.

## Commands (run from `backend/`)

```bash
uv sync                                        # install
uv run uvicorn greenwave.main:app --reload     # run locally (http://127.0.0.1:8000/docs)
uv run ruff check . && uv run ruff format --check .
uv run mypy
uv run pytest
uv run python scripts/export_openapi.py        # regenerate ../contracts/openapi.json
```
