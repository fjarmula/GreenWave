# Docker Compose Local Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Provide one-command Docker Compose startup for the existing FastAPI backend and Next.js dashboard with direct HTTP/SSE integration, local reload, and host-managed GIS artifacts.

**Architecture:** A root compose.yaml runs only backend and frontend development services. Focused Dockerfiles cache lockfile-based dependencies, source bind mounts enable reload, and named volumes retain service dependencies. The browser calls the published backend port directly under the existing CORS contract; frontend startup waits for the backend health endpoint after GIS validation.

**Tech Stack:** Docker Compose, Docker BuildKit, Python 3.12, uv, FastAPI/Uvicorn, Node.js 22, npm, Next.js 16, existing HTTP/SSE contract.

**Spec:** docs/superpowers/specs/2026-10-17-docker-compose-integration-design.md

## Global Constraints

- Local development and hackathon demonstration support only; no production deployment design.
- Exactly two application services: the existing FastAPI backend and Next.js frontend.
- No database, Redis, queue, worker, reverse proxy, Dockerized ETL, or dependency.
- Preserve ADR 0003 D21: no Next.js rewrite proxy; browser traffic uses http://localhost:8000 and the existing explicit CORS allow-list.
- Keep raw and processed GIS data out of image layers; retain existing host paths and fail-fast dataset validation.
- Keep traffic-priority and signal states simulated; never add real actuation.
- Preserve native uv and npm workflows, API contracts, and generated artifacts unchanged.
- Do not commit, create or switch branches, push, or open a pull request.

## Review Focus

- Missing or stale processed artifacts must make the backend unhealthy and log the existing actionable error, never select mock data; Task 2.
- Browser configuration must use http://localhost:8000, never http://backend:8000, for HTTP and SSE; Task 2.
- An updated lockfile must synchronize dependencies despite an existing named volume; Task 1.
- SSE must stream directly through the backend port; Task 2.
- Source edits must trigger Uvicorn and Next reload without rebuilding images; Task 2.

---

## File Structure

- Create: backend/Dockerfile — Python 3.12/uv development image, isolated from its bind mount.
- Create: backend/.dockerignore — excludes virtual environments, caches, and GIS data from the build context.
- Create: frontend/Dockerfile — Node 22 development image installed from package-lock.json.
- Create: frontend/.dockerignore — excludes dependencies, generated output, and local configuration.
- Create: compose.yaml — service runtime, mounts, volumes, ports, variables, health check, and ordering.
- Modify: README.md — data-first Compose setup, troubleshooting, and native-workflow preservation.

### Task 1: Build contexts and development images

**Files:**
- Create: backend/Dockerfile
- Create: backend/.dockerignore
- Create: frontend/Dockerfile
- Create: frontend/.dockerignore

**Interfaces:**
- Consumes: backend/pyproject.toml, backend/uv.lock, frontend/package.json, and frontend/package-lock.json.
- Produces: images that run locked uv and npm synchronization in their mounted worktrees.

- [ ] **Step 1: Write failing build-context checks**

Create minimal placeholder Dockerfiles and ignore files, then run:

~~~bash
docker build --file backend/Dockerfile backend
docker build --file frontend/Dockerfile frontend
~~~

Expected: FAIL; placeholders cannot install locked dependencies or provide the development runtime.

- [ ] **Step 2: Implement backend image and context filter**

Use a Python 3.12 Debian-compatible uv base. Copy only pyproject.toml and uv.lock before installing locked development dependencies, configure the virtual environment outside the source bind mount, then copy source for an image usable without the mount. Exclude .venv, Python/test caches, and data/raw and data/processed; retain the committed raw manifest and sources.

- [ ] **Step 3: Implement frontend image and context filter**

Use Node 22. Copy package.json and package-lock.json before npm ci, then copy frontend source. Exclude node_modules, .next, local env files, test output, and TypeScript build info. Keep installed modules at the eventual mount target so Docker initializes a new named volume.

- [ ] **Step 4: Verify image builds**

Run the two docker build commands from Step 1.

Expected: PASS; both images build from lockfiles without copying host dependencies or GIS artifacts.

- [ ] **Step 5: Verify lock synchronization is idempotent**

After Task 2 starts services, run each service synchronization command twice through Compose.

Expected: PASS; the second run reuses named dependencies while checking the committed lockfile, without rebuilding application images.

### Task 2: Two-service Compose runtime

**Files:**
- Create: compose.yaml

**Interfaces:**
- Consumes: Task 1 images, backend /api/v1/health, existing GREENWAVE and NEXT_PUBLIC settings, and host backend/data.
- Produces: docker compose up --build exposing dashboard http://localhost:3000 and API http://localhost:8000.

- [ ] **Step 1: Write a failing Compose configuration check**

Create a minimal compose.yaml with no application services, then run:

~~~bash
docker compose config
~~~

Expected: FAIL or prove that required backend and frontend services are absent.

- [ ] **Step 2: Define backend**

Build from backend; bind mount ./backend at its worktree; publish 8000:8000; set GREENWAVE_CORS_ORIGINS=http://localhost:3000; and persist a dedicated uv cache and project virtual-environment volume. Its command runs uv sync --locked --all-groups, then uvicorn greenwave.main:app --host 0.0.0.0 --port 8000 --reload. Add a Python-standard-library health check for /api/v1/health with an explicit dataset-load start period and retry budget.

- [ ] **Step 3: Define frontend**

Build from frontend; bind mount ./frontend; publish 3000:3000; and retain /workspace/node_modules in a named volume. Its command runs npm ci, then npm run dev -- --hostname 0.0.0.0. Set NEXT_PUBLIC_SIMULATION_TRANSPORT=backend and NEXT_PUBLIC_API_BASE_URL=http://localhost:8000. Depend on backend service_healthy. Do not use the internal hostname in public configuration and do not add a proxy or third service.

- [ ] **Step 4: Verify resolved configuration**

Run:

~~~bash
docker compose config
~~~

Expected: PASS; two services, named dependency volumes, source bind mounts, ports 3000/8000, direct localhost API configuration, and backend health gating are present.

- [ ] **Step 5: Verify prepared-data startup and simulation streaming**

With the documented raw bundle and generated artifacts present, run:

~~~bash
docker compose up --build --wait
curl --fail http://localhost:8000/api/v1/health
~~~

Open the dashboard and run a backend simulation to its terminal SSE event.

Expected: PASS; both services are healthy and the existing HTTP start plus 1 Hz named SSE events work without manual networking settings.

- [ ] **Step 6: Verify failure, logs, and reload**

Start with invalid or missing processed artifacts, inspect docker compose logs backend, then restore prepared data. Make harmless temporary source edits in each bind mount and inspect service logs.

Expected: invalid data produces the existing artifact-specific failure without a mock fallback; restoration succeeds; Uvicorn and Next report normal reload without docker compose build.

- [ ] **Step 7: Verify shutdown**

Run docker compose down.

Expected: PASS; containers and the network stop while named dependency volumes remain. Normal docs must not use down --volumes.

### Task 3: Document the local workflow

**Files:**
- Modify: README.md

**Interfaces:**
- Consumes: exact Task 2 behavior and the existing native dataset preparation instructions.
- Produces: a newcomer-facing data-first Compose workflow that does not replace native commands.

- [ ] **Step 1: Write the documentation acceptance checklist**

Require: Docker Compose prerequisite; raw bundle and native ETL prerequisite; one-command startup; dashboard/API URLs; simulated-only boundary; live-reload behavior; logs; teardown; and continued native workflow support.

- [ ] **Step 2: Add the root README Compose quick start**

Place a concise Run with Docker Compose section immediately after data preparation. Include docker compose up --build, URLs, docker compose logs -f backend, and docker compose down. State that GIS artifacts stay host-managed and excluded from images and backend startup refuses missing/stale artifacts. Explain that down --volumes clears only dependency caches, not host GIS data.

- [ ] **Step 3: Preserve native commands**

Keep all current uv and npm instructions unchanged. Add one sentence saying Compose is optional and native subsystem README commands remain authoritative.

- [ ] **Step 4: Verify the README walkthrough**

Follow the new sequence in a clean Docker environment after preparing data.

Expected: all prerequisites, commands, URLs, expected failures, logs, and shutdown actions are complete; no production, download automation, or real-signal claim is implied.

### Task 4: Focused and regression verification

**Files:**
- Modify: none expected unless verification finds a concrete defect.

**Interfaces:**
- Consumes: Tasks 1–3 and existing quality tooling.
- Produces: evidence that Compose support does not alter native quality or contracts.

- [ ] **Step 1: Run Compose checks**

~~~bash
docker compose config
docker compose build
~~~

Expected: PASS; no GIS data enters an image context and no unrequested service exists.

- [ ] **Step 2: Run backend regression checks**

~~~bash
cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest
~~~

Expected: PASS; simulation, dataset validation, HTTP, and SSE behavior remain unchanged.

- [ ] **Step 3: Run frontend regression checks**

~~~bash
cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build
~~~

Expected: PASS; frontend remains independently buildable and contract-compatible.

- [ ] **Step 4: Review final scope**

~~~bash
git diff --check
git status --short
~~~

Expected: no whitespace errors, generated contract drift, data artifacts, secrets, or changes outside planned Docker/documentation files.

## Self-review

- **Spec coverage:** Tasks 1–2 deliver two services, direct CORS/SSE, host data, dependencies, logs, health ordering, and reload. Task 3 documents setup while retaining native paths. Task 4 covers Compose and regression evidence.
- **Step scan:** Each step identifies a file, exact command, fixed configuration value, or observable runtime outcome.
- **Type consistency:** Only existing public names are used: GREENWAVE_CORS_ORIGINS, NEXT_PUBLIC_SIMULATION_TRANSPORT, NEXT_PUBLIC_API_BASE_URL, /api/v1/health, backend, and frontend.
- **Review focus:** Every listed risk has a Task 1 or Task 2 test/verification step.
- **Proportion:** This supplies decisions and acceptance behavior, not a verbatim implementation.
