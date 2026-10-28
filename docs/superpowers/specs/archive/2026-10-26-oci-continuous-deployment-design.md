# OCI continuous deployment

## Intent

After every successful CI run for a push/merge to main, deploy the exact tested commit to
the existing Ubuntu VM. The existing app is installed under `/home/ubuntu/GreenWave`.
Keep the processed dataset, raw manifest, demo credentials and Caddy certificate volumes.
Application source/config must match reference `0b7729f`; see
`2026-10-26-preserve-reference-app-design.md` for the packaging-only correction.

## Design and acceptance

- Extend the existing CI Pipeline with a deployment job requiring all quality jobs.
- Only main push events deploy, gated by repository variable `OCI_DEPLOY_ENABLED=true`.
  PR code never receives deployment credentials. Use the `production` GitHub environment.
- Use a GitHub-hosted Ubuntu runner, native SSH/SCP, a dedicated SSH key and pinned known_hosts.
  SSH access requires an OCI ingress rule permitting the runner's connection; document this
  explicitly because the initial guide permits only the administrator's IP.
- Skip obsolete tested commits if main has already advanced. Serialize deployments and do not
  cancel an in-progress main deployment when another push arrives.
- Upload a git archive of the tested commit, never a local environment file or GIS data.
- Create immutable release directories under the existing installation, linking its configuration
  and dataset. Build uniquely tagged images before changing the running service.
- Validate configuration; wait for app health and check public HTTPS authentication. On activation
  failure restore the previous Compose release with its original images. Report failure even if
  rollback succeeds. Fail before modifying services if config/data are missing.
- Test release activation, build failure, rollback, missing inputs, repeat deployment and locking
  using real filesystem effects with doubles only for external Docker/sudo/curl commands.
- Document one-time server/key/network/GitHub setup, first push, logs, disablement, manual
  rollback and disk retention. No cloud or GitHub account settings are changed by this task.

## Scope

No schema, application behavior, real signal actuation, ETL, container registry, self-hosted
runner, new service dependency or automatic data replacement. The renamed deployment branch
is merged into local main as requested; pushing remains a separate human action.
