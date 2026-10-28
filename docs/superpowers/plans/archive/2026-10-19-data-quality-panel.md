# Data Quality Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Summarise existing ETL diagnostics into `data_quality.json`, serve it at `GET /api/v1/dataset/quality`, and show it in a collapsed dashboard panel.

**Architecture:** A new ETL step `quality` reads processed outputs (including those from the road-attributes and signal-detail plans) and writes a deterministic summary validated by a Pydantic model that is also the API response. The loader requires and hash-checks the file like `neighbours` artifacts. The frontend fetches it once and renders it in a HUD panel; mock mode shows a fixed notice.

**Tech Stack:** Python 3.12, polars, pydantic, FastAPI; Next.js, TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-data-quality-panel-design.md`

**Prerequisites:** `docs/superpowers/plans/2026-10-19-road-attributes.md` Tasks 1–8 and `docs/superpowers/plans/2026-10-19-signal-corridor-detail.md` Tasks 1–3 merged (this plan reads `bus_lane_crosscheck.csv`, the `road_attributes` report section and `intersections.needs_review`).

## Global Constraints

- Response carries `schema_version: "1.0"` and `is_simulated: true`.
- Status values: `pass | info | warn`, rules exactly as the spec table; no new thresholds (reuse `STREET_LENGTH_RATIO_RANGE`, `ROUTE_DETOUR_RATIO_RANGE` from `etl/config.py`).
- ≤ 5 samples per check; file target < 50 KB.
- Output is deterministic: no wall-clock timestamps.
- Fixed copy: footer "Checks describe the source data used by the simulation. They do not verify physical signal states."; mock notice "Available when connected to the simulation backend."
- Contract regeneration: `cd backend && uv run python scripts/export_openapi.py && cd ../frontend && npm run generate:types`.
- Backend and frontend checks as in `AGENTS.md`. Commit subjects `<category>: <message>`; stage explicit paths only.

## Review Focus

1. `bus_lane_crosscheck.csv` present but empty (0 rows) → check renders with zero counts, status `info`, no crash. Test in Task 1.
2. `data_quality.json` left from an older ETL run (stale `consumed_sha256`) → server startup fails naming `run_etl.py quality`. Test in Task 2.
3. Endpoint returns 5xx or network error → panel shows one error line; map and dispatch keep working. Test in Task 4.
4. Unicode street names (Polish diacritics) in samples survive JSON round-trip unchanged. Test in Task 1.
5. Running `quality` twice on the same inputs yields byte-identical files. Test in Task 1.

---

### Task 1: `quality` ETL step

**Files:**
- Create: `backend/src/greenwave/etl/quality.py`, `backend/src/greenwave/schemas/dataset_quality.py`
- Modify: `backend/src/greenwave/schemas/__init__.py` (export), `backend/src/greenwave/artifacts.py` (`QUALITY_FILENAME = "data_quality.json"`), `backend/scripts/run_etl.py` (step `quality`, writes report section `quality` with `consumed_sha256` and `artifact_sha256`), `backend/README.md` (step list: run after `neighbours`)
- Test: `backend/tests/etl/test_quality.py`

**Interfaces:**
- Produces (Pydantic, in `schemas/dataset_quality.py`):
  - `QualityStatus(StrEnum)`: `PASS="pass"`, `INFO="info"`, `WARN="warn"`.
  - `QualityCheck(id: str, title: str, status: QualityStatus, headline: str, metrics: dict[str, float], samples: list[str] = Field(max_length=5))`.
  - `QualitySource(path: str, source: str, licence: str, attribution: str, retrieved_on: str)`.
  - `DatasetQualityResponse(schema_version: SchemaVersion, is_simulated: Literal[True], manifest_sha256: str, msip_export_timestamp: str | None, checks: list[QualityCheck], sources: list[QualitySource])`.
- Produces (`etl/quality.py`): `build_quality(processed_dir: Path, raw_dir: Path, manifest: Manifest) -> DatasetQualityResponse` and `write_quality(summary: DatasetQualityResponse, processed_dir: Path) -> str` (returns sha256; JSON with `ensure_ascii=False`, sorted keys, 2-space indent). Check ids and order exactly as the spec table.

- [ ] **Step 1: Write failing tests** with a synthetic processed dir from `tests/support/processed.py` plus small CSV/GeoJSON fixtures: one test per check id asserting status rule boundaries (e.g. tertiary-plus 0 rows → `info`, 1 row → `warn`; all detours inside range → `pass`, one outside → `warn`); `test_empty_bus_lane_crosscheck_is_info_with_zero_counts` (RF1); `test_polish_diacritics_round_trip` (RF4); `test_quality_output_is_byte_identical_across_runs` (RF5); `test_samples_capped_at_five`; `test_msip_timestamp_parsed_from_aktualnosc` (`"Data wygenerowania plików: 2026-10-13_00:47:34"` → `"2026-10-13 00:47:34"`).
- [ ] **Step 2: Run** `cd backend && uv run pytest tests/etl/test_quality.py -v` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `uv run pytest tests/etl -v` → PASS.
- [ ] **Step 5: Commit** `feat: add quality ETL step summarising data checks`.

### Task 2: Load and serve the summary

**Files:**
- Create: `backend/src/greenwave/api/dataset.py` (router `prefix="/api/v1/dataset"`, tag `dataset`)
- Modify: `backend/src/greenwave/dataset/constants.py` (`PRODUCED_BY[QUALITY_FILENAME] = "quality"`, command text), `backend/src/greenwave/dataset/loader.py` and `models.py` (validate file as `DatasetQualityResponse`; `QualitySection` with `consumed_sha256` checked against current artifacts as `NeighboursSection` does; `ProcessedDataset.quality: DatasetQualityResponse`), `backend/src/greenwave/main.py` (include router), `contracts/openapi.json` + `frontend/src/types/api.generated.ts` (regenerated only), `backend/tests/support/processed.py` (fixture writes a minimal valid quality file)
- Test: `backend/tests/dataset/test_loader.py`, `backend/tests/api/test_dataset_api.py`

**Interfaces:**
- Produces: `GET /api/v1/dataset/quality` → 200 `DatasetQualityResponse` (the loaded object, unchanged); registered in OpenAPI with `response_model`.

- [ ] **Step 1: Write failing tests**: `test_loader_requires_quality_file` (message names `run_etl.py quality`); `test_loader_rejects_stale_quality_section` (RF2); `test_get_dataset_quality_returns_loaded_summary`; `test_openapi_registers_dataset_quality`.
- [ ] **Step 2: Run** `uv run pytest tests/dataset tests/api -v` → FAIL.
- [ ] **Step 3: Implement**; regenerate contracts.
- [ ] **Step 4: Run** backend checks → PASS.
- [ ] **Step 5: Commit** `feat: serve dataset quality summary` (include regenerated contract files).

### Task 3: Frontend transport for the summary

**Files:**
- Create: `frontend/src/lib/transport/dataset-quality.ts`
- Modify: `frontend/src/lib/transport/validate.ts` (add `validateDatasetQuality(body: unknown): DatasetQualityResponse`)
- Test: `frontend/src/lib/transport/dataset-quality.test.ts`, `frontend/src/lib/transport/validate.test.ts`

**Interfaces:**
- Consumes: generated `DatasetQualityResponse` type; `apiBaseUrl` from `frontend/src/lib/config.ts`.
- Produces: `fetchDatasetQuality(apiBaseUrl: string, signal?: AbortSignal): Promise<DatasetQualityResponse>`; throws the existing transport error type from `transport/errors.ts` on non-200 or validation failure.

- [ ] **Step 1: Write failing tests**: success with a fixture body; non-200 → transport error; body with `is_simulated: false` → validation error; unknown `status` value → validation error.
- [ ] **Step 2: Run** `cd frontend && npm test -- dataset-quality validate` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: add dataset quality transport`.

### Task 4: Data quality panel

**Files:**
- Create: `frontend/src/components/hud/DataQualityPanel.tsx`
- Modify: the HUD composition that renders `RunSummary`/`ItsConsole` (locate with `graphify query "ItsConsole"`; likely `frontend/src/components/dashboard.tsx`)
- Test: `frontend/src/components/hud/DataQualityPanel.test.tsx` (+ snapshot), dashboard snapshot update

**Interfaces:**
- Consumes: `fetchDatasetQuality` (Task 3); current mode (mock vs backend) from the simulation provider.
- Produces: `DataQualityPanel` props `{ mode: "mock" | "backend"; apiBaseUrl: string }`. Collapsed by default (`<details>` or the project's disclosure pattern); fetches on first expand, once. Renders per check: title, status label (text, not colour alone), headline, up to 4 metrics; then sources with attribution and the MSIP timestamp; then the fixed footer.

- [ ] **Step 1: Write failing tests**: collapsed by default and no fetch until expanded; mock mode shows the fixed notice and never fetches; fetch error shows one error line while sibling components still render (RF3); success renders every check title and the footer text exactly.
- [ ] **Step 2: Run** `npm test -- DataQualityPanel` → FAIL.
- [ ] **Step 3: Implement**, following `docs/engineering/frontend-dashboard.md` and `frontend/AGENTS.md`.
- [ ] **Step 4: Run** frontend checks → PASS.
- [ ] **Step 5: Commit** `feat: add data quality panel to dashboard`.

### Task 5: Real-data run and end-to-end check

- [ ] **Step 1: Rebuild** `cd backend && uv run python scripts/run_etl.py quality`; confirm `data/processed/data_quality.json` < 50 KB; run it again and `cmp` the two outputs → identical.
- [ ] **Step 2: Start** backend and frontend (`run` skill or README commands); with the playwright-cli skill, expand the panel and screenshot to `.tmp/playwright/` → all seven checks and the footer visible; then stop the backend and reload → panel error line, rest of dashboard usable.
- [ ] **Step 3: Verify** full backend and frontend checks → PASS.
- [ ] **Step 4: Commit** any README touch-ups as `docs: document quality step and panel`.
