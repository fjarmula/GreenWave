# Municipal addresses (EMUiA) in incident search: design

- Date: 2026-10-27
- Status: Approved (human, 2026-10-27), including builder's calls 1–11
- Scope: Part 1 of the public-data increment. Resource-aware ambulance dispatch (Part 2) is a
  separate spec; fire capabilities and police patrols are deferred.

## Intent

Kraków's official address register (*Punkty adresowe (EMUiA)*, MSIP dataset 1492) becomes the
authoritative source for incident addresses. Today `/geocode` searches only OSM `addr:*` tags.
After this change a judge typing an address sees, per suggestion and for the chosen incident,
whether the coordinate comes from the city register, whether OSM agrees, and where the register
closes a gap in OSM. The point is to show that municipal data changes the result.

Simulation only. An address point is a geocoding result, not a vehicle access point: the routing
snap and the on-foot fallback (ADR 0009) still decide where a vehicle stops.

## Goals

1. Load the EMUiA export as a manifest-recorded raw input and reconcile it with OSM addresses in
   the ETL `places` step.
2. Each address record carries provenance: `matched`, `municipal`, or `osm`.
3. `GeocodeResult` exposes provenance, the OSM offset, disagreement, and (for disagreements) the
   OSM position.
4. The incident search shows a provenance badge per suggestion and a provenance strip for the
   selected address; disagreements may draw an OSM ghost marker on the map.
5. `etl_report.json` records counts and concrete real-data examples per class; `data_quality.json`
   and the Data Quality panel show city-wide counts and percentages.

## Non-goals

- No live WFS call at ETL or run time. The ETL reads a downloaded file.
- No emergency-entrance or access-point modelling from addresses.
- No change to routing, snapping, station ranking, or the simulation contract beyond
  `GeocodeResult`.
- No resource roster, schedules, or availability (Part 2).
- No edits to OSM data and no write-back to any source.

## Anti-goals (a failure even if it works)

- Claiming an address is "missing in OpenStreetMap" when OSM has it under another street-name form.
- Matching a Kraków register entry to a same-named address in Wieliczka, Skawina, or another
  bounding-box town.
- Treating a matched address as a verified emergency entrance.
- Losing provenance: a record whose coordinate source cannot be stated.

## Source facts (verified 2026-10-27)

- Catalogue: https://msip.krakow.pl/dataset/1492. Owner: Prezydent Miasta Krakowa, UMK Wydział
  Geodezji. Terms: "Wykorzystanie danych zgodne z regulaminem MSIP"; the other MSIP inputs in
  `MANIFEST.json` record the Open Data Act wording with attribution. Record both in the manifest
  entry (see Provenance).
- Download used: `https://msip.um.krakow.pl/Dane/Adresy_JSON.zip` → `Adresy.geojson` (26 MB) and
  its own `__Aktualnosc__.txt` (`Data wygenerowania plików: 2026-10-27_00:45:04`). SHP, XLSX, DXF,
  WMS and WFS also exist; JSON is chosen because the ETL already reads GeoJSON.
- `FeatureCollection`, CRS `EPSG:2178` (the project's `METRIC_CRS`), 70,331 `Point` features.
- Properties on every feature: `id` (int, unique), `nazwa_ulicy`, `numer_adresowy`,
  `kod_pocztowy`, `miejscowosc` (always `Kraków`), `numer_dzielnicy`, `nazwa_dzielnicy`
  (`Dzielnica VI Bronowice`), `kod_teryt` (street TERYT code), `data_importu` (epoch ms).
- House numbers: `15`, `15A`… (upper-case letter suffixes). 8 `(street, number)` keys repeat.

Prototype reconciliation against the current `addresses.parquet` (65,690 OSM rows, 668 explicitly
outside Kraków), using the rule below:

| Class | Count |
|---|---|
| matched, `d ≤ 100 m` | 62,249 |
| matched, `100 < d ≤ 500 m` | 120 |
| same key but `d > 500 m` (kept separate) | 4 |
| no key match in OSM | 7,926, of which ~925 have an OSM address with the same house number within 50 m under another street-name form |
| OSM rows left unmatched | 3,321 |

The ~925 are name variants, not gaps: `Eliasza Radzikowskiego` / `Walerego Eliasza Radzikowskiego`,
`Moniuszki` / `Stanisława Moniuszki`, `Niepokalanej Panny Marii` / `Niepokalanej Marii Panny`,
`ks. bpa Władysława Bandurskiego` / `Księdza Biskupa Władysława Bandurskiego`. That is why the
name-variant pass below exists.

## Decisions (human, 2026-10-27)

### D1. Match key

`(normalised_street_key, canonical_housenumber)`:
- `normalised_street_key` = existing `normalise_street_name` (via `address_search_key`).
- `canonical_housenumber` = whitespace stripped, upper-cased (`15 a` → `15A`). Applied to both
  sources.

### D2. Suburb guard

Never match an EMUiA record to an OSM record with `outside_krakow = true`, or one more than
500 m away (EPSG:2178 metres).

### D3. Three distance tiers

For a key match at distance `d`:
- `d ≤ 100 m`: `matched`, no warning; the coordinate is EMUiA's.
- `100 < d ≤ 500 m`: `matched` with `disagreement_m = d`; amber warning in the UI; the coordinate
  is EMUiA's.
- `d > 500 m`: not a match. Two separate records, one `municipal`, one `osm`.

### D4. UI copy (exact strings; `<N>` = metres rounded to an integer)

Suggestion badge, next to the label:

| Record | Badge | Tone |
|---|---|---|
| matched, no disagreement | `EMUiA · Verified` | go (green/neutral) |
| matched with disagreement | `EMUiA · ⚠ <N>m delta` | caution (amber) |
| municipal | `EMUiA Only` | beacon/accent (blue) |
| osm | `OSM Fallback` | muted |

Provenance strip under the input, once an address suggestion is selected:

| Record | Strip |
|---|---|
| matched, no disagreement | `Coordinate source: Kraków EMUiA` · `OSM cross-check: <N> m delta` |
| matched with disagreement | `Coordinate source: Kraków EMUiA`, then an amber box: `Kraków EMUiA and OSM differ by <N> m. Routing to official EMUiA coordinate.` |
| municipal | `Coordinate source: Kraków EMUiA` · `Present in Kraków EMUiA; missing in OpenStreetMap` |
| osm | `Coordinate source: OSM fallback` |

A map-pinned incident shows no strip.

Note (builder's call): a `municipal` record with `osm_same_key_elsewhere` keeps the `EMUiA Only`
badge, but its strip shows only `Coordinate source: Kraków EMUiA`. Showing just that line uses
only the approved copy and makes no false "missing" claim. `GeocodeResult` carries this as
`osm_same_key_elsewhere: bool = False`.

Badges and the strip live in `IncidentInput`, so they appear everywhere it is used: the dispatch
HUD, `DriverSetupSheet`, and both `ComparisonWorkspace` inputs. Provenance belongs to the address,
not to a screen. The optional ghost marker is drawn only on the main dashboard map.

Map (optional, last task): for a disagreement, a secondary ghost marker at the OSM position and a
dashed line from it to the incident pin.

### D5. Demo discovery and quality

- The reconciliation records 5 concrete real-data examples of each class (matched clean, matched
  with disagreement, municipal-only gap fillers on well-known streets) in the `places` section of
  `etl_report.json`, and the Data Quality panel shows them.
- Total counts and percentages: `municipal_total`, `matched_clean`, `matched_disagreement`,
  `municipal_only_gap_closed`, `osm_only_fallback`.

## Design

### Raw input and provenance

- Files: `backend/data/raw/krakow/emuia/Adresy.geojson` and
  `backend/data/raw/krakow/emuia/__Aktualnosc__.txt`, in their own folder because the EMUiA zip
  ships an `__Aktualnosc__.txt` with a different timestamp from the 2026-10-13 MSIP package
  already at `krakow/__Aktualnosc__.txt`. Raw data stays git-ignored; the tracked `MANIFEST.json`
  gets two entries via `scripts/build_manifest.py`, with:
  - `source`: `Kraków open data (MSIP), Punkty adresowe (EMUiA)`; `url`: the dataset 1492 page.
  - `licence`: the existing `KRAKOW_LICENCE`, with notes recording the catalogue's
    "Wykorzystanie danych zgodne z regulaminem MSIP".
  - `attribution`: `Źródło: Urząd Miasta Krakowa, Wydział Geodezji / MSIP, zestaw danych 'Punkty
    adresowe (EMUiA)' (stan danych: 2026-10-27 00:45:04). Dane przetworzone w projekcie
    ER-GreenWave.`
  - `notes`: EPSG:2178; authoritative coordinate for incident addresses; reconciled against OSM.
- Changing `MANIFEST.json` changes its sha256, which every downstream step checks. After this
  change the full ETL chain must be re-run (`profile` … `quality`), and `processed/` re-shipped to
  the VM with the new manifest (deploy README, unchanged procedure).
- `backend/README.md` "Data Sources & Attribution" gains the EMUiA entry and download URL.

### Loader: `etl/municipal_addresses.py`

Reads the GeoJSON, validates, and returns a frame. It fails clearly (raising, like other ETL
boundaries) when: the CRS is not `EPSG:2178`; a feature is not a `Point`; `id` is missing or
repeated; `nazwa_ulicy` or `numer_adresowy` is empty; or the normalised street key is empty.
Columns: `emuia_id` (Int64), `street` (`nazwa_ulicy`), `housenumber` (`numer_adresowy` as
published), `search_key`, `number_key` (canonical), `district` (`nazwa_dzielnicy` with the
`Dzielnica <roman> ` prefix removed, e.g. `Bronowice`), `x_m`, `y_m`, `lat`, `lng` (via
`unproject_points`). `miejscowosc` is always `Kraków`; any other value fails, because the
register's Kraków-only scope underpins D2.

### Reconciliation: `etl/address_reconcile.py`

A pure function over two frames (EMUiA, OSM after its existing snap filter and dedupe), with no
I/O and deterministic output.

1. **Key pass (D1–D3).** For each key, list every pair (EMUiA row, OSM row not
   `outside_krakow`) with `d ≤ 500 m`. Sort the pairs by `(d, emuia_id, osm row order)` and
   assign them greedily one-to-one. Assigned pairs become `matched` with
   `match_basis = "exact_key"` and `osm_delta_m = d`.
2. **Name-variant pass (human-confirmed 2026-10-27).** Pair EMUiA and non-outside OSM rows
   that both stayed unmatched after pass 1, have the same `number_key`, and are within
   `d ≤ ADDRESS_NAME_VARIANT_RADIUS_M` (50 m). A pair is eligible only when either
   (a) the street keys are *token-compatible*, or (b) `d ≤ ADDRESS_NAME_VARIANT_TIGHT_M`
   (20 m). Assign greedily in the same order as pass 1. These pairs become `matched` with
   `match_basis = "name_variant"`. They can never be disagreements, because 50 m is below 100 m.
   - Two keys are token-compatible when every token of the shorter key (fewer tokens) appears in
     the longer one, or when both keys share their last token (the surname). Examples:
     `moniuszki` / `stanislawa moniuszki`; `niepokalanej panny marii` / `niepokalanej marii panny`;
     `bpa wladyslawa bandurskiego` / `wladyslawa bandurskiego`.
   - The rule prevents corner collisions: house number `1` on two crossing streets within 50 m.
3. Remaining EMUiA rows become `municipal`; remaining OSM rows become `osm`. That includes OSM
   rows outside Kraków and both sides of a `d > 500 m` same-key pair.
4. **Gap check.** A `municipal` record is a *gap closed* only when no non-outside OSM address with
   the same key exists anywhere in the OSM extract: not in the reconciled set, and not among rows
   dropped by the OSM snap filter or dedupe. Otherwise `osm_same_key_elsewhere = true`. Such a
   record stays `municipal`, but it is not counted in `municipal_only_gap_closed`, never appears
   as a gap example, and its strip omits the "missing in OpenStreetMap" line (see D4 note). For
   this check the reconciliation also receives the set of OSM keys from all extracted,
   non-outside rows (before filtering).

The output frame is the new `addresses.parquet`:

| Column | matched | municipal | osm |
|---|---|---|---|
| `provenance` | `matched` | `municipal` | `osm` |
| `street`, `housenumber` | EMUiA | EMUiA | OSM |
| `search_key` | EMUiA key | EMUiA key | OSM key |
| `alt_search_key` | OSM key if it differs, else null | null | null |
| `locality` | EMUiA district | EMUiA district | OSM locality (as today) |
| `outside_krakow` | false | false | OSM value |
| `lat`, `lng` | EMUiA | EMUiA | OSM |
| `emuia_id` | id | id | null |
| `osm_lat`, `osm_lng`, `osm_delta_m` | OSM values | null | null |
| `match_basis` | `exact_key` / `name_variant` | null | null |
| `osm_same_key_elsewhere` | false | true / false | false |
| `label` | from `assign_labels` (unchanged rules) | | |

Disagreement is derived, not stored: `provenance == matched and osm_delta_m > 100`.

The clean threshold (100 m), the match ceiling (500 m) and the name-variant radius (50 m) go in
`etl/config.py`. 100 m and 500 m are labelled `APPROVED (human, 2026-10-27)`; 50 m is labelled
`PLACEHOLDER` until reviewed. 50 m and 20 m (`ADDRESS_NAME_VARIANT_TIGHT_M`) are labelled
`APPROVED (human, 2026-10-27)`, like the others.

### `places` step changes

Order: OSM extract → OSM snap filter → OSM dedupe (all unchanged) → EMUiA load → EMUiA snap filter
against the same main-component nodes (`PLACES_MAX_SNAP_DISTANCE_M`) → reconcile → `assign_labels`
→ write. Filtering both sides before reconciling mirrors the existing reason (an off-network twin
must not displace an on-network one) and keeps every written coordinate routable.

`AddressesReport` gains a `reconciliation` object:
- `municipal_total` (EMUiA rows read), `municipal_dropped_off_network`, `municipal_rows` (after
  the snap filter).
- `matched_clean`, `matched_disagreement`, `matched_name_variant` (a subset of `matched_clean`),
  `municipal_only_gap_closed`, `municipal_same_key_elsewhere`, `osm_only_fallback`,
  `osm_only_outside_krakow` (a subset), `same_key_beyond_limit`.
- `thresholds_m`: `{clean, max, name_variant}`.
- `examples`: `{matched_clean, matched_disagreement, municipal_only_gap_closed}`, each up to 5
  strings, chosen deterministically:
  - *Well-known street* = ranked by the number of `matched` records on that street key
    (descending, then key). Gap examples take the first `municipal` record (natural number order)
    on each of the top-ranked streets that have one. Clean examples do the same with `matched`.
  - Disagreement examples: largest `osm_delta_m` first, at most one per street.
  - Format: `"<label>: <N> m"` for matched, `"<label>"` for gaps.
- `emuia_export_timestamp` from `krakow/emuia/__Aktualnosc__.txt`.

`AddressesReport.rows` stays the total row count of `addresses.parquet`.

### Dataset loader and integrity (`dataset/constants.py`, `dataset/integrity.py`)

- The expected schema of `addresses.parquet` gains the new columns. The nullable ones are
  `alt_search_key`, `emuia_id`, `osm_lat`, `osm_lng`, `osm_delta_m` and `match_basis`.
- `check_places`: `provenance` must be one of the three values; nulls must be consistent with
  provenance as in the table above; `osm_delta_m ≤ 500` when present; labels unique (unchanged);
  coordinates checked as today.

### Search: `places/address_index.py`

- `_Address` carries the provenance fields. A record with an `alt_search_key` is indexed under
  both keys, so `Stanisława Moniuszki 5` finds the record labelled `Moniuszki 5`. A query must
  return one result per record even when both keys match.
- House-number matching folds case on both sides (unchanged behaviour). Ordering is unchanged:
  provenance does not affect rank.
- `search` builds the new `GeocodeResult` fields.

### Contract: `schemas/dispatch.py` (+ ADR 0013)

```python
class AddressProvenance(StrEnum):
    MATCHED = "matched"      # EMUiA and OSM agree on the key; coordinate is EMUiA's
    MUNICIPAL = "municipal"  # in EMUiA, no OSM counterpart
    OSM = "osm"              # OSM only (fallback)

class GeocodeResult(BaseModel):
    label: str
    position: Position                       # authoritative coordinate
    provenance: AddressProvenance
    osm_delta_m: float | None = None         # matched only, ≥ 0
    disagreement_m: float | None = None      # matched and osm_delta_m > 100 only
    osm_position: Position | None = None     # set iff disagreement_m is set
    osm_same_key_elsewhere: bool = False     # municipal only: OSM has this key, unmatched
```

The change is additive to contract v1; `schema_version` stays `"1.0"`. `provenance` is required
in responses (the backend always knows it); old clients ignore it. `/geocode`'s docstring changes
from "OSM address index" to "local EMUiA + OSM address index". Afterwards, regenerate
`contracts/openapi.json` and `frontend/src/types/api.generated.ts`.

ADR 0013 records: provenance classes, the match rule and tiers, EMUiA as the authoritative
coordinate, the name-variant pass, and "an address point is not an access point".

### Frontend

- `lib/transport/validate.ts` `validateGeocode`: `provenance` must be one of the three values;
  `osm_delta_m` and `disagreement_m` absent, null or a number ≥ 0; `osm_position` absent, null or
  a valid position; `osm_position` present iff `disagreement_m` is present.
- `lib/useIncidentDispatch.ts`: `Incident` gains an optional `address` field holding
  `{ provenance, osmDeltaM, disagreementM, osmPosition }`. `suggestionToIncident` fills it;
  `pinnedIncident` leaves it unset.
- A new pure helper, `lib/address-provenance.ts`, maps a result or incident to badge text and tone
  and to the strip lines (the exact D4 strings), so components stay thin and the copy is tested in
  one place.
- `components/hud/dispatch/IncidentInput.tsx`: the badge in each option row (label left, badge
  right, with no truncation of the label before the badge), and the strip below the input when
  `incident.address` is set. The disagreement box uses the caution tone; the badge tones use the
  existing `tone-go`, `tone-caution`, `tone-beacon` and muted classes.
- Accessibility: the badge text is part of the option's accessible name; the amber box is
  `role="status"` (not an alert: the user chose it, nothing failed).
- `components/map/`: optional OSM ghost marker plus dashed connector for a disagreement incident,
  reusing the dashed-connector approach of `snap-connectors.ts`, with the label `OSM position`.
  The incident's `address` must reach the map layer via the existing `MapEndpoint`/incident props.
- `DataQualityPanel.tsx`: no change; it renders the new checks generically.

### Quality step (`etl/quality.py`)

A new check, `address_reconciliation`, titled "Municipal addresses (EMUiA)", is read from the
report's `places.addresses.reconciliation`:
- `status`: `info` (report only; adds no thresholds).
- `headline` with percentages of `municipal_total`, e.g. `70,331 EMUiA addresses: 88.4% match OSM
  within 100 m, 0.2% differ by 100–500 m, 10.0% fill gaps OSM lacks. 3,321 OSM-only addresses kept
  as fallback.` The numbers come from the run.
- `metrics`: `matched_clean`, `matched_disagreement`, `municipal_only_gap_closed`,
  `osm_only_fallback`. `municipal_total` is the headline's leading number. The panel shows four
  metrics per check, and `test_every_check_has_at_most_four_metrics` enforces that.
- `samples`: the 5 disagreement examples.
- A second check, `address_gap_examples`, titled "Addresses only in EMUiA", has `status`
  `info`. Its `samples` are 3 gap examples followed by 2 clean-match examples, so all three
  example classes reach the panel within the 5-sample limit. Its `metrics` are
  `matched_name_variant` and `same_key_beyond_limit`. The headline gives the gap count and says
  name-variant matches were not counted as gaps.

`build_quality` appends both checks. The step's inputs are unchanged (it already reads
`etl_report.json`).

## Testing

- Fixtures: a small EPSG:2178 GeoJSON (a dozen points) and a small OSM frame that cover every
  branch: clean match, a 100–500 m disagreement, a > 500 m same key, an outside-Kraków twin, a
  name variant within 50 m, a name variant at 60 m (stays municipal), a greedy contention case
  (two EMUiA rows, one OSM row), a duplicate EMUiA key, and an off-network EMUiA point.
- Loader failures: wrong CRS, non-point geometry, duplicate id, empty street, a non-Kraków
  `miejscowosc`.
- Determinism: the reconciliation run twice is byte-identical; `scripts/etl_equivalence.py`
  compares the outputs of two full runs.
- Integrity: consistent and inconsistent provenance/null combinations.
- API: `/geocode` returns each provenance class from a fixture dataset; snapshot of
  `openapi.json`.
- Frontend: unit tests for `address-provenance.ts` (every D4 string); validator cases;
  `IncidentInput` tests for badges, the strip and the amber box; updated snapshots.
- Real data, recorded in the PR: counts from the regenerated `etl_report.json`, plus a manual or
  Playwright check that one example of each class shows the right badge and strip.

## Left to the builder

- Internal structure of the reconciliation (vectorised vs per-key loop), as long as the output is
  deterministic.
- Exact Tailwind classes, badge spacing, and responsive behaviour of the option row, within
  `frontend/AGENTS.md` and the existing tone classes.
- Ghost-marker styling.
- Whether the house-number regex in `address_index.py` needs widening; check it against
  `numer_adresowy` shapes.

## Builder's calls (not decided by the human; review them)

1. **Name-variant pass, 50 m**, with token compatibility or ≤ 20 m. Confirmed and refined by the
   human on 2026-10-27.
2. **JSON download, stored under `krakow/emuia/`**, with the manifest licence wording as above.
3. **Snap-filter both sides before reconciling**, so an EMUiA point beyond 150 m from the network
   is dropped and its OSM twin, if any, becomes `osm`.
4. **Labels and locality from EMUiA** for matched records; the district name, without the
   `Dzielnica <roman>` prefix, is the disambiguating locality.
5. **Provenance does not affect search order.**
6. **Two quality checks** (summary and examples), so all example classes fit the 5-sample limit;
   four count metrics; `municipal_total` and the percentages in the headline.
7. **EMUiA is a required input** of `places`. If it is missing, the step raises
   `MunicipalAddressError`, whose message names the path and the download URL. Test fixtures (`make_raw`) write a
   minimal EMUiA file.
8. **ADR 0013** for the contract addition.
9. **Same key elsewhere** (gap check, step 4): honest strip without new copy; excluded from the gap
   count.
10. **Badges on every `IncidentInput`** (dispatch, driver, comparison); ghost marker on the main
    map only.
11. **Attribution date hard-coded** in `build_manifest.py`, like the other MSIP entries; update it
    when the file is refreshed. The quality step reads `emuia_export_timestamp` from the file.
