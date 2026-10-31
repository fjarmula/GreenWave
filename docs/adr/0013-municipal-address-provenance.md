# 0013: Municipal address provenance (EMUiA)

- Status: Proposed
- Date: 2026-10-27
- Owners: @fjarmula @piotr-lorek
- Supersedes: None (amends ADR 0006 geocoding additively)

## Context

`/geocode` searched only OSM `addr:*` tags. Kraków publishes its official address register,
*Punkty adresowe (EMUiA)* (MSIP dataset 1492, 70,331 points, EPSG:2178, City of Kraków only).
The contest asks the application to make meaningful use of municipal data, and a judge must be
able to see where an incident coordinate comes from. The OSM extract's bounding box also covers
towns outside Kraków (Wieliczka, Skawina) that reuse Kraków street names. Design:
the internal development specification (omitted from this evaluation snapshot).

## Decision

Additive to contract v1; `schema_version` stays `"1.0"`. Pydantic models in
`backend/src/greenwave/schemas/` remain canonical.

- The ETL `places` step reconciles on-network EMUiA points with OSM addresses:
  - Pass 1: the same (normalised street key, canonical house number) within 500 m. Never pair
    with an OSM address marked outside Kraków. Up to 100 m the pair is clean; between 100 m and
    500 m it is a disagreement; beyond 500 m the two are separate records.
  - Pass 2, among rows left unmatched: the same house number within 50 m, when the street keys
    are token-compatible (the shorter key's tokens are all in the longer one, or both share their
    last token), or within 20 m at any names.
  - Assignment is greedy one-to-one by (distance, EMUiA id, OSM row), so the result is
    deterministic.
- Each address has `provenance`: `matched` (EMUiA name and coordinate), `municipal` (EMUiA only)
  or `osm` (OSM only, the fallback). EMUiA is the authoritative coordinate.
- Contract:
  - New `AddressProvenance` enum.
  - `GeocodeResult` gains:
    - `provenance` (required in responses);
    - `osm_delta_m: number ≥ 0 | null` (matched only);
    - `disagreement_m: number ≥ 0 | null` (matched with `osm_delta_m > 100`);
    - `osm_position: Position | null`, set exactly when `disagreement_m` is set;
    - `osm_same_key_elsewhere: bool = false`: municipal, but OSM has this street and number
      unmatched (beyond 500 m, off-network or merged), so the UI must not claim OSM lacks it.
- An address point is a geocoding result, not a vehicle access point: snapping and the on-foot
  fallback (ADR 0009) are unchanged.
- Non-goals: no live WFS call; no access-point or entrance modelling; provenance does not change
  search order.

## Consequences

- The incident search shows a provenance badge per suggestion and a provenance strip for the
  selected address; the Data Quality panel gains two reconciliation checks.
- `MANIFEST.json` gains the EMUiA entries, so the full ETL chain must be re-run and the processed
  directory re-shipped.
- The EMUiA file is a required raw input of `places`.
- A record matched by name variant is searchable under both street names.
- Older clients ignore the new fields; the frontend validator accepts the optional ones absent or
  `null`.

## Alternatives considered

- Key-only matching: about 900 EMUiA addresses would have falsely shown as missing in OSM because
  of street-name variants (`Moniuszki` / `Stanisława Moniuszki`).
- Number-and-distance matching without the token check: it pairs different streets that cross
  (house number 1 on both corners).
- OSM coordinate for matched records: rejected; the register is the authoritative source.

## Validation

- `tests/etl/test_address_reconcile.py`, `tests/etl/test_places_pipeline.py`,
  `tests/places/test_address_index.py`, `tests/api/test_dispatch_api.py`;
- frontend `validateGeocode` and `address-provenance` tests;
- real-data counts in the `places` report section.
