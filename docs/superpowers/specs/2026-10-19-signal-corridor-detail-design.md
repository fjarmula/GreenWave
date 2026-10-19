# Signal and corridor detail: design

Status: approved by the human on 2026-10-19 (design in chat). Plan:
`docs/superpowers/plans/2026-10-19-signal-corridor-detail.md`. Phase B; runs after road attributes
(A), before the data quality panel (C). Independent of A in code; ordered after it to avoid
concurrent ETL artifact changes.

## Intent

The ETL already knows a lot about each intersection (kind, member signals, approaches, review
flags) and has a table of signal-to-signal neighbours within the cascade distance
(`approach_neighbours.parquet`). The running system uses only the id, name, kind, position and one
delay value. The judge sees a list of names and dots. Showing what each intersection is, how many
signals it coordinates, and which intersections are pre-cleared together (the cascade) makes the
"green wave" visible. `approach_neighbours` is loaded and hashed but unused; using it as an
independent check of the cascade gives it a job without making it a second source of truth.

## Goals

1. One ETL delay key per intersection kind (`signalised_junction`, `midblock_signal`,
   `pedestrian_crossing`). All remain 35 s until the human approves new values.
2. `intersections.parquet` gains `signal_count` (Int64) and `needs_review` (Boolean).
3. The start response's `RouteIntersection` gains `signal_count: int (≥1)`,
   `approach_count: int (≥1)`, `needs_review: bool` and `cascade_targets: list[str]` (ids of
   intersections later on the route that this one pre-clears, in route order; empty when cascade is
   off or none). Additive; `schema_version` stays `"1.0"`.
4. The intersection list shows kind, signal count, and a "data needs review" marker; the map draws
   a line from each intersection to each of its cascade targets.
5. A cascade consistency check: every cascade pair the route model produces must have a matching
   candidate in `approach_neighbours` with `distance_m` ≤ the along-route distance. A mismatch is
   logged at WARNING with the pair; tests assert zero mismatches on fixtures.

## Non-goals

- `approach_neighbours` does not drive any runtime decision.
- No change to cascade rules (D16), the 250 m threshold, or the state machine.
- No per-approach or per-signal delays; `D_u` stays once per unique intersection.
- No new event types; tick telemetry unchanged.

## Anti-goals

- Changing a delay value without human approval.
- A frontend that breaks when talking to a backend that sends the new fields (both are updated in
  one plan; the mock adapter emits the same fields).
- Labelling review-flagged data as verified. The marker text: "Source data flagged for review".

## Definitions

- `signal_count`: distinct `signal_key` in `signal_approaches.parquet` with this
  `intersection_id`.
- `approach_count`: the existing `intersections.approaches` column.
- `needs_review`: true if any member signal has `signals.needs_review == true`, or any of its rows
  in `signal_approaches` has a non-null `issue`.
- Cascade pair check: for route pair (source S, target T) produced by `RouteModel`, take S's first
  stop-line edge and T's first stop-line edge on the route. A match is a row in
  `approach_neighbours` with `from_approach_edge_id` = S's edge and `to_approach_edge_id` = T's
  edge and `distance_m` ≤ along-route distance between those stop lines + 0.01 m. No match →
  mismatch.

## Delay keys

`etl/config.py`: keep `SIGNAL_DELAY_SECONDS` (signalised junction), add
`MIDBLOCK_SIGNAL_DELAY_SECONDS = 35.0`, and keep `PEDESTRIAN_CROSSING_DELAY_SECONDS`. The keys remain
independent even while their values are equal. At the 2026-10-19 human checkpoint, all three were
retained at 35 s as provisional modeling assumptions, not empirical measurements. Calibration is
outside this plan: it will occur in a dedicated modeling task after dynamic ambulance dispatch is
implemented and before final end-to-end performance evaluation. `GreenWave_ARCHITECTURE.md` §3
records this provenance and deferral.

## Constraints

- Contract change protocol: Pydantic first, then
  `cd backend && uv run python scripts/export_openapi.py && cd ../frontend && npm run generate:types`.
  `frontend/src/lib/transport/validate.ts` and its fixtures validate the new fields.
- Mock mode (`frontend/src/lib/mock-session.ts`, `mock-simulation-config.ts`) emits the new
  fields with plausible fixed values; the golden test is updated deliberately.
- Every simulated value stays labelled simulated.
- Re-run `intersections` then `neighbours` after the ETL change.

## Left to the builder

Visual styling of the list badge and cascade lines (follow existing tokens and
`docs/engineering/frontend-dashboard.md`), and where the consistency check is called, provided it
runs once per route at start, not per tick.
