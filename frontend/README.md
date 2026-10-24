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

**Details** opens the bounded inspector. **Enter Focus** hides controls; **Exit Focus** or Escape
restores them and returns keyboard focus. The map is preserved within a mounted workspace.
Zoom above 16.5 to follow the vehicle; a deliberate pan suspends follow. **Resume following**
restores it, and **Show route** returns to overview. All positions and signal states are simulated.

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
