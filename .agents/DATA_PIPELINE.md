
# Data pipeline operational constraints

- Scope: prepare Kraków road-network data for simulation only. Never connect to or control live infrastructure.
- Preserve CRS, source provenance, and deterministic identifiers through every pipeline stage.
- Treat raw inputs as immutable. Write derived data to the defined output locations; do not overwrite source datasets.
- Validate schema, geometry validity, topology, and required attributes at each boundary. Fail clearly on invalid or incomplete input.
- Keep transformations deterministic and idempotent. Record source version, parameters, and generation time with produced artifacts.
- Keep Pydantic schemas in `backend/src/greenwave/schemas/` canonical. Regenerate OpenAPI and frontend types after schema changes.
- Test transformations with representative fixtures, including malformed geometry and missing attributes.
- Do not commit large raw datasets, credentials, or location data with restricted handling requirements.
