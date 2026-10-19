# Road attributes in travel times: design

Status: approved by the human on 2026-10-19 (design in chat). Plan:
`docs/superpowers/plans/2026-10-19-road-attributes.md`. Phase order: this (A) → signal and corridor
detail (B) → data quality panel (C).

## Intent

Today every road edge is a length and a speed. The OSM extract already in `data/raw/` also says
which roads have bus lanes, how many lanes they have, where speed bumps are, which roads are
unpaved, and where trams run. A dispatcher knows these matter: an ambulance uses bus lanes and tram
tracks to pass queues, while normal traffic is slowed by single-lane roads and speed bumps. Using
them makes the normal-vs-GreenWave comparison more credible for the contest demo (entries due
2026-11-05).

The Kraków bus-lane CSV (`Buspasy_*.csv`, parked so far) has no geometry but names each lane's
street and extent in `Opis`. It becomes a cross-check of OSM bus-lane coverage, not a geometry
source.

## Goals

1. ETL derives five per-directed-edge attributes and writes them to `network_edges.parquet`.
2. One shared edge-time function drives route choice, both estimates and simulated motion, so the
   estimate and the simulated run stay consistent.
3. All new modelling factors are runtime settings with neutral defaults; with defaults, routes,
   estimates and simulated runs are unchanged from today.
4. A human approval checkpoint sets the real factor values, then the architecture doc and an ADR
   record them.
5. The bus-lane CSV is matched to street names and reported against OSM bus-lane edges.

## Non-goals

- No turn restrictions, lane-level routing, or traffic-calming geometry beyond counts.
- No use of the KMK lines CSV (no streets or geometry; stays parked).
- No change to the intersection state machine, cascade, or ITS dispatch.
- No new frontend UI in this phase (phase C shows the reports).

## Anti-goals

- Inventing factor values. Every new factor ships neutral; non-neutral values exist only after the
  human approves them (`docs/engineering/data-pipeline.md`, `etl/config.py` provenance policy).
- Estimate and simulated motion disagreeing because one path applies a factor the other does not.
- Silently treating missing tags as "has property": unknown stays unknown and gets no effect.

## Attributes (ETL, per directed edge)

| Column | Type | Rule |
|---|---|---|
| `bus_lane` | bool | Way tags `busway`, `bus:lanes`, `lanes:bus`, `lanes:psv` (and their `:forward`/`:backward`/`:left`/`:right` variants). A suffixed tag applies only to that direction (`forward`/`right` = digitised direction, `backward`/`left` = reverse); an unsuffixed tag applies to both. `bus:lanes` / `lanes:psv` count only if at least one lane value is `designated` (or `lanes:psv` > 0). `busway` counts for any value except `no`. |
| `lanes_per_direction` | Int64, nullable | `lanes:forward` / `lanes:backward` when tagged; else one-way edges take `lanes`; two-way edges take `max(1, lanes // 2)`; null when no `lanes` tag. |
| `surface_class` | String, nullable | `paved` / `unpaved` / null, from the `surface` tag via a fixed mapping in `etl/config.py` (`UNPAVED_SURFACE_VALUES`); unknown values → null and counted in the report. |
| `calming_count` | Int64 | Number of OSM points tagged `traffic_calming` (any value except `no`) that lie on a vertex of this edge's geometry (≤ 0.5 m). Computed after signal splitting, so split pieces count only their own points. |
| `tram_track` | bool | True when at least `TRAM_TRACK_MIN_OVERLAP_SHARE` of the edge length lies within `TRAM_TRACK_MATCH_METERS` of an OSM `railway=tram` line. Placeholder thresholds in `etl/config.py`. |

Tram thresholds (placeholder, part of the approval checkpoint): `TRAM_TRACK_MATCH_METERS = 6.0`,
`TRAM_TRACK_MIN_OVERLAP_SHARE = 0.5`. A tram on its own reserved track beside the road also
matches; that is accepted (the ambulance can use it) and stated in the ADR.

Way-level attributes (`bus_lane`, `lanes_per_direction`, `surface_class`) are set when the graph
is built (`etl/graph.py`), so `road_edges.parquet` and `network_edges.parquet` both carry them and
split pieces inherit them. Geometry-level attributes (`calming_count`, `tram_track`) are computed on
the final network graph in the `intersections` step, after signal splitting, so they appear only in
`network_edges.parquet`.

The `intersections` step writes a top-level `road_attributes` section to the ETL report: edge counts and km per attribute value, unknown
surface values (sample), calming points not on any edge, and the two tram thresholds used.

## Bus-lane CSV cross-check

- Parse `Opis` with the pattern `<street> od <from> do <to>` (prefix `ul.`, `al.`, `Al.`,
  `Aleje` handled by the existing `etl/street_names.py` normalisation). Rows that do not parse are
  reported as `unparsed`.
- Match the normalised street to OSM edge `name` (normalised the same way) and to `Ulice` names.
- Per CSV row write: `objectid`, `kategoria`, `organizacja`, `street`, `from`, `to`, `csv_length_m`,
  `street_in_ulice`, `osm_edges_on_street`, `osm_bus_lane_km_on_street`, `status`
  (`osm_has_bus_lane` | `osm_street_without_bus_lane` | `street_not_found` | `unparsed`).
- Output: `data/processed/bus_lane_crosscheck.csv` plus counts in the `road_attributes` report
  section. Analysis only: it never changes an edge attribute.
- `MANIFEST.json` note for the Buspasy entry changes from "parked" to "cross-check only". This makes
  processed artifacts stale; re-run `intersections` then `neighbours` (backend README).

## Time model

Notation as in `GreenWave_ARCHITECTURE.md` §3. New settings (`GREENWAVE_SIM_` prefix, in
`SimulationSettings`), all neutral by default:

| Setting | Default | Bound | Meaning |
|---|---|---|---|
| `normal_single_lane_factor` | 1.0 | ≥ 1.0 | Normal-time multiplier when `lanes_per_direction == 1` |
| `normal_unpaved_factor` | 1.0 | ≥ 1.0 | Normal-time multiplier when `surface_class == "unpaved"` |
| `normal_calming_seconds` | 0.0 | ≥ 0 | Seconds added per calming feature, normal traffic |
| `ambulance_calming_seconds` | 0.0 | ≥ 0 | Seconds added per calming feature, ambulance |
| `ambulance_bus_lane_factor` | 1.0 | ≥ 1.0 | Ambulance speed multiplier on `bus_lane` edges |
| `ambulance_tram_track_factor` | 1.0 | ≥ 1.0 | Ambulance speed multiplier on `tram_track` edges |

Normal edge time:
`t_n(e) = L_e · μ · f_lane(e) · f_surface(e) / V_e + n_e · normal_calming_seconds`

Ambulance edge time:
`V_amb(e) = min(max(1.3 · V_e · b(e), 30), 90)` km/h, `b(e) = max` of the applicable boost
factors (not the product; 1.0 when none), and
`t_a(e) = L_e / V_amb(e) + n_e · ambulance_calming_seconds`.

Calming seconds are spread over the edge: the simulated ambulance moves at the effective speed
`L_e / t_a(e)` on that edge, so motion code keeps one speed per edge. The EMA, TTI and state
machine are unchanged and consume that speed. Intersection delays (`D_u`, `D_min`) are unchanged.

Route choice keeps minimising ambulance time, now `t_a(e)`. With non-neutral boosts routes may
change; that is intended.

## Approval checkpoint

The plan has an explicit stop after the code is merged with neutral defaults: the human picks
values (the plan supplies an evidence table: km and edge counts per attribute on the real data,
and demo-route time deltas for candidate values). Approved values become the setting defaults
with an `APPROVED <date>` comment; then `GreenWave_ARCHITECTURE.md` §3 and §6 item 6 and a new ADR
`docs/adr/0005-road-attribute-time-factors.md` are updated. Edit of the architecture doc is
announced to the human (AGENTS.md).

## Constraints

- All distance work in `EPSG:2178` metres. Raw inputs read-only. ETL deterministic.
- `GreenWave_ARCHITECTURE.md` and `AGENTS.md` edits: tell the human first.
- No contract change in this phase (estimates already exist in the start response).
- Tests use tiny synthetic fixtures only (`backend/tests/support/`); the real-data run is manual.
- Changing ETL outputs is intended; the ETL equivalence harness is not used as a gate here.

## Left to the builder

Internal module split inside the ETL, helper names beyond the interfaces in the plan, report field
names beyond those listed, and how the tram overlap is computed (buffer intersection or sampled
points), provided it is deterministic and in metres.
