# ER-GreenWave frontend

Next.js (App Router) dispatcher dashboard. See `../GreenWave_ARCHITECTURE.md` and `../AGENTS.md`.
Requires Node 22+ (`.nvmrc`).

## Commands (run from `frontend/`)

```bash
npm ci
npm run dev             # http://localhost:3000
npm run lint
npm run typecheck       # next typegen && tsc --noEmit
npm run format:check
npm test
npm run build
npm run generate:types  # regenerate src/types/api.generated.ts from ../contracts/openapi.json
```

`src/types/api.generated.ts` is generated from the backend's Pydantic models. Never edit it by hand.

## Backend-mode browser acceptance

Native `npm run dev` uses the offline mock transport by default. To check the dashboard against the
real API, run the Compose stack, which sets `NEXT_PUBLIC_SIMULATION_TRANSPORT=backend` and
`NEXT_PUBLIC_API_BASE_URL=http://localhost:8000` for the frontend service.

Prerequisite: the raw and processed GIS data are prepared per the root `README.md`
("Prepare the simulation dataset"). Without them the backend refuses to start; Compose never falls
back to mock data.

From the repository root:

```bash
docker compose up --build   # dashboard http://localhost:3000, API http://localhost:8000/docs
```

Drive the browser only with `@playwright/cli` through bash (never Playwright MCP). Keep every
snapshot, screenshot, and trace under `.tmp/playwright/`; it is gitignored and is never committed.
Confirm, in order:

1. Initialize a route: select origin and destination, start a dispatch, and see the route drawn.
2. Live telemetry: tick and vehicle state update from the backend SSE stream.
3. Stop mid-run: switch back to "Dispatch setup". The dashboard resets at once and closes its
   stream, then sends `POST /api/v1/simulation/{id}/stop` (200). The backend publishes
   `SIMULATION_CANCELLED` with reason `STOPPED` to any remaining subscriber, e.g.
   `curl -sN http://localhost:8000/api/v1/simulation/{id}/stream` opened before the stop.
4. Supersede: start a run in a second tab; the first tab's run ends as superseded
   (`SIMULATION_CANCELLED`, reason `SUPERSEDED`).

All routes, signal states, and dispatches remain simulated. Stop the stack with
`docker compose down`.
