# ER-GreenWave

Simulation-only proof of concept for emergency-vehicle green corridors in Kraków. It never controls real traffic infrastructure.

## Getting Started

### Prerequisites

- Git
- [uv](https://docs.astral.sh/uv/) and Python 3.12
- Node.js 22 and npm (`frontend/.nvmrc` pins the version)

### Install

```bash
git clone <repository-url> GreenWave
cd GreenWave

uv python install 3.12
cd backend && uv sync --dev --locked && cd ..
cd frontend && npm ci && cd ..

uv run --project backend pre-commit install --install-hooks
```

The last command installs the git hooks once per clone. Besides the usual pre-commit and pre-push checks, `post-checkout`, `post-merge` and `post-rewrite` hooks refresh the local code graph (`graphify-out/`, never committed; see ADR 0004), so it stays current after `git switch`, `git pull` and `git worktree add`. Claude Code refreshes it at session start and end through the project hooks (accept them if prompted). Codex users open Codex in the repo, run `/hooks` and trust the two project hooks; re-trust whenever `.codex/hooks.json` changes. To refresh by hand, run `scripts/graphify-refresh.sh`; its log is `.tmp/graphify-refresh.log`.

### Prepare the simulation dataset

The raw GIS data and generated artifacts are deliberately gitignored. Obtain the team-provided raw-data bundle and copy it into `backend/data/raw/` with the paths in [`backend/data/raw/MANIFEST.json`](backend/data/raw/MANIFEST.json) unchanged. The OSM source entry does not have a recorded reproducible download URL, so do not substitute a newer extract when recreating the current environment.

```bash
rsync -a /path/to/greenwave-raw-data/ backend/data/raw/

cd backend
uv run python scripts/build_manifest.py --check
uv run python scripts/run_etl.py profile
uv run python scripts/run_etl.py signals
uv run python scripts/run_etl.py graph
uv run python scripts/run_etl.py override-map
uv run python scripts/run_etl.py intersections
uv run python scripts/run_etl.py neighbours
cd ..
```

`intersections` must finish before `neighbours`. Re-run both after changing the raw-data manifest. The backend refuses to start without matching processed artifacts.

### Run locally

Start each server in a separate terminal:

```bash
cd backend
uv run uvicorn greenwave.main:app --reload
```

Backend API docs: <http://127.0.0.1:8000/docs>

```bash
cd frontend
npm run dev
```

Frontend: <http://localhost:3000>

### Quality checks

```bash
cd backend
uv run ruff check .
uv run ruff format --check .
uv run mypy
uv run pytest
```

```bash
cd frontend
npm run lint
npm run typecheck
npm run format:check
npm test
npm run build
```

### Regenerate API contracts

Pydantic models in `backend/src/greenwave/schemas/` are canonical. After changing them, regenerate both committed outputs:

```bash
cd backend
uv run python scripts/export_openapi.py
cd ../frontend
npm run generate:types
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [backend/README.md](backend/README.md), and [frontend/README.md](frontend/README.md) for subsystem details.
