# Post-fix paired driving-time experiment — 31 October 2026

## Results

The simulation completed all **3,000 paired comparisons / 6,000 simulations** across **200 incident addresses and 600 incident–station routes**. There were no failed runs, missing candidates or on-site cases.

| Measure | Result |
| --- | ---: |
| GreenWave faster | 2,670 / 3,000 (89%) |
| Tied | 330 / 3,000 (11%) |
| GreenWave slower | 0 / 3,000 (0%) |
| Mean driving-time saving | 71.94 s |
| Median driving-time saving | 62.58 s |
| Mean per-pair percentage saving | 15.01% |
| Median per-pair percentage saving | 15.68% |
| Mean Standard arrival time | 453.49 s |
| Mean GreenWave arrival time | 381.55 s |
| First GreenWave-ranked candidate: mean saving across densities | 37.02 s (11.66%) |

The pooled mean includes all three station candidates. The first-ranked candidate is the more relevant reference for the dispatch choice: more distant candidates can show larger savings while still arriving later.

## Mean saving by density and fixed station rank

All entries are seconds saved (Standard minus GreenWave); each cell contains 200 pairs.

| Density | Rank 1 | Rank 2 | Rank 3 |
| --- | ---: | ---: | ---: |
| 1.0 | 33.9 | 68.6 | 96.8 |
| 1.5 | 36.7 | 72.8 | 102.7 |
| 2.0 | 37.8 | 75.0 | 104.5 |
| 2.5 | 38.2 | 76.9 | 108.8 |
| 3.0 | 38.6 | 78.4 | 109.5 |

## Controlled intersection strata

Counts refer to unique signal-controlled intersection IDs on the driven route, not every physical road junction. Each route is repeated at five densities. Empty counts are explicit; an undefined mean is shown as an em dash.

| Controlled intersections | Pairs | Mean saving (s) | Faster | Tied | Slower |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 180 | 0.00 | 0 | 180 | 0 |
| 1 | 185 | 8.43 | 100 | 85 | 0 |
| 2 | 150 | 15.54 | 105 | 45 | 0 |
| 3 | 165 | 30.78 | 155 | 10 | 0 |
| 4 | 240 | 37.48 | 230 | 10 | 0 |
| 5 | 135 | 52.16 | 135 | 0 | 0 |
| 6 | 150 | 61.27 | 150 | 0 | 0 |
| 7 | 140 | 54.18 | 140 | 0 | 0 |
| 8 | 290 | 59.00 | 290 | 0 | 0 |
| 9 | 220 | 72.69 | 220 | 0 | 0 |
| 10 | 175 | 89.45 | 175 | 0 | 0 |
| 11 | 75 | 103.58 | 75 | 0 | 0 |
| 12 | 235 | 100.07 | 235 | 0 | 0 |
| 13 | 145 | 110.64 | 145 | 0 | 0 |
| 14 | 125 | 112.89 | 125 | 0 | 0 |
| 15 | 50 | 133.53 | 50 | 0 | 0 |
| 16 | 60 | 154.30 | 60 | 0 | 0 |
| 17 | 80 | 158.33 | 80 | 0 | 0 |
| 18 | 75 | 186.33 | 75 | 0 | 0 |
| 19 | 65 | 156.22 | 65 | 0 | 0 |
| 20 | 15 | 162.18 | 15 | 0 | 0 |
| 21 | 15 | 179.61 | 15 | 0 | 0 |
| 22 | 0 | — | 0 | 0 | 0 |
| 23 | 15 | 200.46 | 15 | 0 | 0 |
| 24 | 10 | 193.87 | 10 | 0 | 0 |
| 25 | 5 | 208.28 | 5 | 0 | 0 |

## Diagnostics and station selection

- Controlled intersection counts ranged from 0 to 25; no sampled route had exactly 22.
- All 330 ties had either no controlled intersections or exclusively green Standard signal decisions.
- No GreenWave safety-hold ticks or fallback intersections occurred in this nominal-feedback run. The slower-case export is empty; negative savings were retained by the harness rather than clamped.
- Within the three candidates, rank 1 was fastest for GreenWave in all 1,000 incident–density combinations. Standard selected rank 1 in 912 combinations, rank 2 in 65 and rank 3 in 23. The modes therefore selected different fastest candidates in 88 combinations (8.8%). These combinations repeat the same 200 incidents.
- Independent validation checked all 3,000 timing differences, 600 fixed route geometries across densities, once-per-intersection common slowdown budgets in both modes, Standard profile/engine agreement and all 648 marginal/joint summary rows.

## Method and interpretation

Ambulance dispatch, nominal simulated ITS feedback, cascade enabled and declared default simulation settings. The first 100 addresses came from `addresses.sample(n=100, seed=11)`; 100 distinct address labels were then taken in order from `addresses.sample(n=300, seed=29)`, excluding labels already selected. Top-three GreenWave-ranked stations were selected at density 1.5 with the default shortlist and kept fixed at densities 1.0, 1.5, 2.0, 2.5 and 3.0.

Both modes used identical incident/origin coordinates and road geometry. Both incurred the same configurable rolling slowdown (default 3 seconds) once per controlled intersection; Standard retained its additional cautious crossing at red, yellow or unsupported movements. The recorded driving times are actual fractional engine arrival times. Savings exclude final walking time and post-arrival signal recovery. Ties use a 0.000001-second tolerance. Percentage savings are calculated per pair against Standard, then aggregated; the mean percentage is not a ratio of group mean times.

These are **simulation model results, not measured real-world benefits**. The model does not simulate individual queues, queue discharge or network-wide congestion. Repeated density/station combinations are not independent incidents. Larger savings from a more distant station do not make it a better dispatch choice; absolute arrivals and the fastest available candidate matter. Other timing, feedback and model settings can produce negative savings even though none occurred in this run. Earlier pre-fix results describe a different model and are not post-fix evidence.

## Reproducibility record

The run started on 31 October 2026 from a clean checkout. Raw outputs remain local analysis material; this reviewed report is retained as project documentation in main and submission. No real controller integration was used.

| Item | Recorded value |
| --- | --- |
| Code revision | `e79afd52dd2a29cac88c4ef18e864dc0f66a68aa` |
| Created UTC | `2026-10-31T20:59:36.304714+00:00` |
| Wall time (seconds) | `832.076` |
| Python | `3.12.15` |
| Polars | `2.0.0` |
| Raw manifest SHA-256 | `091d5d5e8e97cd12f88a9f9be390aa5760560992f4699d4438c2d6a95d405528` |
| Runner SHA-256 | `c11392c1b628fe32dd900762167a4afb561a67745318325f425930222d3a808a` |
| uv.lock SHA-256 | `b85c9a400342bd28a29c3a33bfbab409f73df3e07c779d59d14fe398aeff9a61` |
| all-pairs.csv SHA-256 | `2cc7ebfb2fbe8e1e8904a672495c58a6f2c67098385e9cfe3160b28e3aec90a0` |
| grouped.csv SHA-256 | `535055f68d33aa7aabb07c4f2c20a26cc49b97ddfca222c791c7fa879a97fa88` |
| fastest-stations.csv SHA-256 | `3e22136d7ef47eb95a7ab6b1482311b261a1b0fba426e5f5ec8577a178ac50c7` |
| slower-cases.csv SHA-256 | `0435c4ebb63d1d4eae0daa8138722b0753b1be0139f72d6ab5a26d11a657d64b` |
| metadata.json SHA-256 | `8330cedaeaf1d647bfd6308280bc903ff18349f7587b9fe94e911c76fdf959d6` |
