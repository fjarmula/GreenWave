# ER-GreenWave

Simulation-only proof of concept for emergency-vehicle green corridors in Kraków. It never controls real traffic infrastructure.

## Getting Started

For public HTTPS hosting on a free Oracle VM, follow the
[production deployment guide](deploy/README.md). It covers accounts, free DNS, the GIS data
transfer, public HTTPS access, and the separate production Compose stack.

### Prerequisites

- Git
- [uv](https://docs.astral.sh/uv/) and Python 3.12
- Node.js 22 and npm (`frontend/.nvmrc` pins the version)
- Docker Desktop with Docker Compose (optional, for the Compose workflow below)

### Install

```bash
git clone <repository-url> GreenWave
cd GreenWave

uv python install 3.12
cd backend && uv sync --dev --locked && cd ..
cd frontend && npm ci && cd ..

uv run --project backend pre-commit install --install-hooks
```

The last command installs the git hooks once per clone. Besides the usual pre-commit and pre-push checks, the `commit-msg` hook requires a `<category>: <message>` subject, and `post-checkout`, `post-merge` and `post-rewrite` hooks refresh the local code graph (`graphify-out/`, never committed; see ADR 0004), so it stays current after `git switch`, `git pull` and `git worktree add`. Claude Code refreshes it at session start and end through the project hooks (accept them if prompted). Codex users open Codex in the repo, run `/hooks` and trust the two project hooks; re-trust whenever `.codex/hooks.json` changes. To refresh by hand, run `scripts/graphify-refresh.sh`; its log is `.tmp/graphify-refresh.log`.

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

### Run with Docker Compose

After preparing the dataset above, start the dashboard and backend together:

```bash
docker compose up --build
```

Open the dashboard at <http://localhost:3000>. The FastAPI API and its interactive
documentation are available at <http://localhost:8000/docs>. Compose selects the
dashboard's backend transport automatically; HTTP and SSE updates use the local API.
All routing, traffic-signal states, and priority dispatches remain simulated.

The home menu links to enabled and standard simulations, sequential recorded comparison,
diagnostics, and the phone driver presentation. Navigation preserves the scenario and current run;
use explicit Stop to end it. See [frontend workspace guidance](frontend/README.md#simulation-workspace).

The raw and processed GIS directories remain host-managed under `backend/data/` and
are excluded from Docker images. If the processed artifacts are missing, stale, or
inconsistent, backend startup stops with the existing ETL recovery guidance; Compose
does not fall back to mock data.

Source edits reload the FastAPI and Next.js development servers without rebuilding the
images. Follow logs with:

```bash
docker compose logs -f backend
```

Stop the stack while keeping the dependency caches for the next run:

```bash
docker compose down
```

`docker compose down --volumes` removes only the Compose dependency volumes; it does
not remove the host GIS data in `backend/data/`.

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

To try the dashboard on a phone over the LAN, use a production build: `next dev` blocks
other hosts unless `allowedDevOrigins` is configured. Run `npm run build && npx next start
-H 0.0.0.0` and open `http://<your-ip>:3000`. In backend mode, build with
`NEXT_PUBLIC_API_BASE_URL=http://<your-ip>:8000`, start uvicorn with `--host 0.0.0.0`, and
set `GREENWAVE_CORS_ORIGINS=http://<your-ip>:3000`.

Docker Compose is optional. The native `uv` and `npm` commands above and in the
subsystem READMEs remain the authoritative development workflow.

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
