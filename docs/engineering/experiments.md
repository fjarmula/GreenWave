# Reproducible paired experiment (main only)

Run from a prepared checkout with Python/uv and the built Kraków dataset. Use the existing backend README data preparation instructions first. The runner requires at least the original 100-address sample and 100 distinct additions from its 300-address second pool; it fails rather than silently sampling a different design. Pin `backend/uv.lock`, the code revision and dataset hashes for repeatability. No backend server or frontend is required.

From the repository root, smoke mode runs two incidents × three fixed candidates × two densities (at most 12 pairs / 24 actual simulations):

```bash
cd backend
uv run python -m experiments.grid --smoke --output ../.tmp/experiments/shared-slowdown-smoke
```

Full run (leave this for the maintainer after reviewing the correction):

```bash
cd backend
uv run python -m experiments.grid --output ../.tmp/experiments/shared-slowdown-full
```

Each output directory must be new. Use a different directory for a repeat; existing results are never overwritten. The default per-engine arrival limit is 36,000 simulated seconds (`--max-seconds` overrides it). Interrupted runs retain flushed pair rows and a partial report, with metadata marked interrupted. There is no automatic resume or parallel execution. A completed run with engine/ranking failures exits nonzero; inspect status/error columns. Missing candidates and on-site candidates are explicit records, not engine failures. Dataset load/sampling failures raise before the experiment begins.

## Design

- Ambulance, NOMINAL simulated ITS feedback, cascade enabled, declared default SimulationSettings. Environment simulation overrides are ignored to preserve the default-settings design; effective settings are saved. Dataset paths still follow DatasetSettings.
- First 100 incidents from `addresses.sample(n=100, seed=11)`, followed by 100 distinct labels in order from `addresses.sample(n=300, seed=29)`, excluding previous labels. This exactly preserves the previous script's label-based exclusion.
- Rank at density 1.5 using the existing default shortlist and the top three GreenWave-ranked candidates. Keep these station choices fixed across densities 1.0, 1.5, 2.0, 2.5 and 3.0. Record missing ranks and on-site cases for every density.
- Simulate both modes with the same incident, station origin, road geometry and settings. The runner checks paired edge IDs and polylines. Route selection is independent of mode/density. Each pair records actual fractional `arrived_at_s`, and checks Standard against the exact dry-run profile.
- Driving saving = Standard arrival − GreenWave arrival. No walking time or post-arrival recovery is counted, and negative savings remain. The runner closes the engine at arrival rather than waiting for recovery. It does not change controller behavior before arrival.
- Ties use a 1e-6 second tolerance. Savings percentages are per-pair saving / Standard × 100; grouped mean/median percentages aggregate these per-pair values, not ratios of group totals.

## Outputs and return files

Return **all seven files** (or zip the output directory):

- `all-pairs.csv`: every attempted incident/station/density pair, status/error, coordinates, rank, controlled intersection and stop-line counts, distance, walking time separately, both absolute driving times, signed saving and percentage. Embedded JSON diagnostics for both modes retain geometry/controlled IDs, exact signal decisions, waits, priority request outcomes, fallback IDs, hold-related ticks, common slowdown starts and consumed seconds, plus other extra driving time.
- `grouped.csv`: overall and all seven nonempty marginal/joint combinations of station rank, density and unique controlled intersection count. Every count from zero through the observed maximum is emitted, even for empty combinations. Counts, means, medians, percentage statistics and faster/tied/slower counts are explicit; empty statistics are blank, not zero. Failed, missing-candidate and on-site rows are counted separately and excluded from driving-benefit statistics.
- `fastest-stations.csv`: independently fastest station(s), rank(s) and absolute driving time for each mode among the three candidates at each incident/density. All tied winners are retained. A successful mode is retained even if its partner fails; availability and completeness are reported separately per mode. On-site candidates count as zero driving time; incomplete candidate sets are flagged. This is not a city-wide optimal-station search.
- `slower-cases.csv`: complete slower-pair rows including both modes' diagnostics.
- `metadata.json`: code revision, dirty status, runner hash, raw manifest hash, processed-file hashes, lockfile hash, Python/Polars versions, seeds, sampled incidents, effective settings, arguments, timestamps and run status. A dirty run is identified explicitly; use a clean committed checkout for publishable experiments.
- `summary.json` and `REPORT.md`: machine-readable totals and readable report.

Common slowdown consumption is computed from the actual motion budget, including partial ticks. `other_extra_seconds` includes cautious delay, travel at the ordinary crossing limit and priority holds; it is not an isolated red-loss estimate. Hold-related ticks can include partial movement and are not exact stationary seconds. The diagnostic record distinguishes controlled intersection IDs from physical road junctions.

These are model results, **not measured real-world benefits**. Repeated station/density combinations are not independent incidents. A more distant station can save more time without being a better dispatch choice; compare absolute arrival times and the independently fastest candidates. The earlier 3,000-pair pre-fix experiment describes the old model and is neither a post-fix result nor a numerical acceptance target. Do not add new measured-performance claims or average savings to README until the maintainer supplies and reviews the full results.

`backend/experiments`, its tests, and this document are main-only and listed in the future submission removal manifest. `.tmp` results are ignored and not required by the maintained harness.
