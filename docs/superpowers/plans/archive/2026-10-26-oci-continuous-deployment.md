# OCI Continuous Deployment Implementation Plan

> **For agentic workers:** Use executing-plans and test-driven-development in small verified steps.

**Goal:** Deploy tested main commits automatically to the existing Oracle VM.
**Architecture:** CI quality gates → hosted runner SSH → immutable Compose release, with rollback.
**Spec:** `docs/superpowers/specs/2026-10-26-oci-continuous-deployment-design.md`

## Constraints and review focus

- Preserve gitignored configuration/data and Caddy volumes; simulation only.
- Never deploy PRs or obsolete commits; never cancel active deployment on a new main push.
- Pin SSH host keys, pass secrets through environment variables, validate shell boundaries.
- Build failure leaves the active release untouched; activation failure restores prior image tags.
- Remote execution, credentials, OCI firewall and public TLS cannot be proved by local doubles.

## Milestone 1 — Rename, merge and baseline verification

- [x] Rename `codex/oracle-free-deployment` to `feat/oracle-deployment`.
- [x] Fetch origin and preserve its newer main changes before merging the deployment branch.
- [x] Run backend and frontend checks on the merged tree.

## Milestone 2 — Deployment implementation

- [x] Write failing filesystem-based remote deployment tests.
- [x] Add `deploy/remote-deploy.sh` with locking, preflight, release/image isolation and rollback.
- [x] Add optional explicit image names to `compose.production.yaml`.
- [x] Extend `.github/workflows/ci.yml` with deployment test/validation and gated deploy jobs.
- [x] Verify shell syntax, Actions syntax, behavioral tests and existing script tests.

Suggested commit: `ci: deploy tested main commits to Oracle`

## Milestone 3 — Setup guide and final review

- [x] Add `deploy/CI.md` and link from the deployment runbook.
- [x] Document production environment variables/secrets, dedicated key, host-key verification,
  SSH firewall access, enabling deployment, rollback and cleanup.
- [x] Review the whole change, fix material findings, refresh graph, and record verification.
- [x] Commit locally on main; do not push or connect to the live VM.

## Execution record

- The user confirmed `ubuntu` and `~/GreenWave` on the live VM.
- Local main was updated from `origin/main` (`0b7729f`) and merged with the renamed branch.
- Existing CI is retained. A main-only deploy job after its quality checks avoids a second
  privileged workflow_run pipeline and keeps the tested/deployed revision explicit.

- Merged tree verification: backend Ruff lint/format, mypy and 1,304 tests passed; frontend
  lint, typecheck, formatting, 956 tests and production build passed. Generated OpenAPI/types
  were regenerated and confirmed unchanged.
- Deployment tests: 15 filesystem-based tests passed, including build failure, partial activation,
  rollback of manual and automated releases, failed rollback diagnostics/retry, canonical dataset
  preflight boundary, archive permissions, active-release health checks, lock failure and bad input.
- Independent review findings fixed with regression tests observed RED then GREEN: preserve
  source modes under umask077; validate new backend startup before replacing a healthy old
  in-memory service; use recorded current pointer after partial activation; check active health.
- Review also identified default GitHub pending-job replacement. Added documented queue:max with
  cancel-in-progress:false. Current GitHub Context7 docs explicitly support this setting.
- Actionlint passed with a narrow ignore for its outdated schema's unrecognized concurrency.queue
  field; all other workflow/embedded shell checks and standalone ShellCheck passed. This local
  validator cannot verify GitHub's live acceptance before a first workflow push.
- Built ARM64 production backend/frontend from git-archive-extracted source, preserving tracked
  modes. Backend's normal non-root user passed dataset/routing lifespan startup with read-only
  mounts; frontend's normal non-root user returned HTTP200. Temporary container removed.
- bash syntax, test-file Ruff lint/format, existing graphify CI script and git diff checks passed.
  Code graph refreshed after structural additions.
- Ruling: reuse hosted Actions+native SSH; build on the existing ARM64 VM, retaining data/env
  locally. Hosted runner requires inbound SSH; guide explains key-only internet-reachable SSH
  and offers private connectivity as an alternative before enabling. No firewall was changed.
- Ruling: preserve original manual installation as shared configuration/data; automate immutable
  releases underneath it with per-commit image tags, server flock and health-gated rollback.
- No GitHub settings, secrets, live VM, or remote branches were modified. Merge and CI commit
  are local; publishing and first live Actions execution remain human setup steps.
- Existing npm install audit notices (six dependency vulnerabilities) were observed during the
  archive build; no package or lockfile changes were made as part of deployment automation.
