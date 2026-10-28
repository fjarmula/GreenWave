# Municipal Addresses (EMUiA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kraków's EMUiA address register becomes the authoritative incident-address source, reconciled with OSM, with provenance visible in search, on the map and in the Data Quality panel.

**Architecture:** A new loader and a pure reconciliation module run inside the ETL `places` step and write provenance columns to `addresses.parquet`. `AddressIndex` returns them through additive `GeocodeResult` fields (ADR 0013). The frontend maps them to fixed badge and strip copy through one pure helper. The quality step summarises the reconciliation report section.

**Tech Stack:** Python 3.12, polars, shapely/geopandas, FastAPI/Pydantic, pytest; Next.js/React, Vitest, MapLibre.

**Spec:** `docs/superpowers/specs/2026-10-27-municipal-addresses-design.md` (read it in full first: decisions D1–D5, column table, builder's calls 1–11).

## Global Constraints

- Simulation only. An address point is never an access point; routing snap and ADR 0009 are unchanged.
- Thresholds, in `etl/config.py`: `ADDRESS_MATCH_CLEAN_M = 100.0` and `ADDRESS_MATCH_MAX_M = 500.0` (`APPROVED (human, 2026-10-27)`); `ADDRESS_NAME_VARIANT_RADIUS_M = 50.0`, `ADDRESS_NAME_VARIANT_TIGHT_M = 20.0` (all `APPROVED (human, 2026-10-27)`).
- Distances are in EPSG:2178 metres (`METRIC_CRS`).
- Raw files: `backend/data/raw/krakow/emuia/Adresy.geojson`, `backend/data/raw/krakow/emuia/__Aktualnosc__.txt`. Never commit raw data.
- Exact UI copy (`<N>` = `Math.round(metres)`):
  - Badges: `EMUiA · Verified`, `EMUiA · ⚠ <N>m delta`, `EMUiA Only`, `OSM Fallback`.
  - Strip: `Coordinate source: Kraków EMUiA`, `Coordinate source: OSM fallback`, `OSM cross-check: <N> m delta`, `Present in Kraków EMUiA; missing in OpenStreetMap`.
  - Disagreement box: `Kraków EMUiA and OSM differ by <N> m. Routing to official EMUiA coordinate.`
- Contract stays `schema_version "1.0"`, additive. Never hand-edit `contracts/openapi.json` or `frontend/src/types/api.generated.ts`; regenerate them with `cd backend && uv run python scripts/export_openapi.py && cd ../frontend && npm run generate:types`.
- ETL output is deterministic: the same inputs give the same bytes.
- Commits: `<category>: <message>`, stage explicit paths only, end with the `Co-Authored-By` trailer from the session. No push and no branch operations.
- Backend checks: `cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`. Frontend checks: `cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`.

## Review Focus

1. **House number with inner whitespace or lower case on either side** (`15 a`, `15a`): it must match `15A`. Test it in Task 2 (`test_number_case_and_space_fold`).
2. **One OSM row closest to two EMUiA rows with the same key** (duplicate EMUiA key): only one EMUiA row may claim it, and the result must be deterministic. Test it in Task 2 (`test_greedy_contention_is_deterministic`).
3. **A query that matches both `search_key` and `alt_search_key` of one record** must return it once. Test it in Task 5 (`test_alt_key_record_returned_once`).
4. **A municipal record whose OSM twin was dropped by the snap filter** must not claim "missing in OpenStreetMap". Test it in Task 3 (`test_dropped_osm_twin_marks_same_key_elsewhere`) and in Task 7 (strip copy).
5. **Old or partial geocode payloads** (fields absent or `null`; `osm_position` without `disagreement_m`): the validator accepts absent/null and rejects inconsistent ones. Test it in Task 7 (`validateGeocode` cases).

---

## Milestone A: ETL (Tasks 1–4)

### Task 1: EMUiA loader, config and fixtures

**Files:**
- Create: `backend/src/greenwave/etl/municipal_addresses.py`
- Modify: `backend/src/greenwave/etl/addresses.py` (add `canonical_housenumber`), `backend/src/greenwave/etl/config.py` (three thresholds, with comments in the file's style)
- Modify: `backend/tests/support/pipeline_fixtures.py` (`make_raw` writes the EMUiA files; new `emuia_feature` helper)
- Test: `backend/tests/etl/test_municipal_addresses.py`, `backend/tests/etl/test_addresses.py`

**Interfaces:**
- Produces:
  - `canonical_housenumber(number: str) -> str`: removes all whitespace, then upper-cases.
  - `EMUIA_RELATIVE_PATH = Path("krakow") / "emuia" / "Adresy.geojson"` and `EMUIA_AKTUALNOSC_PATH = Path("krakow") / "emuia" / "__Aktualnosc__.txt"`. `EMUIA_DOWNLOAD_URL = "https://msip.um.krakow.pl/Dane/Adresy_JSON.zip"`.
  - `class MunicipalAddressError(ValueError)`.
  - `load_municipal_addresses(path: Path) -> pl.DataFrame` with columns `emuia_id: Int64, street, housenumber, search_key, number_key, district: Utf8, x_m, y_m, lat, lng: Float64`, sorted by `emuia_id`.
  - `emuia_export_timestamp(raw_dir: Path) -> str | None`, the same format as `quality.msip_export_timestamp`. Reuse its regex; do not copy it.
  - Test helper `emuia_feature(fid: int, street: str, number: str, x_m: float, y_m: float, *, miejscowosc: str = "Kraków", district: str = "Dzielnica I Stare Miasto") -> dict`, and `make_raw(tmp_path, extra=(), emuia=())`, which writes a FeatureCollection with `crs.properties.name = "EPSG:2178"` and an `__Aktualnosc__.txt` containing `Data wygenerowania plików: 2026-10-27_00:45:04`.

- [ ] **Step 1: Write the failing tests.** In `test_municipal_addresses.py`:
  - `test_loads_points_with_keys_and_wgs84`: one feature `("ks. bpa Władysława Bandurskiego", "15 a")` gives `search_key == address_search_key(street)`, `number_key == "15A"`, `housenumber == "15 a"`, `district == "Stare Miasto"`, and `lat`/`lng` equal to `unproject_points` of `(x_m, y_m)` to 1e-9.
  - `test_district_prefix_removed`: `"Dzielnica XIII Podgórze"` becomes `"Podgórze"`.
  - Failure tests, each `pytest.raises(MunicipalAddressError, match=...)`: wrong CRS (`"EPSG:4326"`); a `LineString` geometry; a duplicate `id`; an empty `nazwa_ulicy`; a whitespace-only `numer_adresowy`; `miejscowosc="Wieliczka"`; a missing file, whose message contains the path and `EMUIA_DOWNLOAD_URL`.
  - `test_export_timestamp_read_from_aktualnosc` gives `"2026-10-27 00:45:04"`.

  In `test_addresses.py`: `test_canonical_housenumber` with cases `"15a"→"15A"`, `" 15 a "→"15A"`, `"15/2b"→"15/2B"`.
- [ ] **Step 2: Run them and confirm they fail.** `cd backend && uv run pytest tests/etl/test_municipal_addresses.py tests/etl/test_addresses.py -q`. Expected: ImportError / FAIL.
- [ ] **Step 3: Implement.** Read the file with `json` (`encoding="utf-8-sig"`). Get the coordinates from `geometry.coordinates`, then `unproject_points` once for all rows.
- [ ] **Step 4: Run the tests.** Same command; expected PASS. Then run the full `uv run pytest -q` and confirm existing pipeline tests still pass with the `make_raw` change.
- [ ] **Step 5: Commit.** `feat: load Kraków EMUiA address points in the ETL`

### Task 2: Reconciliation (pure)

**Files:**
- Create: `backend/src/greenwave/etl/address_reconcile.py`
- Test: `backend/tests/etl/test_address_reconcile.py`

**Interfaces:**
- Consumes: Task 1 frame; the OSM frame in the existing `addresses` schema (`street, housenumber, search_key, locality, outside_krakow, lat, lng`); `canonical_housenumber`.
- Produces:
  - `reconcile_addresses(municipal: pl.DataFrame, osm: pl.DataFrame, osm_extracted_keys: frozenset[tuple[str, str]]) -> tuple[pl.DataFrame, ReconciliationCounts]`. The frame has the existing columns plus `provenance, alt_search_key, emuia_id, osm_lat, osm_lng, osm_delta_m, match_basis, osm_same_key_elsewhere`, per the spec column table, and is not yet labelled. `osm_extracted_keys` holds `(search_key, canonical_housenumber)` of every extracted OSM row that is not `outside_krakow`.
  - `class ReconciliationCounts(BaseModel)`: `municipal_rows, matched_clean, matched_disagreement, matched_name_variant, municipal_only_gap_closed, municipal_same_key_elsewhere, osm_only_fallback, osm_only_outside_krakow, same_key_beyond_limit: int`.
  - `class ReconciliationExamples(BaseModel)`: `matched_clean, matched_disagreement, municipal_only_gap_closed: list[str]` (each ≤ 5).
  - `reconciliation_examples(labelled: pl.DataFrame) -> ReconciliationExamples`, applying the spec's selection rules (well-known street = most `matched` rows per `search_key`, then key; disagreements by `osm_delta_m` descending, one per street; format `"<label>: <N> m"` / `"<label>"`).
  - Constants `PROVENANCE_MATCHED = "matched"`, `PROVENANCE_MUNICIPAL = "municipal"`, `PROVENANCE_OSM = "osm"`, `MATCH_EXACT_KEY = "exact_key"`, `MATCH_NAME_VARIANT = "name_variant"`.

Assignment algorithm (the tests do not fully fix it):

```
pass 1: for pairs (m, o) with same (search_key, number_key), o not outside, d <= MAX
        sort by (d, emuia_id, o_index); take pair if neither side taken
pass 2: same, over rows untaken after pass 1, key = number_key only, d <= NAME_VARIANT_RADIUS,
        and (token_compatible(m.search_key, o.search_key) or d <= NAME_VARIANT_TIGHT)
        token_compatible: shorter key's tokens all in longer key, or same last token
counts: same_key_beyond_limit = untaken EMUiA rows with a same-key, non-outside OSM row at d > MAX
        municipal_same_key_elsewhere = untaken EMUiA rows whose key is in osm_extracted_keys
```

Use an STRtree or per-key grouping, never all-pairs. Row order of the output: matched and municipal rows by `emuia_id`, then osm rows in input order.

- [ ] **Step 1: Write the failing tests.** Build OSM rows at metric offsets from `(7_420_000, 5_545_000)` via `unproject_points`. Tests:
  - `test_clean_match_uses_emuia_coordinate`: d = 40 gives `provenance == "matched"`, `osm_delta_m ≈ 40`, `lat/lng` = EMUiA, `osm_lat/osm_lng` = OSM, `street` = EMUiA name, `match_basis == "exact_key"`.
  - `test_disagreement_tier`: d = 250 gives `matched` with `osm_delta_m ≈ 250`, and `counts.matched_disagreement == 1`.
  - `test_beyond_limit_kept_separate`: d = 600 gives one `municipal` and one `osm` row, `same_key_beyond_limit == 1` and `osm_same_key_elsewhere is True`.
  - `test_outside_krakow_never_matched`: the OSM twin at d = 10 with `outside_krakow=True` gives `municipal` + `osm`, and `osm_only_outside_krakow == 1`.
  - `test_name_variant_within_50m`: `"Moniuszki" 5` vs OSM `"Stanisława Moniuszki" 5` at 30 m gives `matched`, `match_basis == "name_variant"` and `alt_search_key == address_search_key("Stanisława Moniuszki")`; at 60 m it stays `municipal` with `osm_same_key_elsewhere is False`.
  - `test_name_variant_corner_collision_rejected`: `"Długa" 1` vs OSM `"Krótka" 1` at 35 m stays unmatched; at 15 m it is `matched` (`name_variant`).
  - `test_token_compatible`: `("moniuszki", "stanislawa moniuszki")`, `("niepokalanej panny marii", "niepokalanej marii panny")` and `("adolfa szyszko bohusza", "adolfa szyszki bohusza")` give True; `("dluga", "krotka")` gives False.
  - `test_number_case_and_space_fold`: EMUiA `"15A"` vs OSM `"15 a"` gives matched.
  - `test_greedy_contention_is_deterministic`: two EMUiA rows with one key at 20 m and 80 m from one OSM row: the 20 m row is `matched`, the other `municipal`; repeating the call gives an equal frame (`frame.equals`).
  - `test_gap_versus_same_key_elsewhere`: an EMUiA key absent from OSM gives `municipal_only_gap_closed == 1`; the same key present only in `osm_extracted_keys` gives `municipal_same_key_elsewhere == 1` and `gap_closed == 0`.
  - `test_examples_selection`: on a labelled fixture with 7 disagreements on 6 streets, there are 5 disagreement examples, largest first, distinct streets, each formatted `"<label>: <N> m"`.
- [ ] **Step 2: Run them and confirm they fail.** `uv run pytest tests/etl/test_address_reconcile.py -q`.
- [ ] **Step 3: Implement** in `address_reconcile.py`.
- [ ] **Step 4: Run the tests.** Expected PASS; also run `uv run mypy`.
- [ ] **Step 5: Commit.** `feat: reconcile EMUiA and OSM addresses with provenance`

### Task 3: `places` step, report and dataset integrity

**Files:**
- Modify: `backend/src/greenwave/etl/places_pipeline.py` (order per spec "`places` step changes"; `AddressesReport.reconciliation`)
- Modify: `backend/src/greenwave/dataset/constants.py` (addresses schema: new columns; `emuia_id: Int64`, `osm_same_key_elsewhere: Boolean`, the rest String/Float64)
- Modify: `backend/src/greenwave/dataset/integrity.py` (`check_places`: provenance enum and null consistency)
- Modify: `backend/tests/support/processed.py` and any tiny-dataset builders that write `addresses.parquet` (find them with `graphify query "addresses.parquet writers"`)
- Test: `backend/tests/etl/test_places_pipeline.py`, `backend/tests/dataset/test_loader.py` (where the existing `check_places` cases live; confirm with `graphify query "check_places tests"`). Also run `test_real_data_smoke.py` once Task 10 has real data.

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `class AddressReconciliationReport(BaseModel)`: `municipal_total: int`, `municipal_dropped_off_network: int`, `thresholds_m: dict[str, float]` (keys `clean`, `max`, `name_variant`), `emuia_export_timestamp: str | None`, `examples: ReconciliationExamples`, plus every `ReconciliationCounts` field (flattened). `AddressesReport.reconciliation: AddressReconciliationReport`. Task 6 reads it from `etl_report.json` at `places.addresses.reconciliation`.

- [ ] **Step 1: Write the failing tests.**
  - `test_places_reconciles_emuia`: `make_raw(..., emuia=(emuia_feature(1, "Poprzeczna", "7", *<metric of at(2, 0.4)>),))` gives an address row `provenance == "matched"`, and `section.addresses.reconciliation.matched_clean == 1`.
  - `test_off_network_emuia_dropped`: an EMUiA point 300 m from any node gives `municipal_dropped_off_network == 1` and no row written for it.
  - `test_dropped_osm_twin_marks_same_key_elsewhere`: the OSM address is off-network and EMUiA has the same key on-network, so the written row is `municipal` with `osm_same_key_elsewhere == True`.
  - `test_places_output_is_deterministic`: two runs give equal `addresses.parquet` bytes.
  - Integrity: `check_places` raises on `provenance="unknown"`, on `matched` with null `osm_delta_m`, and on `osm` with non-null `emuia_id`; it passes on a consistent frame.
- [ ] **Step 2: Run them and confirm they fail.** `uv run pytest tests/etl/test_places_pipeline.py tests/dataset -q`.
- [ ] **Step 3: Implement.** Build `osm_extracted_keys` from the `extract_addresses` frame before any filter.
- [ ] **Step 4: Run the full backend checks.** Expected PASS.
- [ ] **Step 5: Commit.** `feat: write address provenance from the places step`

### Task 4: Manifest, attribution and README

**Files:**
- Modify: `backend/scripts/build_manifest.py` (`_SOURCES`: two EMUiA entries with the spec's source, url, licence, attribution and notes)
- Modify: `backend/README.md` ("Data Sources & Attribution": EMUiA entry with the dataset URL and `EMUIA_DOWNLOAD_URL`; data-pipeline section: where to unzip)
- Test: create `backend/tests/scripts/test_build_manifest.py` (none exists; import `scripts/build_manifest.py` the way `test_export_station_snapshot.py` imports its script)

- [ ] **Step 1:** Add a test asserting `_SOURCES` contains `krakow/emuia/Adresy.geojson` with `url == "https://msip.krakow.pl/dataset/1492"` and attribution containing `Punkty adresowe (EMUiA)`.
- [ ] **Step 2: Run it and confirm it fails;** implement; run it and confirm it passes.
- [ ] **Step 3: Commit.** `docs: record EMUiA source, licence and attribution`

**Milestone A checkpoint:** backend checks green; report changed files; proposed commits as above.

## Milestone B: Contract and search (Task 5)

### Task 5: `GeocodeResult` provenance, index, ADR 0013

**Files:**
- Modify: `backend/src/greenwave/schemas/dispatch.py` (`AddressProvenance`, `GeocodeResult` fields per the spec's code block); `backend/src/greenwave/schemas/__init__.py` export
- Modify: `backend/src/greenwave/places/address_index.py` (`_Address` carries provenance fields; index under `alt_search_key` too; build the new result fields)
- Modify: `backend/src/greenwave/api/dispatch.py` (geocode docstring: "local EMUiA + OSM address index")
- Create: `docs/adr/0013-municipal-address-provenance.md` (template `0001-template.md`; content per spec "Contract" paragraph)
- Regenerate: `contracts/openapi.json`, `frontend/src/types/api.generated.ts`
- Test: `backend/tests/places/test_address_index.py`, `backend/tests/api/test_dispatch_api.py`, `backend/tests/schemas/test_dispatch_schemas.py`

**Interfaces:**
- Produces (wire): `GeocodeResult { label, position, provenance: "matched"|"municipal"|"osm", osm_delta_m?: number|null, disagreement_m?: number|null, osm_position?: Position|null, osm_same_key_elsewhere?: boolean }`. `disagreement_m = osm_delta_m` iff matched and `osm_delta_m > ADDRESS_MATCH_CLEAN_M`; `osm_position` is set iff `disagreement_m` is set.

- [ ] **Step 1: Write the failing tests.**
  - `test_matched_clean_result_fields`: `provenance == MATCHED`, `osm_delta_m == 40.0`, `disagreement_m is None`, `osm_position is None`.
  - `test_disagreement_result_fields`: `disagreement_m == 250.0`, and `osm_position` = the row's `osm_lat/osm_lng`.
  - `test_municipal_and_osm_results`: municipal has every optional field `None`; osm has `provenance == OSM`.
  - `test_alt_key_record_returned_once`: the record labelled `Moniuszki 5` with `alt_search_key "stanislawa moniuszki"` is found by `"Stanisława Moniuszki 5"` and by `"Moniuszki 5"`, exactly once each, even for the query `"moniuszki"`, which matches both keys by contains.
  - Schema: `GeocodeResult` without `provenance` fails validation.
  - API: `test_geocode_returns_provenance` on the layout fixture.
- [ ] **Step 2: Run them and confirm they fail.** `uv run pytest tests/places tests/api/test_dispatch_api.py tests/schemas -q`.
- [ ] **Step 3: Implement;** write ADR 0013 (Status: Proposed, Owners as in ADR 0009).
- [ ] **Step 4: Regenerate the contracts,** then run the backend checks and `cd frontend && npm run typecheck`. Typecheck may fail where `GeocodeResult` literals now lack `provenance`; fix only the test fixtures and mocks here (e.g. `mock-dispatch.test.ts`, `IncidentInput.test.tsx`), with `provenance: "osm"`.
- [ ] **Step 5: Commit.** `feat: expose address provenance in geocode results (ADR 0013)`

## Milestone C: Quality (Task 6)

### Task 6: Quality checks

**Files:**
- Modify: `backend/src/greenwave/etl/quality.py` (`_address_reconciliation(report)`, `_address_gap_examples(report)`, appended in `build_quality` after `_road_attributes`)
- Test: `backend/tests/etl/test_quality.py`, plus the layout fixture's report (`tests/support/processed.py`) gaining a `places.addresses.reconciliation` section

**Interfaces:**
- Consumes: the Task 3 report section.
- Produces:
  - Check `address_reconciliation`, title `Municipal addresses (EMUiA)`, `info`. Metrics, exactly: `matched_clean`, `matched_disagreement`, `municipal_only_gap_closed`, `osm_only_fallback`. Samples are the disagreement examples. Headline:
    `f"{total:,} EMUiA addresses: {clean_pct:.1f}% match OSM within {clean_m:.0f} m, {dis_pct:.1f}% differ by {clean_m:.0f}–{max_m:.0f} m, {gap_pct:.1f}% fill gaps OSM lacks. {osm_only:,} OSM-only addresses kept as fallback."`
    The percentages are of `municipal_total`.
  - Check `address_gap_examples`, title `Addresses only in EMUiA`, `info`. Metrics: `matched_name_variant`, `same_key_beyond_limit`. Samples: the first 3 gap examples followed by the first 2 clean examples. Headline: `f"{gap:,} addresses exist only in EMUiA. {variant:,} street-name variants were matched to OSM and not counted as gaps."`

- [ ] **Step 1: Write the failing tests.**
  - `test_address_reconciliation_summarises_report`: the fixture with total 1000, clean 880, disagreement 2, gap 100, osm_only 30 gives the headline starting `"1,000 EMUiA addresses: 88.0% match OSM within 100 m, 0.2% differ by 100–500 m, 10.0% fill gaps"` and metrics equal to the four values.
  - `test_address_gap_examples_mixes_classes`: samples = 3 gap + 2 clean, in that order.
  - The existing `test_checks_come_in_spec_order_with_schema_markers` is updated to the new order; `test_every_check_has_at_most_four_metrics` and `test_samples_capped_at_five` pass unchanged.
- [ ] **Step 2: Run them and confirm they fail;** implement; run the backend checks; confirm they pass.
- [ ] **Step 3: Commit.** `feat: report EMUiA reconciliation in data quality`

## Milestone D: Frontend (Tasks 7–9)

### Task 7: Validator, incident provenance and copy helper

**Files:**
- Modify: `frontend/src/lib/transport/validate.ts` (`validateGeocode`)
- Modify: `frontend/src/types/telemetry.ts` (`export type AddressProvenance = Schemas["AddressProvenance"]`)
- Modify: `frontend/src/lib/useIncidentDispatch.ts` (`Incident.address?: IncidentAddress`), `frontend/src/lib/address-search.ts` (`suggestionToIncident` fills `address`)
- Create: `frontend/src/lib/address-provenance.ts`
- Test: `frontend/src/lib/transport/validate.test.ts`, `frontend/src/lib/address-provenance.test.ts`, `frontend/src/components/hud/dispatch/IncidentInput.test.tsx` (`suggestionToIncident` case)

**Interfaces:**
- Produces:
  - `type IncidentAddress = { provenance: AddressProvenance; osmDeltaM: number | null; disagreementM: number | null; osmPosition: Position | null; osmSameKeyElsewhere: boolean }`, exported from `useIncidentDispatch.ts`.
  - `addressFromResult(result: GeocodeResult): IncidentAddress`.
  - `type BadgeTone = "go" | "caution" | "beacon" | "muted"`; `provenanceBadge(address: IncidentAddress): { text: string; tone: BadgeTone }`.
  - `provenanceStrip(address: IncidentAddress): { lines: string[]; warning: string | null }`.

- [ ] **Step 1: Write the failing tests** in `address-provenance.test.ts`, one per row of the spec's D4 tables plus the same-key-elsewhere note, with exact strings:
  - Clean matched, delta 40.4: badge `{text: "EMUiA · Verified", tone: "go"}`; strip lines `["Coordinate source: Kraków EMUiA", "OSM cross-check: 40 m delta"]`, warning `null`.
  - Disagreement 249.6: badge `"EMUiA · ⚠ 250m delta"` with tone `caution`; lines `["Coordinate source: Kraków EMUiA"]`; warning `"Kraków EMUiA and OSM differ by 250 m. Routing to official EMUiA coordinate."`.
  - Municipal: `"EMUiA Only"`/`beacon`; lines `["Coordinate source: Kraków EMUiA", "Present in Kraków EMUiA; missing in OpenStreetMap"]`.
  - Municipal with `osmSameKeyElsewhere`: the same badge; lines `["Coordinate source: Kraków EMUiA"]`.
  - OSM: `"OSM Fallback"`/`muted`; lines `["Coordinate source: OSM fallback"]`.

  Validator cases: rejects a missing `provenance` and `provenance: "x"`; accepts optional fields absent or `null`; rejects a negative `osm_delta_m`; rejects `osm_position` without `disagreement_m` and the reverse.
- [ ] **Step 2: Run them and confirm they fail.** `cd frontend && npx vitest run src/lib/address-provenance.test.ts src/lib/transport/validate.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass;** `npm run typecheck`.
- [ ] **Step 5: Commit.** `feat: map geocode provenance to incident badges and strip copy`

### Task 8: Badges and provenance strip in `IncidentInput`

**Files:**
- Modify: `frontend/src/components/hud/dispatch/IncidentInput.tsx`
- Create: `frontend/src/components/hud/dispatch/ProvenanceBadge.tsx`, `frontend/src/components/hud/dispatch/AddressProvenanceStrip.tsx`
- Test: `frontend/src/components/hud/dispatch/IncidentInput.test.tsx`; update snapshots (`DispatchForm.snapshot.test.tsx`, driver `presentation-compatibility.test.tsx`, comparison) only where the strip or badges legitimately appear

**Interfaces:**
- Consumes: Task 7 helpers. `IncidentInput` props are unchanged; it reads `incident.address`.

- [ ] **Step 1: Write the failing tests.**
  - Options render label and badge, and an option's accessible name contains both (`getByRole("option", { name: /Floriańska 1.*EMUiA · Verified/ })`).
  - With `incident.address` for a disagreement: `getByRole("status")` has the exact warning text, and the strip shows `Coordinate source: Kraków EMUiA`.
  - A pinned incident (`source: "map"`) shows no strip.
  - The existing no-match status and the error alert still render (both may coexist with `role="status"`; scope the queries by text).
- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run src/components/hud/dispatch/IncidentInput.test.tsx`.
- [ ] **Step 3: Implement.** In the option row, the label takes `min-w-0 truncate` and the badge `shrink-0`. Tone classes are `tone-go`, `tone-caution`, `tone-beacon`, and `text-muted-foreground` for muted. The strip uses `text-2xs` under the input, above "or click the map".
- [ ] **Step 4: Run the full frontend checks;** review snapshot diffs. Only provenance additions are allowed.
- [ ] **Step 5: Commit.** `feat: show EMUiA provenance in incident search`

### Task 9 (optional; drop if time-boxed): OSM ghost marker for disagreements

**Files:**
- Modify: `frontend/src/components/map/EndpointMarkers.tsx` (`MapEndpoint.osmPosition?: Position | null`), `frontend/src/components/dashboard.tsx:127,153` (pass `osmPosition: dispatch.incident.address?.osmPosition ?? null`)
- Create: `frontend/src/components/map/OsmGhostMarker.tsx` (muted dashed marker labelled `OSM position`, plus a dashed GeoJSON line to the incident, following `snap-connectors.ts`)
- Modify: `frontend/src/components/map/MapContainer.tsx:159` (render it next to `IncidentMarker`)
- Test: `frontend/src/components/map/OsmGhostMarker.test.tsx` (pure feature builder: a line from the OSM position to the incident; nothing when `osmPosition` is null)

- [ ] **Step 1:** Write the failing test for `osmGhostFeatures(incident: Position, osm: Position | null): FeatureCollection`. Run it and confirm it fails; implement; run it and confirm it passes.
- [ ] **Step 2:** Run the frontend checks.
- [ ] **Step 3: Commit.** `feat: show OSM ghost position for address disagreements`

## Milestone E: Real data and acceptance (Task 10)

### Task 10: Regenerate on real data and verify

- [ ] **Step 1:** Download `https://msip.um.krakow.pl/Dane/Adresy_JSON.zip` into a fresh scratch directory, unzip it, and copy `Adresy.geojson` and `__Aktualnosc__.txt` into `backend/data/raw/krakow/emuia/`. Run `uv run python scripts/build_manifest.py`, then `--check`.
- [ ] **Step 2:** Re-run the ETL chain from `backend/`: `profile`, `signals`, `graph`, `intersections`, `neighbours`, `places`, `quality` (README order). Each must succeed.
- [ ] **Step 3:** Run `scripts/etl_equivalence.py` twice on unchanged code to confirm determinism (`compare` reports no differences).
- [ ] **Step 4:** Record the reconciliation counts and examples from `etl_report.json`. Sanity: `matched_clean / municipal_total` is about 0.88, and `matched_disagreement` is in the low hundreds. A large deviation needs investigating before continuing (`systematic-debugging`).
- [ ] **Step 5:** Start the backend and frontend; with the `playwright-cli` skill (output under `.tmp/playwright/`), search one example of each class taken from the report. Confirm the badge text, the strip lines, and (Task 9) the ghost marker for a disagreement. Open the Data Quality panel and confirm both checks.
- [ ] **Step 6:** Run the full backend and frontend checks. Commit only the tracked changes: `backend/data/raw/MANIFEST.json` (`chore: add EMUiA addresses to the raw manifest`). Report the counts and the remaining builder's calls to the human.
