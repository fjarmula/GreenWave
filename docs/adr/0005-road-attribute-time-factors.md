# 0005: Road-attribute time factors

- Status: Proposed
- Date: 2026-10-19
- Owners: @fjarmula @piotr-lorek
- Supersedes: None

## Context

Edge travel times used only length and speed. The pinned OSM extract also records bus lanes, lanes
per direction, surface, traffic calming and tram tracks, which a dispatcher would expect to matter:
an ambulance uses bus lanes and tram tracks to pass queues; normal traffic is slowed by
single-lane roads, unpaved surfaces and speed bumps. Using them makes the normal-vs-GreenWave
comparison more credible. Design: the internal development specification (omitted from this evaluation snapshot).
Values had to be chosen by a human (no invented modelling factors, `docs/engineering/data-pipeline.md`).

## Decision

The ETL derives per directed network edge `bus_lane`, `lanes_per_direction`, `surface_class`,
`calming_count` and `tram_track`. One edge-time function (`routing/edge_times.py`) drives route
choice, both estimates and simulated motion (time model in `GreenWave_ARCHITECTURE.md` §3).

Approved 2026-10-19 by the human; these values are estimates from reasoning, not measured Kraków
traffic data:

| Setting | Value | Reason |
|---|---:|---|
| `normal_single_lane_factor` | 1.15 | one lane per direction cannot pass stopped or turning vehicles |
| `normal_unpaved_factor` | 1.3 | unpaved roads are driven well below their speed |
| `normal_calming_seconds` | 3.0 | slowing to ~15-20 km/h and back costs a car ~2-4 s per feature |
| `ambulance_calming_seconds` | 2.0 | ambulances slow for the patient; cushions let them straddle |
| `ambulance_bus_lane_factor` | 1.05 | small gain without moving demo routes (see Validation) |
| `ambulance_tram_track_factor` | 1.05 | small gain; the match includes reserved track with kerbs/islands |
| `TRAM_TRACK_MATCH_METERS` | 6.0 | street-running track lies within about one lane of the road |
| `TRAM_TRACK_MIN_OVERLAP_SHARE` | 0.5 | short crossings and touching ends do not count |

- Boost rule: $b(e)$ is the **maximum** of applicable boosts (bus lane, tram track), not their
  product, applied before the 30/90 km/h clamp.
- Calming seconds are spread over the edge; the simulated ambulance moves at $L_e / t_a(e)$.
- Unknown or missing tags give no effect (null lanes / surface, `False` flags).
- Bus lanes come from `busway`, `bus:lanes`, `psv:lanes`, `lanes:bus`, `lanes:psv` and their
  direction suffixes. On a one-way road a side suffix (`:left`, `:right`, `:both`) applies to the
  travel direction (contraflow only for `opposite_lane`); on a two-way road right is the digitised
  direction and left the reverse. (The design listed `:left` as always reverse, which dropped
  with-flow left-side bus lanes such as those on Pawia.)
- Tram caveat: a tram on its own reserved track beside the road also matches the 6 m test. This is
  accepted (an ambulance can use it), which is one reason the tram boost stays small.
- The Kraków bus-lane register (`Buspasy_*.csv`) is a cross-check only
  (`bus_lane_crosscheck.csv`); it never changes an edge.

Non-goals: turn restrictions, lane-level routing, calming on ways or areas (only points count).

## Consequences

- Estimates and simulated runs change; time saved on the nine dashboard pairs rises by 8-38 s
  (1-5%), mostly from the normal-side single-lane and calming terms.
- Route choice minimises ambulance edge time including boosts and calming, so routes may change
  where attributes differ; with these values no dashboard route changes.
- All factors are runtime settings (`GREENWAVE_SIM_*`); 1.0 / 0 s restores attribute-free times.
  Tram thresholds are ETL configuration: changing them needs `intersections` then `neighbours`.
- `network_edges.parquet` gains five columns; a dataset built before this change fails at startup
  with a "rebuild with `run_etl.py intersections`" message.
- Coverage limits: lanes known on ~26% of directed km, surface unknown on ~22%; 166 of 1,598
  calming points lie off the network; 169 calming features tagged on ways/areas are ignored.

## Alternatives considered

- Product of boosts: rejected; bus lane and tram track on one edge are not independent gains.
- `ambulance_bus_lane_factor = 1.10`: rejected; it moved 3 of 9 dashboard routes onto longer routes
  with more signals (the planner weights exclude intersection delays), inflating time saved by up to
  ~70 s for reasons unrelated to bus lanes.
- Bus-lane CSV as geometry source: rejected; it has no geometry and 219 of 309 rows do not parse as
  `<street> od <from> do <to>`.
- Neutral (no effect): rejected; the attributes are in the data and make the comparison more credible.

## Validation

- `backend/scripts/road_attribute_evidence.py` on the snapshot: bus lane 19.9 km (347 directed
  edges), tram track 44.8 km, 1,432 calming points on edges; the `neutral` profile reproduced the
  pre-change estimates exactly (checked against the pre-change code); per-pair estimates for
  neutral, the approved values and bus-lane 1.00 / 1.05 / 1.10.
- Tests: `tests/routing/test_edge_times.py` (formulas, max boost, clamp order, approved defaults),
  `tests/simulation/test_engine.py::test_simulated_elapsed_matches_greenwave_estimate_with_calming`,
  `tests/etl/test_edge_enrichment.py`, `tests/etl/test_road_attributes.py`,
  `tests/dataset/test_loader.py::test_loader_rejects_edges_without_road_attribute_columns`.
