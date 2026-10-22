# Repository Audit 2026-10-22: Master Execution Plan

Single status record for the 2026-10-22 audit (frontend UX/UI and backend). It follows `2026-10-21-simulation-audit-master.md`, whose five items are complete and out of scope. Execute the milestones below **one at a time, in order**. Each one links a sub-plan with its own tasks, tests and acceptance checks. This file is also the design record: the findings and decisions below are the spec for every sub-plan.

## Status legend and update rule

- `[Pending]`: no product change has started.
- `[In Progress]`: the sub-plan is being implemented or verified.
- `[Completed]`: its acceptance criteria and required checks passed; evidence recorded below.

Move one checkbox at a time from `- [ ] [Pending]` → `- [ ] [In Progress]` → `- [x] [Completed]`, the last only after fresh verification. Under "Completion records", add the date, commands, results, files and any deviation. Keep earlier records. If blocked, leave the box open and record the blocker; never mark a partial fix complete. Local commits follow the `AGENTS.md` Git rule: stage explicit paths, `<category>: <message>` subject, no branch, push or PR operations.

## Baseline (2026-10-22, commit `5c9d376`)

- Backend gate: ruff, format and mypy clean; `pytest` **911 passed**. Frontend: lint and typecheck clean; `npm test` **38 files, 360 tests passed**.
- `backend/data/processed/` is complete (incl. `stations.parquet`), so the real backend starts: `cd backend && uv run uvicorn greenwave.main:app --port 8000`. Live check: rank + start (STN-A-0007 → 50.0614, 19.9366, 10×) streamed 249 ticks, 3 `ITS_DISPATCH`, 1 `SIMULATION_COMPLETED`.

## Decisions (human, 2026-10-22)

- **D1 Live-run flow.** Once the green corridor is initialized, the dashboard shows only the Live operations view: the Dispatch setup tab disappears (the header mode tabs are removed entirely, so Live operations cannot be opened without a run either). While the run is live, a **Stop** button is shown. Stopping ends the run and shows a stopped summary with a **Back to dispatch setup** action. Finished, failed and superseded runs end the same way: summary plus Back to dispatch setup.
- **D2 Server-side run failure.** If the simulation loop crashes, the backend sends a terminal event telling the client so, and the dashboard says: *"Simulation server error. Retry the green corridor initialization."* Implemented as an additive contract change: a new `CancelReason` value `SERVER_ERROR` on the existing `SIMULATION_CANCELLED` terminal (`schema_version` stays `"1.0"`, as in ADR 0006 and the Green Wave mode addition).
- **D3 Defaults chosen by the plan** (not raised by the human; change here if wrong): simulated vehicle ids are `AMB-KRA-01` / `FIRE-KRA-01` / `POL-KRA-01` in both transports. The backend retains at most 4 sessions (the active one plus the most recent terminal ones). The previous finished run is shown in setup until the next run finishes. The map re-fits after an endpoint change only when an endpoint is outside the current view.

## Findings → milestones

| ID | Sev | Finding | Milestone |
|---|---|---|---|
| B1 | High | Tick `intersections[].name` is always `null` (`simulation/telemetry.py:57`); start response has names; mock sends them. | M1 |
| B2 | Medium | `ambulance.id` is the simulation id (a UUID) (`telemetry.py:27`); mock sends `AMB-KRA-01` for every vehicle type. | M1 |
| F2 | High | No Stop control while running; the Dispatch setup tab silently stops the run (`dashboard.tsx:62`). | M2 |
| F13 | Low | Live operations can be opened with no run. | M2 |
| F1 | High | Run settings reset after every run (`DispatchForm.tsx:47-50` local state, unmounted in live mode). | M3 |
| F3 | High | Previous run result is lost on return to setup (`RESET`), so runs cannot be compared. | M3 |
| B5 | Low→D2 | A loop crash leaves no terminal event; clients see a 15 s timeout (`session.py:176`). | M4 |
| B3 | Medium | `SessionManager._sessions` is never pruned (`session.py:103`). | M5 |
| B4 | Low | Concurrent stop and superseding start can publish two `SIMULATION_CANCELLED` events. | M5 |
| F4 | Medium | Map instance destroyed and recreated on every setup ↔ live switch (tree position changes). | M6 |
| F6 | Medium | Every setup map click re-fits to `maxZoom 13.2` instantly, discarding the user's zoom. | M6 |
| F15 | Low | `fitBounds` unguarded against a zero-size container (`Invalid LngLat (NaN, NaN)`). | M6 |
| F5 | Medium | `crypto.randomUUID()` throws outside secure contexts (LAN HTTP on a phone). | M7 |
| F7 | Medium | ITS log highlights the 3rd row (`ItsConsole.tsx:45`), not the newest. | M8 |
| F8 | Medium | "Time saved" is emerald even when negative. | M8 |
| F9 | Medium | Address search: no feedback on error or zero matches; Enter without a highlighted suggestion does nothing. | M8 |
| F10 | Low | Header status dot always green. | M8 |
| F11 | Low | Ambulance icon / "Priority vehicle" copy for every vehicle type. | M8 |
| F12 | Low | Intersection list keeps passed intersections first; the next one scrolls away. | M8 |
| F14 | Low | Station-list load failure is console-only. | M8 |

Out of scope (known, unchanged): decorative 72 % speed bar; 320 px header truncation; CORS origin pairing (documented in `frontend/.env.example`).

## Ordered work

- [x] **[Completed] M1 — Backend telemetry identity (B1, B2).** [Sub-plan](2026-10-22-m1-telemetry-identity.md). Dependency: none. Suggested commit: `fix: stream intersection names and vehicle ids in ticks`.
- [ ] **[Pending] M2 — Live-run flow and Stop (D1; F2, F13).** [Sub-plan](2026-10-22-m2-live-run-flow.md). Dependency: none. Suggested commit: `feat: stop a live run from the live operations view`.
- [ ] **[Pending] M3 — Keep settings and previous result (F1, F3).** [Sub-plan](2026-10-22-m3-run-comparison-state.md). Dependency: M2 (back-to-setup path). Suggested commit: `fix: keep run settings and previous result across runs`.
- [ ] **[Pending] M4 — Server-error terminal (D2; B5).** [Sub-plan](2026-10-22-m4-server-error-terminal.md). Dependency: M2 (summary card). **Contract change; tell the human before editing `GreenWave_ARCHITECTURE.md`.** Suggested commit: `feat: report simulation server errors to the dashboard`.
- [ ] **[Pending] M5 — Session lifecycle hardening (B3, B4).** [Sub-plan](2026-10-22-m5-session-lifecycle.md). Dependency: M4 (same file, terminal semantics). Suggested commit: `fix: bound retained sessions and publish one terminal per run`.
- [ ] **[Pending] M6 — Map stability (F4, F6, F15).** [Sub-plan](2026-10-22-m6-map-stability.md). Dependency: M2, M3 (dashboard layout settled). Suggested commit: `fix: keep the map instance and user zoom across interactions`.
- [ ] **[Pending] M7 — Simulation ids outside secure contexts (F5).** [Sub-plan](2026-10-22-m7-simulation-id.md). Dependency: none. Suggested commit: `fix: generate simulation ids outside secure contexts`.
- [ ] **[Pending] M8 — HUD accuracy and feedback (F7–F12, F14).** [Sub-plan](2026-10-22-m8-hud-feedback.md). Dependency: M1 (vehicle ids), M2 (header). Suggested commit: `fix: make live HUD state and search feedback accurate`.

Order rationale: M1–M3 are what a jury sees first in backend mode; M4–M5 close the backend run lifecycle; M6–M7 remove demo-day failure modes; M8 is polish.

## Shared constraints (every sub-plan)

- Simulation only: no controller protocol, no live signal command. Keep simulated values visibly labelled; UI copy stays English.
- Pydantic schemas are canonical. Only M4 changes the contract; after it run `cd backend && uv run python scripts/export_openapi.py && cd ../frontend && npm run generate:types`, and never hand-edit `contracts/openapi.json` or `frontend/src/types/api.generated.ts`.
- No new dependency or lockfile change. HUD stays separate from `src/components/map/`. Light and dark themes and the 320 / 390 px layouts must keep working.
- TDD: write the failing test, observe RED, implement, observe GREEN. Snapshot updates are inspected by word diff, never accepted blind.
- Gates: backend `cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`; frontend (Node 22+) `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`. Then `git diff --check` and a focused diff review.
- Browser checks: `playwright-cli` through bash, output only under `.tmp/playwright/repo-audit/<milestone>/`. Use the real backend (it starts now) plus mock mode; stub with `page.route` only for failure cases that cannot be produced for real.
- Skills: `test-driven-development`, `systematic-debugging` when a test surprises you, `verification-before-completion` before marking complete, `playwright-cli` for browser steps; UI milestones (M2, M3, M8) add an `emil-design-eng` review and `mobile-native` for phone widths.
- Run `graphify update .` after M2 and M6 (structural changes).

## Completion records

(Add one section per milestone: `## M<n> verification — <date>`.)

## M1 verification — 2026-10-22

- Branch `fix/m1-telemetry-identity` (from `main` at `5c9d376`), uncommitted for human review.
- Root cause as planned: `telemetry.py` hard-coded `name=None` and used the simulation id as `ambulance.id`. Fix: `RouteIntersection.name` (filled from `IntersectionInfo` in `build_route_model`) is emitted per tick; `ambulance_telemetry` takes the vehicle type and maps it through `VEHICLE_IDS` (`AMB-KRA-01` / `FIRE-KRA-01` / `POL-KRA-01`). Frontend: `IntersectionCard` falls back to the start-response name; the mock uses `simulatedVehicleId` (`src/lib/vehicle-ids.ts`, new).
- TDD: 6 backend cases (3 vehicle-id params, telemetry names, route-model names, police-run engine ticks) and 3 frontend cases (start-response name fallback, FIRE_TRUCK / POLICE_CAR mock ids) observed failing, then passing. The existing "Unnamed intersection" snapshot case still passes unchanged.
- Golden: `GREENWAVE_REGEN_GOLDEN=1 uv run pytest tests/simulation/test_engine_golden.py`; word diff shows only 1,820 `null` → `INT-*` names and 455 `SIM-*` → `AMB-KRA-01` ambulance ids (5 scenarios × 91 ticks); `simulation_id` fields unchanged. Frontend `mock-stream.json` unchanged (golden scenarios are ambulances).
- Gates: backend `ruff check`, `ruff format --check`, `mypy`, `pytest` — **917 passed**. Frontend `lint`, `typecheck`, `format:check`, `test` (**38 files, 364 tests**), `build` — all exit 0. `git diff --check` clean; no change under `contracts/` or `frontend/src/types/`.
- Real backend (`uvicorn` on :8765): `FIRE_TRUCK` start from STN-A-0007 position to 50.0614, 19.9366 at 10× → 249 ticks, 5 route intersections, all 5 named; 0 tick/start name mismatches; vehicle ids `{FIRE-KRA-01}`. A first attempt from the ranked fire station had a signal-free route (0 intersections), so names were verified on the second route.
- Deviations: none in scope. The plan's optional `test_route_model` `None`-name case is covered at the telemetry level instead (the corridor fixture names every intersection).

## Final closeout

After M8: confirm eight `[Completed]` entries with evidence; run both full gates; run one real-backend browser pass covering rank → start → stop → back → change mode → start → finish → previous-run card at 1440 × 1000 and 390 × 844; check `git status --short`; report remaining limitations. New findings outside this scope go in a separate record.
