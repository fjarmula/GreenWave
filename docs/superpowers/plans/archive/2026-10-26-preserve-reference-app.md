# Preserve Reference App Implementation Plan

**Spec:** `docs/superpowers/specs/2026-10-26-preserve-reference-app-design.md`

1. Audit the merge against reference `0b7729f`; identify all application changes.
2. Restore reference frontend source/config; keep all existing simulation and dispatch behavior.
3. Adapt only production packaging and remove unused map-key deployment requirements/docs.
4. Verify reference identity, full app checks, deployment tests, and production image startup.
5. Review and commit the correction without pushing or altering live deployment.

## Execution

- Initial tree clean on main at `3ac7625`.
- Before correction, reference comparison returned nonzero because the deployment branch
  added CARTO request/attribution changes and standalone Next configuration.
- Backend source and schemas, generated contracts, simulation logic, estimate and on-site
  UI code already matched the reference; no evidence that those fixes were lost by merging.

- Corrected app/config and removed map helper/tests; no baseline app tests were changed.
- Git comparison against0b7729f is empty for all app source/tests, contracts, app config,
  environment example, dependency manifests and lockfiles. Across frontend/backend/contracts
  the only remaining net differences are production Dockerfiles and .dockerignore files.
- Updated active guides/environment template/Compose to remove unused CARTO key requirements;
  marked superseded standalone/map design as historical without rewriting Git history.
- All backend checks passed (Ruff lint/format, mypy,1,304pytest tests). All frontend checks
  passed (lint,typecheck,formatting,943tests and build). The13removed tests belonged only
  to the extra map-key behavior being removed; the reference test tree is unchanged.
- Deployment behavioral suite:15/15pass. Production frontend Docker build passed; runtime
  smoke passed six routes and14static assets under the normal non-root user.
- Independent review confirmed reference identity and infrastructure-only net differences,
  with no actionable findings. Code graph refreshed; git diff --check passed.
- No live VM or GitHub changes/push. Save as an additive correction commit on local main.
