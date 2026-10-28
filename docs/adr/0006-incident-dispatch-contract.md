# 0006: Incident dispatch contract

- Status: Accepted (pending human review)
- Date: 2026-10-20
- Owners: @fjarmula @Piotrek406
- Supersedes: None (amends ADR 0003 additively)
- Amended (2026-10-28): candidates rank by the request's `time_mode` totals (ADR 0014); `station_at_incident` is removed from `DispatchRankResponse`; ambulance origins are PRM bases (`prm_base`), and the `ambulance_base` / `hospital_ed` station kinds are gone.

## Context

The dashboard used to start a run between two hardcoded endpoints. Dispatch now starts from the
incident: the operator picks a vehicle type and an incident location, and the backend ranks that
type's stations by the green-wave estimate the run will show. That needs a station list, local
address search and a ranking call, and the simulated ITS payload must stop calling every vehicle an
ambulance. Design: `docs/superpowers/specs/archive/2026-10-19-incident-dispatch-design.md`.

## Decision

Additive to contract v1; `schema_version` stays `"1.0"`. Pydantic models in
`backend/src/greenwave/schemas/` remain canonical.

- `VehicleType` enum: `AMBULANCE`, `FIRE_TRUCK`, `POLICE_CAR`. It lives in
  `schemas/simulation.py` (the start request and ITS payload use it) and is re-exported with the
  dispatch models.
- `SimulationStartRequest.vehicle_type: VehicleType = AMBULANCE`. Optional, so clients from before
  this change still start ambulance runs. Unknown values are rejected (422).
- `ItsDispatchPayload.vehicle_type` widens from `Literal["AMBULANCE"]` to `VehicleType` and carries
  the request's value.
- New error code `NO_STATION_REACHABLE`.
- New endpoints with models in `schemas/dispatch.py`: `GET /api/v1/stations` (`StationsResponse`),
  `GET /api/v1/geocode` (`GeocodeResponse`), `POST /api/v1/dispatch/rank`
  (`DispatchRankRequest` → `DispatchRankResponse`, 1–3 candidates, best first, plus
  `station_at_incident`).
- Non-goal: the `ambulance` telemetry field keeps its name; no contract-wide rename.

## Consequences

- Older clients keep working: the start request field is optional and the new endpoints are
  additive.
- Consumers that matched `vehicle_type == "AMBULANCE"` literally must accept the three values.
- The generated OpenAPI marks defaulted fields as required in the TypeScript types, so the frontend
  always sends `vehicle_type`.
- Simulation only: no endpoint actuates a signal or calls an external service.

## Alternatives considered

- Bumping `schema_version` to `2.0`: rejected; every change is additive.
- Renaming `ambulance` to `vehicle` in telemetry: rejected as a contract-wide rename with no
  behavioural gain (spec non-goal).
- Keeping the ITS literal and adding a separate field: rejected; the payload would contradict itself.

## Validation

- `backend/tests/schemas/test_dispatch_schemas.py`: default and rejection of `vehicle_type`,
  candidate bounds, station id pattern.
- `backend/tests/simulation/test_dispatch.py::test_its_payload_carries_vehicle_type`.
- CI OpenAPI drift check (`contracts/openapi.json`, `frontend/src/types/api.generated.ts`).
