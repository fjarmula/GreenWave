# Oracle Free Deployment Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan in small verified steps.

**Goal:** Prepare a production deployment and an actionable free-hosting runbook.

**Architecture:** One VM runs Caddy, Next.js, and a single FastAPI worker. Data is mounted
read-only; HTTPS and shared demo authentication terminate at Caddy.

**Tech Stack:** Docker Compose, Caddy 2, Node 22, Python 3.12, existing locked dependencies.

**Spec:** `docs/superpowers/specs/2026-10-25-oracle-free-deployment-design.md`

## Global Constraints

- Simulation only; preserve current API contracts and development workflow.
- No cloud provisioning, push, or publication. Work on `codex/oracle-free-deployment`.
- Never commit credentials or GIS artifacts; preserve manifest/data integrity validation.
- One backend worker; current in-memory sessions and shared operation remain unchanged.

## Review Focus

- Missing deployment variables or dataset paths must fail visibly.
- Browser map keys must never be attached to unrelated origins or requests.
- API proxying must retain `/api/` paths and stream SSE promptly.
- Authentication must cover both UI and API, with no direct application ports published.
- Fresh clone and updates must account for gitignored data and build-time public settings.

## Milestone 1: Production stack and map credentials

- [x] Write and run failing tests for CARTO request key handling, foreign origins, and no-key mode.
- [x] Implement CARTO request transformation and wire initial styles and prefetches.
- [x] Add standalone Next.js output and separate production Dockerfiles.
- [x] Add Compose, Caddy, and environment example with required settings and read-only mounts.
- [x] Run frontend checks, build images, and validate Compose/Caddy behavior with current data.

Suggested commit: `feat: prepare production containers and authenticated HTTPS proxy`

## Milestone 2: Runbook and deployment verification

- [x] Write `deploy/README.md` covering accounts through verified launch, updates and recovery.
- [x] Link the runbook from the root README and document the browser map key.
- [x] Verify health, UI auth, dispatch, simulation and SSE through a local proxy.
- [x] Run relevant full checks and refresh the code graph after adding files.
- [x] Obtain a whole-change review and address material findings.
- [x] Record verification and remaining external steps in this plan.

Suggested commit: `docs: add Oracle Always Free deployment runbook`

## Execution record

- Initial checkout clean on `main`; created `codex/oracle-free-deployment` as authorized.
- Execute in the existing checkout on the requested branch; no extra worktree needed.
- Design follows the deployment approach presented in chat and the user's instruction to prepare it.

- Milestone 1 complete: CARTO tests observed RED (6 failures) then GREEN (13 tests).
  Frontend lint, typecheck, formatting and full suite passed: 88 files / 914 tests.
  Docker built both production images for Linux ARM64; frontend `npm run build` passed.
- Backend lint, formatting, mypy and full pytest suite passed: 1,042 tests.
- Milestone 2 complete: local HTTPS proxy checked with a test certificate and synthetic demo
  credentials. UI and API return 401 without credentials; authenticated health returns 200.
  HTTP smoke passed six frontend routes, quality, 40 stations, geocoding, ranking, both modes,
  three individually timed SSE ticks per mode, and comparison stop on both members.
- Playwright CLI browser verification passed address search, start, authenticated native
  EventSource (200 / text/event-stream), and stop. Evidence is gitignored under
  `.tmp/playwright/deployment/`; no DOM/a11y tree was read.
- Configuration checks passed: missing hostname, map key and password hash are rejected;
  only proxy ports are published; mounted data is read-only with no host-path auto-creation;
  both app containers are non-root and healthy, backend has one worker. A backend image
  launched without data fails with MissingArtifactError and the existing ETL instruction.
- Code graph refreshed successfully after adding deployment and map files.
- Independent whole-change review found no blocking implementation issues. Its backup-path
  finding was corrected: backup now derives the active release directory from Compose labels,
  and rollback uses that recorded backup. This avoids backing up stale source after updates.
- Ruling: use the requested branch in the existing clean checkout, shared-password HTTPS and
  a free DuckDNS hostname. No extra worktree, cloud resources or accounts were created.
- Ruling: validate config with rendered Compose/Caddy and real containers instead of adding
  brittle tests that assert configuration source text. Local smoke scripts remain in `.tmp/`.
- External acceptance remains manual after provisioning: Oracle capacity and free eligibility,
  public DNS/ACME certificate issuance, a valid restricted CARTO key, and phone connectivity.
  No cloud deployment or push was performed. Existing session volatility and one shared active
  operation remain unchanged. The Vite config-loader advisory is pre-existing; all tests pass.
