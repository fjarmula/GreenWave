# ER-GreenWave

Emergency vehicles lose time at red lights. ER-GreenWave is a proof of concept for Kraków that
picks the dispatch station, routes the vehicle over the real road network and simulates a
**green corridor**: the signals ahead of an ambulance, fire truck or police car are asked to turn
green in time, and the run shows how many seconds that saves against standard traffic.

**Simulation only.** ER-GreenWave never connects to or controls real traffic infrastructure. Every
signal state, ITS message, delay and priority command it shows is simulated.

## Features

- **Green Wave vs standard traffic.** Run the same scenario with priority signals or with ordinary
  signal timing, and see the time saved live.
- **Live comparison.** Both modes start together on one simulated clock and stream into two maps
  side by side, then a result card compares the actual travel times.
- **Simulated ITS scenarios.** The priority request to the (simulated) traffic controller can be
  nominal, delayed, rejected or unanswered; rejection and timeout end the run visibly
  ([backend README](backend/README.md#simulated-its-feedback), ADR 0008).
- **On-foot and on-site dispatch.** An incident off the road network adds the final walk; an
  incident at the station itself is answered on foot, with no drive (ADR 0012).
- **Address search.** Incident addresses geocode against Kraków's official address points (EMUiA),
  reconciled with OpenStreetMap (ADR 0013).
- **PRM team-aware dispatch.** Ambulances leave from the official Małopolska PRM team bases. With
  the **Team-aware dispatch** switch on, ranking follows team shifts, simulated team status and
  operating areas at a chosen scenario time; with it off, the fastest base wins (ADR 0014).
- **Data quality.** The diagnostics page shows the ETL's data-quality summary and every observed
  request and stream event.
- **Driver view.** A phone-first, map-first view of the run with the next signal ahead.

## Quick start

### Prerequisites

- Git
- [uv](https://docs.astral.sh/uv/) and Python 3.12
- Node.js 22 and npm (`frontend/.nvmrc` pins the version)
- Docker with Docker Compose (optional, for the Compose workflow)

### Install

```bash
git clone <repository-url> GreenWave
cd GreenWave

uv python install 3.12
cd backend && uv sync --dev --locked && cd ..
cd frontend && npm ci && cd ..

uv run --project backend pre-commit install --install-hooks
```

The last command installs the git hooks once per clone (commit-message format and the local code
graph refresh); see [CONTRIBUTING.md](CONTRIBUTING.md).

### Prepare the simulation dataset

The raw GIS data and the processed artifacts are gitignored. Copy the team-provided raw-data
bundle into `backend/data/raw/` with the paths in
[`backend/data/raw/MANIFEST.json`](backend/data/raw/MANIFEST.json) unchanged. The OSM extract has
no recorded download URL, so do not substitute a newer one.

The ETL runs in this order: prepare (`profile`, `signals`) → `graph` → `override-map` →
`intersections` → `neighbours` → `places` → `quality`.

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
uv run python scripts/run_etl.py places
uv run python scripts/run_etl.py quality
cd ..
```

Re-run the whole chain after changing the raw data, and from `intersections` on after editing a
curated input (`backend/data/overrides/`, `backend/data/curated/`). The backend
refuses to start without matching processed artifacts. What each step writes:
[backend README](backend/README.md#data-pipeline-offline-etl).

### Run with Docker Compose

```bash
docker compose up --build
```

Dashboard: <http://localhost:3000>. API and its interactive docs: <http://localhost:8000/docs>.
Compose sets the dashboard's backend transport; it never falls back to mock data. Source edits
reload both servers. `docker compose down` stops the stack; `--volumes` removes only the
dependency caches, never the GIS data in `backend/data/`.

### Run locally

```bash
cd backend
uv run uvicorn greenwave.main:app --reload    # http://127.0.0.1:8000/docs
```

```bash
cd frontend
npm run dev                                   # http://localhost:3000
```

Native `npm run dev` uses the offline mock transport (synthetic routes, no backend). To use the
backend, start it with
`NEXT_PUBLIC_SIMULATION_TRANSPORT=backend NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 npm run dev`.
Phone testing over the LAN: [frontend README](frontend/README.md).

### Deploy

Public HTTPS hosting on a free Oracle VM: [deployment guide](deploy/README.md).

## Documentation

- [GreenWave_ARCHITECTURE.md](GreenWave_ARCHITECTURE.md): system design and API.
- [docs/adr/](docs/adr/README.md): architecture decisions and their status.
- [backend/README.md](backend/README.md): ETL, simulation settings, simulated ITS feedback.
- [frontend/README.md](frontend/README.md) and
  [docs/engineering/frontend-dashboard.md](docs/engineering/frontend-dashboard.md): the dashboard and
  its workspace controls.
- [CONTRIBUTING.md](CONTRIBUTING.md): checks, branches, commits and contract changes.
- The in-app **Documentation** page (`/docs`): the Open Data App contest write-up in Polish and
  English (project, running it, technologies, data, architecture, future development).

## Data sources and attribution

- **OpenStreetMap:** road network and traffic signals © OpenStreetMap contributors, ODbL 1.0;
  extract via [BBBike](https://extract.bbbike.org).
- **Kraków open data (MSIP):** street registry *Ulice* (Urząd Miasta Krakowa / Miejski System
  Informacji Przestrzennej, stan danych 2026-10-13) and the bus-lane register *Buspasy* (Urząd
  Miasta Krakowa / Zarząd Dróg Miasta Krakowa / MSIP, stan danych 2026-10-13), re-used under the
  Polish Open Data Act (Dz.U. 2021 poz. 1641). The bus-lane register is a cross-check only.
- **Kraków address points, *Punkty adresowe (EMUiA)*:** Urząd Miasta Krakowa, Wydział Geodezji /
  MSIP ([dataset 1492](https://msip.krakow.pl/dataset/1492), stan danych 2026-10-27), under the MSIP
  terms and the Polish Open Data Act.
- **Małopolska PRM plan:** Wojewoda Małopolski, *Wojewódzki plan działania systemu PRM*,
  aktualizacja nr 2 (Kraków, 24 czerwca 2026 r.): team roster, operating areas and base addresses.
  Simulation input only; no live availability is implied.

All data is processed by ER-GreenWave. Full provenance and licences per file:
[`MANIFEST.json`](backend/data/raw/MANIFEST.json).

## Licence

[MIT](LICENSE) © 2026 Filip Jarmuła, Piotr Lorek.
