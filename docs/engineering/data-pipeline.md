# Data pipeline constraints

## Scope and integrity

- Prepare Kraków road-network data for simulation only. Never connect to or control live infrastructure.
- Preserve CRS, source provenance, and deterministic identifiers throughout each stage.
- Treat raw inputs as immutable. Write derived data only to defined outputs; do not overwrite source datasets.
- Validate schema, geometry validity, topology, and required attributes at every boundary. Fail clearly for invalid or incomplete inputs.
- Keep transformations deterministic and idempotent. Record source version, parameters, and generation time with produced artifacts.
- Test representative fixtures, malformed geometry, and missing attributes.
- Do not commit large raw datasets, credentials, or restricted location data.

## Contract and decision provenance

Pydantic schemas remain canonical; regenerate OpenAPI and frontend types after contract changes. Operational values in `backend/src/greenwave/etl/config.py` are labeled as approved, analysis-only, or placeholder. Their source comments and accepted ADRs are the decision record; do not infer additional thresholds.

`backend/README.md` is the operational reference for ETL commands, artifacts, sources, attribution, and startup prerequisites. Snapshot-baseline checks are defined next to the code that evaluates them, not in this document.
