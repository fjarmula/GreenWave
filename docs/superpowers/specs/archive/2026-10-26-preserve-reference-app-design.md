# Preserve the reference application during deployment setup

## Requirement

The application must match commit `0b7729f2005311162ac975d28d9ff4681d793d59`
(rolling junctions, exact estimates and on-site dispatch). The additions relative to that
commit must be deployment/CI infrastructure and its documentation/tests only.

## Finding and correction

The merge retained the reference backend, contracts and simulation/UI fixes. The earlier
deployment branch also changed map requests and attribution and enabled standalone output
globally. Restore all `frontend/src/`, `frontend/next.config.ts` and `frontend/.env.example`
to the reference exactly; remove the extra CARTO helper/test and its unused deployment inputs.
Use Next's standard production server in the Dockerfile rather than changing app configuration.
Keep Dockerfiles, Compose, Caddy, deployment workflow/scripts, data mounts, and SSH setup.

## Verification

Require an empty Git diff against the reference for `backend/src/`, `backend/tests/`,
`frontend/src/`, `contracts/`, Next config, app environment example, package manifests and
lockfiles. Run complete backend/frontend checks, deployment tests, and build/run the production
frontend with the restored source. Do not rewrite history, push, or touch the live VM.
