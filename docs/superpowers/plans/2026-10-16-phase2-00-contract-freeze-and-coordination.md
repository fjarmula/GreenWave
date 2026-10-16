# Phase 2 · 00 — Contract Freeze, Ownership and Merge Protocol (shared, both people)

> **For agentic workers:** This document is the coordination layer for Phase 2. It is executed **together, on `main`, before either feature branch is created**. The two implementation plans (`2026-10-16-phase2-backend-simulation-engine.md` for Piotr, `2026-10-16-phase2-frontend-backend-integration.md` for Filip) both depend on it. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the backend ↔ frontend contract final and committed on `main` *before* parallel work starts, so the two branches touch disjoint files and merge without conflicts.

**Architecture:** Contract-first. Phase 0 lands the canonical Pydantic schemas, stub endpoints (HTTP 501) with final signatures, the regenerated `contracts/openapi.json` and `frontend/src/types/api.generated.ts`, and an ADR recording every decision below. After that, the backend branch implements behind the stubs and the frontend branch codes against the generated types. Neither branch edits the contract.

**Spec:** `GreenWave_ARCHITECTURE.md` §3, §4, §6 (authoritative); this document fills its gaps with explicit, approved decisions.

---

## 1. Where the project actually is (verified on `main` @ `43faa75`, 2026-10-16)

Stated plainly so nobody plans against an assumption:

| Area | What exists | What does **not** exist |
|---|---|---|
| Backend | Offline ETL (T1–T5), validated `ProcessedDataset` loader with hash/manifest/referential checks, `create_app()` lifespan loading it, `GET /api/v1/health` | Routing, origin/destination snapping, travel-time estimates, TTI, state machine, cascade, `ItsGateway`, session/1 Hz loop, SSE, `/simulation/*` endpoints, CORS |
| Schemas | `schemas/health.py` → `HealthResponse` only | Every Phase 1/2/3 payload from Architecture §4 |
| Frontend | Full dashboard, HUD/map split, `SimulationAdapter` seam, `MockSimulationAdapter`, reducer, 1 Hz mock stream, tests | Any network transport, runtime payload validation, error/reconnect states, real signal coordinates |
| Contract | `contracts/openapi.json` + `api.generated.ts` contain health only; CI `contract-drift` job enforces regeneration | — |

"Frontend and backend work individually" therefore means: **the frontend works against a mock; the backend works as a data loader**. Gluing them requires building the whole simulation engine. That is the critical path and it sits entirely on the backend side.

### Defects found in review that Phase 0 must resolve

1. **The frontend's temporary contract (`frontend/src/types/telemetry.ts`) disagrees with the architecture:** it has a fifth state `CLEARING_CASCADE` (architecture: four states + separate `is_cascade: bool`); `ambulance.status` is `string` (architecture: 4-value enum); the start response and tick lack `schema_version`, `is_simulated`, `simulation_id`; intersections lack `is_cascade`.
2. **Telemetry carries no intersection coordinates.** `SignalMarkers.tsx` places signals at fake evenly-spaced points on the route. The ETL already has real `lon`/`lat` per intersection (`intersection_ids.json`) — the contract must expose them.
3. **The stop endpoint needs `simulation_id`**, but the adapter's `stop()` takes no argument.
4. **The stream has no terminal event.** The architecture defines only `SIMULATION_TICK`, so the client cannot distinguish "arrived", "stopped" and "superseded by another start" from a dropped connection.
5. **No CORS** on the backend; frontend (`:3000`) and backend (`:8000`) are different origins.
6. **Cascade vs. `hold_duration_sec = 40`:** a cascaded intersection can enter `CLEARING` with TTI well above 40 s, so a fixed 40 s hold expires before the ambulance arrives. The architecture does not address this.
7. **Graphify artifact is a guaranteed merge conflict** (see §4).

---

## 2. Decision register (all confirmed and ticked; final values recorded; ADR 0003 mirrors them)

Every item below is something the architecture leaves open. "Recommendation" is the analyst's proposal; nothing is final until both of you tick it. Numbers marked **(new value)** are not in the architecture and need explicit approval (`.agents/INSTRUCTIONS_REFERENCE.md` §5.4 forbids inventing thresholds silently).

### Ownership
- [x] **D1 — Split.** Piotr owns the backend branch (he built the data pipeline; the engine consumes it). Filip owns the frontend branch (he built the dashboard and the adapter seam).
  - **Final:** Piotr = backend, Filip = frontend.

### Contract shape
- [x] **D2 — Stream event union.** SSE stream carries a discriminated union on `event_type`: `SIMULATION_TICK` (as architecture), `ITS_DISPATCH` (the Phase 3 payload, streamed so the ITS console shows real dispatches instead of synthesized log lines), `SIMULATION_COMPLETED`, `SIMULATION_CANCELLED` with `reason: STOPPED | SUPERSEDED`. Every event carries `schema_version: "1.0"`, `is_simulated: true`, `simulation_id`.
  - **Final:** Union of SIMULATION_TICK, ITS_DISPATCH, SIMULATION_COMPLETED, SIMULATION_CANCELLED (reason STOPPED | SUPERSEDED), discriminated on `event_type`; envelope `schema_version` "1.0", `is_simulated` true, `simulation_id`; plus `tick` and `timestamp` on every event (ADR extra).
- [x] **D3 — SSE framing.** `event:` line = the `event_type` value; `id:` line = the tick number (monotonic); `retry: 2000`. Stream closes after a terminal event. Payload = the JSON of one event model. This framing is not expressible in OpenAPI, so it is written into the ADR and §4 of the architecture.
  - **Final:** `event:` = event_type, `id:` = tick, first frame `retry: 2000`, stream closes after a terminal event. Recorded in ADR 0003 and architecture §4.
- [x] **D4 — Start response additions (additive to architecture).** Keep `intersections_on_route: string[]` exactly as documented, and add `route_intersections: RouteIntersection[]` ordered along the route, each `{id, name: string | null, kind, position {lat,lng}, distance_along_route_m}`; add `origin_snapped` and `destination_snapped` (position + `snap_distance_m`) so the UI can show where the route really starts. `name` is nullable because the ETL's `name` is nullable.
  - **Final:** As recommended: `intersections_on_route` kept, `route_intersections` and `origin_snapped` / `destination_snapped` added.
- [x] **D5 — Tick intersection list.** Every tick lists **all** route intersections, in route order. `tti_seconds` is an integer (rounded), and `null` once the intersection has been passed. `name` nullable (as D4).
  - **Final:** As recommended (all intersections, route order, `tti_seconds` int|null, `name` nullable).
- [x] **D6 — `is_active_corridor`** = state ∈ {`CLEARING`, `PRIORITY_GREEN`}.
  - **Final:** As recommended: state in {CLEARING, PRIORITY_GREEN}, computed by the backend.
- [x] **D7 — Errors.** One `ErrorResponse {schema_version, error_code, message}` model. Codes and HTTP status: `ORIGIN_OFF_NETWORK` 422, `DESTINATION_OFF_NETWORK` 422, `NO_ROUTE` 422, `SIMULATION_ID_IN_USE` 409, `SIMULATION_NOT_FOUND` 404. FastAPI's default 422 body stays for schema-validation failures (out-of-range multiplier etc.).
  - **Final:** As recommended: ORIGIN_OFF_NETWORK 422, DESTINATION_OFF_NETWORK 422, NO_ROUTE 422, SIMULATION_ID_IN_USE 409, SIMULATION_NOT_FOUND 404.
- [x] **D8 — `simulation_id`** is client-generated, must match `^[A-Za-z0-9_-]{1,64}$` (the frontend's `crypto.randomUUID()` passes).
  - **Final:** `^[A-Za-z0-9_-]{1,64}$`.
- [x] **D9 — Playback speed.** Optional `playback_speed: int` in the start request, `1..10`, default `1` **(new field)**. A real-time run is ~6+ minutes (architecture example: 380 s), which is long for a demo/jury. Wall-clock tick stays 1 Hz; each tick advances `playback_speed` simulated seconds, evaluated as 1 s sub-steps so no threshold (40/25/0/15 s) is ever skipped. Decide now — adding a field later costs a second contract round. If rejected, drop the field; nothing else changes.
  - **Final:** ACCEPTED, must-have. `playback_speed` int 1..10, default 1; 1 Hz wall clock, `playback_speed` simulated seconds per tick as 1 s sub-steps.
- [x] **D10 — Health (optional, low priority).** Extend `HealthResponse` with `dataset_manifest_sha256_prefix` and intersection count so the UI can show which dataset it is talking to. Skip if you want the minimum.
  - **Final:** Health endpoint UNCHANGED.

### Simulation semantics (backend implements, frontend displays)
- [x] **D11 — Routing weight.** Shortest path by ambulance travel time `L_e / V_ambulance(e)`. Both estimates (`T_normal`, `T_greenwave`) are computed on that **same** path so "time saved" compares like with like. (μ is uniform across edges so it never changes the path.)
  - **Final:** As recommended.
- [x] **D12 — Snapping.** Nearest graph node, in EPSG:2178, from which a route exists; reject with D7 codes if farther than **150 m (new value)**. Configurable.
  - **Final:** ACCEPTED: 150 m, configurable engine setting (`max_snap_distance_meters`), not a contract field. Architecture §6 decision 10.
- [x] **D13 — Kinematics.** Each simulated second the ambulance advances at `V_ambulance` of the edge it is on (carrying remainder across edge boundaries). It dwells `D_min = 3 s` at the first controlled stop line of each unique intersection (architecture's `D_min` made physical). Consequence: simulated arrival ≈ `T_greenwave`, so the KPI and the estimate agree. `v_avg` = EMA α 0.25, init `V_ambulance(first edge)`, floor 5 m/s (architecture §6.5).
  - **Final:** As recommended.
- [x] **D14 — Ambulance status.** `ARRIVED` at route end; `CROSSING_INTERSECTION` during a dwell; `APPROACHING_INTERSECTION` when the next unpassed intersection is `CLEARING` or `PRIORITY_GREEN`; otherwise `EN_ROUTE`.
  - **Final:** As recommended.
- [x] **D15 — KPI `current_time_saved_sec`** = (normal-mode time for the distance covered so far: edge normal times pro-rata + `D_u` for each passed intersection) − elapsed simulated seconds, rounded. It ends at `T_normal − T_greenwave` (±rounding).
  - **Final:** As recommended.
- [x] **D16 — Cascade transitivity.** The architecture text ("an upstream intersection j enters `CLEARING`") literally makes cascade **transitive**: a cascade-triggered `CLEARING` can cascade further. That can clear a long avenue at once. Choose: **(a) transitive** (literal reading; recommended for a corridor demo) or **(b) only TTI-triggered `CLEARING` cascades**. Cascade only looks **ahead** along the route. Disabled entirely when `enable_cascade_mode = false`.
  - **Final:** **(b) ONE-HOP ONLY.** Only an own-TTI `CLEARING` (`is_cascade=false`) can cascade; a cascade-triggered `CLEARING` never cascades further. Ahead only, inclusive 250 m, off when `enable_cascade_mode=false`. Architecture §4 rule 1 reworded.
- [x] **D17 — Hold duration vs cascade (defect 6).** Choose: **(a)** keep `hold_duration_sec = 40` fixed as documented (accept the gap; PoC); **(b)** `hold_duration_sec = max(40, ceil(TTI at dispatch))` (recommended — architecture edit). Either way the value is in config.
  - **Final:** **(b) EXTENDED HOLD, with buffer:** `hold_duration_sec = max(40, ceil(TTI at dispatch) + its_hold_buffer_seconds)`, `its_hold_buffer_seconds = 5` (engine config); a group uses its largest TTI. Architecture Phase 3 / §6 reworded.
- [x] **D18 — ITS batching.** One `ITS_DISPATCH` per tick containing every intersection that entered `CLEARING` in that tick (TTI-triggered plus its cascade group); `expected_arrival_utc` = emission time + smallest TTI in the group; `message_id` = `MSG-ITS-<n>` per simulation.
  - **Final:** As recommended.
- [x] **D19 — Lifecycle.** The run starts on `POST /start` (server-authoritative clock), ticks regardless of subscribers. Stream on connect sends the latest snapshot immediately, then live events; reconnect resumes at "now" (no replay). After `ARRIVED` the engine keeps ticking until every intersection is back to `NORMAL` (≤ 15 s), then emits `SIMULATION_COMPLETED`. A finished session stays readable until superseded, so a late subscriber still receives the terminal event. Unknown id → 404.
  - **Final:** As recommended.
- [x] **D20 — Timestamps.** `timestamp` = wall-clock UTC at emission. Simulated time = `kpi_metrics.total_time_elapsed_sec`.
  - **Final:** As recommended.

### Integration plumbing
- [x] **D21 — Cross-origin.** Backend: CORS allow-list from `GREENWAVE_CORS_ORIGINS` (default `http://localhost:3000`), never `*`. Frontend: `NEXT_PUBLIC_API_BASE_URL` (default `http://127.0.0.1:8000`). No Next.js rewrite proxy — proxies can buffer SSE.
  - **Final:** As recommended.
- [x] **D22 — Transport switch.** Frontend env `NEXT_PUBLIC_SIMULATION_TRANSPORT = mock | backend`, default `mock` until Phase 3 flips it. The mock is kept permanently as the offline demo fallback (a jury laptop without the raw-data bundle still runs the dashboard).
  - **Final:** As recommended.
- [x] **D23 — Frontend runtime validation.** No new dependency and no hand-written second schema: narrow type guards on the envelope (`schema_version`, `is_simulated`, `event_type`, `simulation_id`) and the fields the UI dereferences; unknown `event_type` is ignored and logged. (Alternative: generate zod from OpenAPI — new dependency, needs approval.)
  - **Final:** As recommended.

---

## 3. Phase 0 tasks (on `main`, Piotr drives, Filip reviews; target: one sitting)

### Task 0.1: ADR and architecture update
**Files:** Create `docs/adr/0003-simulation-contract-v1.md`; Modify `GreenWave_ARCHITECTURE.md` §4 and §6 (both owners approve — `AGENTS.md` requires telling the human before editing it).
- [ ] Record every ticked decision D2–D23 with its final value, the SSE framing (D3) and the rejected alternatives.
- [ ] Architecture §4: extend the existing JSON examples only with the fields D2/D4/D5/D9 add (do not rewrite them); add example payloads for `ITS_DISPATCH`, `SIMULATION_COMPLETED`, `SIMULATION_CANCELLED` and `ErrorResponse`; state explicitly that `CLEARING_CASCADE` is **not** a state.

### Task 0.2: Canonical schemas
**Files:** Create `backend/src/greenwave/schemas/simulation.py` (and `schemas/errors.py` if you prefer); Modify `backend/src/greenwave/schemas/__init__.py`; Test `backend/tests/schemas/test_simulation_schemas.py`.
- [ ] Models: `Position`, `RouteGeometry` (`type: Literal["LineString"]`, `[lng, lat]` pairs), `SimulationStartRequest` (multiplier `ge=1.0, le=3.0`; D8 pattern; D9 field), `SnappedEndpoint`, `RouteIntersection`, `SimulationStartResponse`, `IntersectionState` (4-value enum), `AmbulanceStatus` (4-value enum), `AmbulanceTelemetry`, `KpiMetrics`, `IntersectionTelemetry` (incl. `is_cascade`), `SimulationTickEvent`, `ItsDispatchPayload`, `ItsDispatchEvent`, `SimulationCompletedEvent`, `SimulationCancelledEvent`, `SimulationStreamEvent` (discriminated union on `event_type`), `ErrorResponse`, `StopResponse`.
- [ ] `schema_version: Literal["1.0"]`, `is_simulated: Literal[True]` on every response and event.
- [ ] Tests: architecture §4 JSON examples (with D4/D5 additions) validate; multiplier 0.99 and 3.01 rejected, 1.0 and 3.0 accepted; a fifth state string is rejected; `is_simulated: false` is rejected; the union dispatches on `event_type`.

### Task 0.3: Stub endpoints with final signatures
**Files:** Create `backend/src/greenwave/api/__init__.py`, `backend/src/greenwave/api/simulation.py` (an `APIRouter`); Modify `backend/src/greenwave/main.py` (include router — the **only** Phase 0 edit to `main.py`).
- [ ] `POST /api/v1/simulation/start` → `response_model=SimulationStartResponse`, documented `responses` for 409/422 `ErrorResponse`; body raises HTTP 501 for now.
- [ ] `GET /api/v1/simulation/{simulation_id}/stream` → `responses={200: {"content": {"text/event-stream": {"schema": <SimulationStreamEvent ref>}}}}` so every stream event model is registered in OpenAPI (required by `.agents/INSTRUCTIONS.md` §3); body 501.
- [ ] `POST /api/v1/simulation/{simulation_id}/stop` → `StopResponse`, 404 documented; body 501.
- [ ] Test: OpenAPI document contains the three paths and every model name from Task 0.2.

### Task 0.4: Regenerate, verify, commit, branch
- [ ] `cd backend && uv run python scripts/export_openapi.py && cd ../frontend && npm run generate:types`
- [ ] Inspect `api.generated.ts`: union, enums and literals came through as TS unions (not `string`). If they did not, fix the Pydantic side now — not on a branch.
- [ ] Full checks both sides (`AGENTS.md` "Checks"). Frontend still compiles because nothing imports the new types yet.
- [ ] `graphify update .` and commit `graphify-out/` **on main** in this commit.
- [ ] Commit to `main` (merge commit or direct push per your usual rule), tag `contract-v1`.
- [ ] Piotr: `git switch -c feature/simulation-engine contract-v1`. Filip: `git switch -c feature/frontend-integration contract-v1`. Each in their own worktree (`CONTRIBUTING.md`).

---

## 4. Ownership map — the actual conflict-prevention mechanism

A path is written by **exactly one** branch. If you need to change a path you do not own, stop and use §5.

| Path | `feature/simulation-engine` (Piotr) | `feature/frontend-integration` (Filip) | Nobody during Phase 2 (main only) |
|---|---|---|---|
| `backend/**` except `schemas/` | **writes** | read-only | |
| `backend/uv.lock`, `backend/pyproject.toml` | **writes** | | |
| `backend/src/greenwave/schemas/**` | | | **frozen** (§5) |
| `contracts/openapi.json` | | | **frozen**, generated |
| `frontend/**` except `api.generated.ts` | read-only | **writes** | |
| `frontend/package*.json` | | **writes** | |
| `frontend/src/types/api.generated.ts` | | | **frozen**, generated |
| `graphify-out/**` | regenerate locally, **never stage** | regenerate locally, **never stage** | regenerated on `main` after each merge |
| `GreenWave_ARCHITECTURE.md`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, `.agents/**`, `.agent/**`, `docs/adr/**`, `.github/**`, `.pre-commit-config.yaml`, `.mcp.json` | | | **Phase 0 / Phase 3 only** |
| `docs/superpowers/plans/**` | own plan file only (checkbox ticks) | own plan file only | |

Why each rule exists:
- **Graphify:** `graph.json` is one huge JSON line — any two regenerations conflict on the whole file. Also CI requires `built_at_commit` to be an ancestor of `HEAD`; a graph built on a branch commit that is later **squash**-merged points at a commit that is not on `main`, and CI fails. Agents must still run `graphify update .` locally for navigation (AGENTS.md) — just never `git add graphify-out`. Prefer **merge commits or rebase-merge, not squash**, for both PRs.
- **`frontend/AGENTS.md`** is rewritten by `next dev`; it is inside Filip's tree, so only he commits it.
- **Lockfiles** are per-side, so dependency additions never collide.
- **Root docs** are where both people naturally want to "just add a line" (README run instructions, MEMORY). Batch all of that into Phase 3.

Mechanical guard (each person, in their own worktree — local only, not committed): add a pre-push check or simply run before every push:
`git diff --name-only contract-v1...HEAD` and confirm every path is in your column.

## 5. Contract change protocol (if a branch discovers the contract is wrong)

1. Stop the affected task; continue other tasks.
2. Message the other person with the exact field change and why.
3. Piotr makes a tiny PR `contract/<change>` from `main`: schema + test + regenerated `openapi.json` + `api.generated.ts` + ADR amendment. Nothing else.
4. Merge to `main`, tag `contract-v1.x`. **Both** branches `git rebase` onto it (no merge of `main` into branches — keeps history linear and conflicts zero, because neither branch touched those files).
5. Additive changes only during Phase 2. A breaking change pauses both branches for a discussion.

## 6. Merge order and Phase 3 (together)

1. **Backend first.** `feature/simulation-engine` → `main`. Safe: the frontend still defaults to `mock` (D22), so `main` stays demo-able.
2. **Frontend second.** Filip rebases onto `main` (zero overlap by §4), CI green, merge.
3. **Phase 3 branch `integration/e2e`** (one person drives, the other reviews):
   - [ ] Both machines: same raw-data bundle, `build_manifest.py --check` passes, processed artifacts rebuilt.
   - [ ] Flip `NEXT_PUBLIC_SIMULATION_TRANSPORT` default to `backend`; add `frontend/.env.example` values to root `README.md` "Run locally".
   - [ ] Real-data run of all preset endpoint pairs (`frontend/src/components/map/dispatch-endpoints.ts`): each snaps within D12 and routes; replace any that do not.
   - [ ] Playwright CLI smoke (per AGENTS.md: `@playwright/cli`, outputs in `.tmp/playwright/`): start → ticks arrive → at least one `CLEARING` → `ARRIVED` → `SIMULATION_COMPLETED`; stop mid-run; second start supersedes the first tab.
   - [ ] Measure and record (do not invent budgets — record, then agree): backend startup time on real data, route planning time per request, tick loop duration (p50/max), SSE delivery latency.
   - [ ] Docs: `README.md`, `backend/README.md`, `frontend/src/types/README.md` (remove "temporary"), `.agents/FRONTEND_DASHBOARD.md` ("Preserve the mock boundary until a backend contract is approved" is now satisfied), `.agent/MEMORY.md`.
   - [ ] `graphify update .`, commit on the integration branch, merge (not squash).

## Review Focus (cross-cutting)

1. Two browser tabs start simulations: the first must show "superseded", not hang or error silently.
2. Backend restarted mid-run: frontend shows a reconnect state, then a clear "simulation not found" — never a frozen ambulance.
3. Origin or destination outside the OSM extract: a readable off-network error, not a 500.
4. Intersection exactly 250 m ahead along the route cascades; 250.01 m does not (inclusive threshold, architecture §6.9).
5. Everything on screen and on the wire remains labelled simulated (`is_simulated: true`, UI copy) — the safety boundary of the PoC.
