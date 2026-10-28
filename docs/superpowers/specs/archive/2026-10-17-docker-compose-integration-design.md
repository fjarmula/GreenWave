# Docker Compose local integration design

**Status:** Approved for planning  
**Date:** 2026-10-17

## Intent

Make ER-GreenWave simple and reproducible to run, develop, test, and demonstrate
locally after the existing GIS dataset preparation. A developer or evaluator must be
able to start the full dashboard and simulation stack with:

```bash
docker compose up --build
```

The dashboard is available at `http://localhost:3000`; the API is available at
`http://localhost:8000` for direct debugging and FastAPI documentation. This is a
local development and hackathon-demonstration environment, not a production
deployment design.

## Confirmed goals

- Start the existing FastAPI backend and Next.js dashboard together.
- Use the existing backend HTTP and SSE contract for real-time simulations.
- Enable the dashboard's existing `backend` transport automatically in Compose.
- Keep source edits live through bind mounts and each service's native development
  server reload mode.
- Keep backend raw and processed GIS artifacts outside container images while
  making them available at their existing paths inside the backend workspace.
- Preserve the backend's existing fail-fast dataset validation. Compose must not
  create, synthesize, or silently replace artifacts.
- Provide useful service logs, a backend health check, and focused setup/troubleshooting
  documentation.
- Preserve all existing native `uv` and `npm` workflows as independent alternatives.

## Non-goals and safety boundary

- No production hardening, deployment platform, authentication, TLS, or image
  publishing.
- No database, Redis, message broker, worker, reverse proxy, or new application
  service.
- No Dockerized ETL workflow in the first increment. The user prepares raw and
  processed GIS data with the documented native commands before starting Compose.
- No change to simulation rules, OpenAPI, generated types, routing, telemetry
  framing, or dashboard presentation.
- All traffic-light priority, ITS dispatches, and corridor states remain simulated;
  nothing may actuate real infrastructure.

## Architecture

`compose.yaml` defines exactly two services on Compose's default network:

1. **backend** builds from `backend/` and runs the existing Uvicorn application in
   reload mode, listening on `0.0.0.0:8000`. It binds the backend source directory
   at the container worktree so code and local GIS directories are visible without
   being copied into the image. It retains the existing default data paths
   (`data/processed` and `data/raw/MANIFEST.json`) and CORS origin
   `http://localhost:3000`.
2. **frontend** builds from `frontend/` and runs `next dev`, listening on
   `0.0.0.0:3000`. It binds the frontend source directory for hot reload and sets
   `NEXT_PUBLIC_SIMULATION_TRANSPORT=backend` and
   `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`.

The backend publishes `8000:8000`; the frontend publishes `3000:3000`. Browser
JavaScript must use `localhost:8000`, not the Compose service hostname `backend`,
because that hostname only resolves from containers. The frontend waits for the
backend health check before it starts. The health endpoint becomes available only
after the backend lifespan has loaded and validated the precomputed dataset.

Compose output is the primary demo log surface (`docker compose up`); the documented
operations include `docker compose logs -f`, `docker compose ps`, and orderly
shutdown. The containers do not require shell access for normal use.

## Dependency and data lifecycle

Dockerfiles cache dependency installation from the committed `backend/uv.lock` and
`frontend/package-lock.json`. At runtime, named volumes retain the backend virtual
environment/cache and frontend `node_modules` across restarts. The service startup
commands synchronize against their lockfiles before starting the reload server, so a
lockfile change is applied without relying on a stale volume and ordinary source
edits do not require an image rebuild.

The ignored `backend/data/raw/` and `backend/data/processed/` directories remain on
the host under the backend bind mount. They are deliberately excluded from image
contexts. Setup documentation continues to direct users to obtain the approved raw
bundle, validate the manifest, and run the existing ETL sequence natively. If data
are missing, stale, or inconsistent, backend startup must fail with its existing
actionable error rather than falling back to mock data.

## Trade-offs and decisions

| Decision | Chosen approach | Reason |
| --- | --- | --- |
| Browser-to-API connection | Published API port plus existing explicit CORS | It preserves ADR 0003 D21 and avoids an SSE-buffering proxy. |
| Runtime mode | Compose development mode only | It optimizes local feedback and demonstrations; a production image is out of scope. |
| Dataset delivery | Host bind mount, never image layer | GIS artifacts stay large, mutable, uncommitted, and integrity-validated. |
| Dependency persistence | Named service-local volumes | Reload stays fast without coupling host Python/Node installations to containers. |
| Startup ordering | Backend health check gates frontend | Users get an explicit backend-data failure instead of a dashboard racing an unready API. |
| Configuration | Safe Compose defaults, no required `.env` | The one-command path stays simple; existing environment settings remain available for debugging. |

Rejected alternatives: a Next.js rewrite proxy conflicts with the accepted SSE decision; an
in-container ETL adds scope and duplicates native setup; additional infrastructure has no
current architectural need.

## Expected documentation and verification

The root README gains a Docker Compose quick-start after dataset preparation, expected
URLs, development reload behavior, logs/teardown commands, and a statement that native
commands remain supported. Service-specific READMEs point to the Compose workflow where
useful without duplicating data-pipeline authority.

The implementation must verify configuration parsing, image builds, clean startup with a
prepared dataset, dashboard-to-backend start/stream behavior including SSE, source reload
where practical, logs, and failure behavior when artifacts are absent. It must run the
affected existing backend and frontend quality checks without modifying generated API
artifacts.
