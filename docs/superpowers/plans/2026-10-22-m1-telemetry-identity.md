# M1 — Backend Telemetry Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development). Steps use checkbox (`- [ ]`) syntax. Master: `2026-10-22-repo-audit-master.md` (findings B1, B2; decision D3).

**Goal:** Ticks carry each intersection's real name and a stable simulated vehicle id, identically in backend and mock transports.

**Architecture:** The engine's `RouteIntersection` (`simulation/route_model.py`) gains `name`, filled from `IntersectionInfo` in `build_route_model`, which already reads the index. `intersection_telemetry` emits it. `ambulance_telemetry` takes the vehicle type and maps it to `AMB-KRA-01` / `FIRE-KRA-01` / `POL-KRA-01`. The wire schema is unchanged (`name: str | None`, `id: str`), so no OpenAPI or type regeneration is needed. The frontend falls back to the start-response name and makes the mock use the same id mapping.

**Tech stack:** Python, pytest, TypeScript, Vitest.

## Root cause

`simulation/telemetry.py:57` hard-codes `name=None`; the route model never stored names, while `to_start_response` reads them from the index directly. `telemetry.py:27` passes `simulation_id` as the vehicle id. The mock (`frontend/src/lib/mock-session.ts:282, :304`) sends names and a fixed `AMB-KRA-01`, so the transports diverge.

## File map

- `backend/src/greenwave/simulation/route_model.py`: `RouteIntersection.name: str | None = None` (last field, so positional test constructors keep working); set it in `build_route_model`.
- `backend/src/greenwave/simulation/telemetry.py`: emit `item.name`; `ambulance_telemetry(vehicle_type, state, speed, track)`; `VEHICLE_IDS` mapping.
- `backend/src/greenwave/simulation/engine.py`: pass `self.vehicle_type`.
- `backend/tests/simulation/test_telemetry.py`, `test_route_model.py`: new cases. `backend/tests/simulation/golden/engine_events.json`: regenerate.
- `frontend/src/components/hud/IntersectionList.tsx`: `name ?? routeDetail?.name ?? "Unnamed intersection"`.
- `frontend/src/lib/mock-session.ts`: vehicle id by type (a small exported `simulatedVehicleId(type)` in a shared frontend module, e.g. `src/lib/vehicle-ids.ts`).
- Frontend tests and snapshots: `IntersectionList.snapshot.test.tsx`, `mock-session.test.ts`, `lib/__snapshots__/mock-stream.json`.

## Tasks

### Task 1: Intersection names in ticks (backend)

- [ ] RED: in `test_route_model.py`, assert `build_route_model(...)` intersections carry the index name (and `None` where the index has none). In `test_telemetry.py`, assert `intersection_telemetry` returns those names. Run `cd backend && uv run pytest tests/simulation/test_route_model.py tests/simulation/test_telemetry.py -q`; observe failure.
- [ ] GREEN: add the field, fill it, emit it. Rerun.

### Task 2: Vehicle id by type (backend)

- [ ] RED: `test_telemetry.py` table test: `AMBULANCE → AMB-KRA-01`, `FIRE_TRUCK → FIRE-KRA-01`, `POLICE_CAR → POL-KRA-01`, and an engine-level assertion that a `POLICE_CAR` run's ticks never carry the simulation id.
- [ ] GREEN: implement; pass `vehicle_type` from `SimulationEngine.step`.
- [ ] Regenerate the golden: `GREENWAVE_REGEN_GOLDEN=1 uv run pytest tests/simulation/test_engine_golden.py`, then `git diff --word-diff backend/tests/simulation/golden/engine_events.json | grep -E '\[-|\{\+' | sort | uniq -c` and confirm only `name` and `ambulance.id` values changed. Rerun without the variable.
- [ ] Backend gate.

### Task 3: Frontend parity

- [ ] RED: `IntersectionList.snapshot.test.tsx` case with a tick name `null` and a start-response name: the card shows the start-response name. `mock-session.test.ts`: a `FIRE_TRUCK` mock run's ticks carry `FIRE-KRA-01`.
- [ ] GREEN: fallback in `IntersectionCard`; mock uses `simulatedVehicleId`. Update `mock-stream.json` with `npm test -- lib/mock-simulation-adapter.golden.test.ts -u` (put the filename before `-u`; see the 2026-10-21 master, item 1) and check that the diff only changes ids (the golden scenarios may all be ambulances, in which case it changes nothing).
- [ ] Frontend gate.

### Task 4: Real-backend check

- [ ] Start the backend, POST rank + start for a `FIRE_TRUCK`, read the first `SIMULATION_TICK` from the stream: every intersection whose start-response name is non-null has the same name in the tick; `ambulance.id == "FIRE-KRA-01"`. Record the command and output in the master.

## Acceptance

- Backend-mode intersection cards show real names; ids are vehicle-like in both transports.
- No schema, OpenAPI or generated-type diff (`git diff --stat contracts frontend/src/types` empty).
- Both gates green; golden diffs limited to the two fields.
