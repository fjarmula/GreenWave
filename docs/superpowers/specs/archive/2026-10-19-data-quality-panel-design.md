# Data quality panel: design

Status: approved by the human on 2026-10-19 (design in chat). Plan:
`docs/superpowers/plans/2026-10-19-data-quality-panel.md`. Phase C; runs after road attributes (A)
and signal and corridor detail (B), whose reports it shows.

## Intent

The ETL writes several diagnostics nobody sees in the app: near misses, the OSM-vs-Ulice street
length comparison, route sanity checks, unsnapped signals, review-flagged signals and (after A) the
bus-lane cross-check. A judge asking "how do you know the data is right?" should get an answer on
screen: what was checked, what passed, what is known to be imperfect.

## Goals

1. New ETL step `quality` (runs after `neighbours`) reads existing processed outputs and writes
   `data/processed/data_quality.json`, a small summary (no raw rows beyond short samples).
2. The server loads and validates it at startup like the other artifacts (required file, sha256
   recorded in `etl_report.json` under a `quality` section, stale/missing → startup error naming
   `uv run python scripts/run_etl.py quality`).
3. `GET /api/v1/dataset/quality` returns it as a Pydantic `DatasetQualityResponse`
   (`schema_version: "1.0"`, `is_simulated: true`). Registered in OpenAPI; frontend types generated.
4. A collapsed-by-default "Data quality" panel in the dashboard HUD shows each check's title,
   status and headline numbers, plus source attribution and the MSIP export timestamp.

## Summary content

Each check: `id`, `title`, `status` (`pass` | `info` | `warn`), `headline` (one sentence),
`metrics` (name → number), `samples` (≤ 5 short strings). Checks:

| id | Source | status rule |
|---|---|---|
| `near_misses` | `near_misses.csv`, `near_misses_tertiary_plus.csv` | `warn` if tertiary-plus rows > 0, else `info` |
| `street_lengths` | `street_length_comparison.csv` | `info`; metrics: streets compared, share within `STREET_LENGTH_RATIO_RANGE` |
| `route_sanity` | `route_sanity_checks.geojson` | `pass` if all routes within `ROUTE_DETOUR_RATIO_RANGE`, else `warn` |
| `signal_snapping` | `etl_report.json` intersections.snapping | `info`; attached count, unsnapped count |
| `signals_needing_review` | `intersections.parquet` `needs_review` (from B) | `info` if 0, else `warn` |
| `bus_lane_crosscheck` | `bus_lane_crosscheck.csv` (from A) | `info`; counts per status |
| `road_attributes` | `etl_report.json` road_attributes (from A) | `info`; km with bus lane / tram track, calming points |

Status rules are reporting labels, not modelling thresholds; they reuse existing analysis values
only. Plus `sources`: the manifest entries' `source`, `licence`, `attribution`, `retrieved_on`; and
`manifest_sha256` and `msip_export_timestamp` (see Constraints).

## Non-goals

- No raw-data browsing, maps of individual issues, or download links.
- No live recomputation; the server serves the file it loaded.
- No new thresholds.

## Anti-goals

- Claiming the data is verified. Panel footer: "Checks describe the source data used by the
  simulation. They do not verify physical signal states."
- Failing the whole dashboard when the endpoint fails: the panel shows an error line; the rest
  works. In mock mode the panel says "Available when connected to the simulation backend."

## Constraints

- File stays small (target < 50 KB); samples capped at 5 per check.
- Deterministic output (my call, replaces a wall-clock `generated_at`): the file carries
  `manifest_sha256`, each source's `retrieved_on`, and the MSIP export timestamp read from
  `krakow/__Aktualnosc__.txt`. Same inputs → byte-identical file, so the ETL equivalence harness
  needs no new allowance.
- Backend README ETL list gains the `quality` step; dataset constants map the file to it.

## Left to the builder

Panel layout and copy beyond the fixed strings above, metric names, and whether checks render as a
list or a table.
