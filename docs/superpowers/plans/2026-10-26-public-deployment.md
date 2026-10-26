# Public Deployment Fix Plan

1. Confirm login-removal commit, failed CI and rollback/current HTTP401.
2. Reproduce failing public200 acceptance; add negative401,503andinvalid-health tests.
3. Fix probes and remove unused proxy login configuration and documentation.
4. Run deployment tests, workflow/shell checks, Compose validation and reference identity audit.
5. Activate prepared1d31fc1 release with corrected script; verify public site/API200.
6. Review and commit locally without pushing.

## Evidence

- Initial checkout clean at1d31fc1. GitHub run40309530743failed; VM current pointer restored
  db5aab7, with healthy containers but public site401. Prepared1d31fc1 release exists.

## Completion

- Public200 fixture observed RED against obsolete401 probe; corrected probe passes20tests.
  Regressions cover401,503,invalidJSON/HTML and non-ok health status, with rollback preserved.
- Removed unused DEMO variables and commented auth block; updated active setup guides.
  Compose config passes with onlyDOMAIN/ACME_EMAIL. Caddy validates without app credentials.
- ShellCheck, Bash syntax, test-file Ruff lint/format and workflow Actionlint pass (documented
  narrowignore for concurrency.queue in localvalidator). gitdiffchecks pass. Appsource remains
  identical to0b7729f. Independent reviewer found no actionable issues; graph refreshed.
- Live recovery: uploaded correctedscript and deployed the already-published1d31fc1 release.
  Canonical dataset/router preflight and all service healthchecks passed. HTTPS homepage/API
  return200 without credentials; healthJSONstatus=ok. Fresh no-credentials Playwright context
  opensER-GreenWave. Existing data, certificate volumes and stored config were preserved.
- Future deployments need this correction pushed; no GitHub/source push was performed.
