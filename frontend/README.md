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
| `/compare`               | Sequential recording, then synchronized replay              |
| `/diagnostics`           | Architecture, observed adapter activity and dataset quality |
| `/driver`                | Phone presentation of the enabled simulation                |

Client navigation keeps the same in-memory scenario and single run subscription. Switching modes
never starts or stops a run; replacing an active run requires an explicit action and successful Stop.
Reload returns to setup and never reconnects to an unknown server run. No scenario or telemetry is
stored in local storage.

**Details** opens the bounded inspector. **Enter Focus** hides controls; **Exit Focus** or Escape
restores them and returns keyboard focus. The map is preserved within a mounted workspace.
Zoom above 16.5 to follow the vehicle; a deliberate pan suspends follow. **Resume following**
restores it, and **Show route** returns to overview. All positions and signal states are simulated.

Comparison opens with the same incident map, vehicle, station ranking, density and cascade controls
as the individual simulation views. **Start comparison** freezes that scenario, records enabled then
disabled at 10×, and automatically starts both maps together at the selected replay speed when
both recordings cover every tick through successful completion. It never runs two backend sessions
concurrently. Limits are 10,000 ticks per mode and 32 MiB serialized pair data, held only in memory.
Missing ticks, cancellation, mismatched routes and limits yield an incomplete result. Replay uses a
common simulated clock with shared pause, restart, speed and seek controls. Desktop opens with two
equal maps and a closed results inspector; phone pane switching keeps the cursor. **Change scenario**
returns to the retained dispatch settings, and hidden tabs pause clock advancement.
Reported travel time, first observed arrival tick and recovery-completion tick are distinct values.

Diagnostics stores at most 200 allowlisted observations, coalescing repeated ticks. Browser durations
are not server latency; mock observations are synthetic. ITS dispatch is an internal simulated gateway
event. Addresses, coordinates, response bodies, full URLs and raw errors are excluded.

The driver view needs no geolocation. It shares this browser session's enabled run, including stale
feedback and recoverable Stop errors. Phone browser chrome, safe-area and keyboard behavior still
need confirmation on physical iOS/Android hardware; desktop device emulation cannot prove them.
