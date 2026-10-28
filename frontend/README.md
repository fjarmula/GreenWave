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
screenshot, script and trace under `.tmp/playwright/multiview/`; do not dump DOM or accessibility trees; it is gitignored and is never committed.
Confirm, in order:

1. Open `/simulation/green-wave` or `/simulation/standard`, select an incident and vehicle, wait for station ranking, then explicitly start.
2. Live telemetry: tick and vehicle state update from the backend SSE stream.
3. Stop mid-run using **Stop simulation**. Telemetry remains active until Stop succeeds. A failed Stop shows a retry action; success retains the terminal summary and last position. **Back to dispatch setup** keeps draft settings and the previous successful result.
4. Supersede: start a run in a second tab; the first tab's run ends as superseded
   (`SIMULATION_CANCELLED`, reason `SUPERSEDED`).

All routes, signal states, and dispatches remain simulated. Stop the stack with
`docker compose down`.

## Simulation workspace

| Route                    | Purpose                                                     |
| ------------------------ | ----------------------------------------------------------- |
| `/`                      | Mode menu and return to the current run                     |
| `/simulation/green-wave` | Priority corridor setup and simulation                      |
| `/simulation/standard`   | Standard-traffic setup and simulation                       |
| `/compare`               | Both modes live at once, then a result card                 |
| `/diagnostics`           | Architecture, observed adapter activity and dataset quality |
| `/driver`                | Map-first enabled run with a compact card and sheet         |

Client navigation keeps the same in-memory scenario and single run subscription. Switching modes
never starts or stops a run; replacing an active run requires an explicit action and successful Stop.
Reload returns to setup and never reconnects to an unknown server run. No scenario or telemetry is
stored in local storage.

**Focus Mode** hides or shows the details panel. On the map, **Follow vehicle** follows the running
vehicle and **Show route** returns to the route overview. All positions and signal states are
simulated. The canonical description of every workspace control is
[frontend-dashboard.md](../docs/engineering/frontend-dashboard.md).

Comparison opens with the same incident map, vehicle, station ranking, density, cascade and
playback-speed controls as the individual simulation views. **Start comparison** starts the Green
Wave and standard-traffic runs of that scenario together (`POST /api/v1/simulation/compare/start`,
ADR 0008); both advance on one simulated clock and stream live into two equal maps (one map with a
toggle on phones). The race bar shows both vehicles along the route and the measured distance lead
only, never a projected time; either mode may lead or arrive first. One **Stop** stops both runs.
When both have ended, the result card shows both actual travel times, their difference and the
signals given priority in the Green Wave run; **New comparison** returns to setup. There is no
replay. A run started elsewhere supersedes the pair and the card says so.

On phones the Green Wave, Standard and Driver views use a draggable bottom sheet: the collapsed
card stays on screen, a drag or the grabber reveals the details, Escape collapses it.

Diagnostics stores at most 200 allowlisted observations, coalescing repeated ticks. Browser durations
are not server latency; mock observations are synthetic. ITS dispatch is an internal simulated gateway
event. **View JSON** opens a frozen request/response or SSE snapshot with Copy. Backend captures
retain the original body text, including error responses; mock values are explicitly synthetic.
GET/Stop requests without a JSON body say so. Intersection cards expose the full validated received
tick containing that intersection. Formatting preserves number and string tokens; Copy preserves the
original body. Capture history stays only in memory: up to 200 observations, 2 MiB per body and 8 MiB
of retained payload text. Consecutive ticks retain the latest payload and sampled count. Oversized
bodies are explicitly omitted. **Clear observed history** or reload releases the captured history.
No headers, credentials, extra requests or real traffic-controller commands are added.

The driver view needs no geolocation. It shares this browser session's enabled run, including stale
feedback and recoverable Stop errors. Phone browser chrome, safe-area and keyboard behavior still
need confirmation on physical iOS/Android hardware; desktop device emulation cannot prove them.

## Phone testing over the LAN

Use a production build: `next dev` blocks other hosts unless `allowedDevOrigins` is configured. Run
`npm run build && npx next start -H 0.0.0.0` and open `http://<your-ip>:3000`. In backend mode,
build with `NEXT_PUBLIC_API_BASE_URL=http://<your-ip>:8000`, start uvicorn with `--host 0.0.0.0`,
and set `GREENWAVE_CORS_ORIGINS=http://<your-ip>:3000`.

## Mock smoke test

`npm run smoke:mock [base-url]` drives a mock-transport dashboard (default `http://localhost:3000`)
with `@playwright/cli`; outputs go to `../.tmp/playwright/`.
Known gap: only the first phase (`home-return.js`, home navigation at desktop and phone widths in
both themes) passes today. `mock-run.js` predates the incident picker and waits for a start button
that stays disabled until an incident is placed, so the run stops there until it is rewritten.

## Simulated ITS feedback

The dashboard shows the simulated ITS request status separately from reported traffic, with the
original JSON in diagnostics, and keeps the scenario selection across navigation. The protocol,
scenarios and timings are described once, in the
[backend README](../backend/README.md#simulated-its-feedback).
