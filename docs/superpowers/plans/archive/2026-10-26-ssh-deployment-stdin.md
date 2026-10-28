# SSH Deployment Stdin Fix Plan

**Spec:** `docs/superpowers/specs/2026-10-26-ssh-deployment-stdin-design.md`

1. Reproduce matching scenarios locally/live and record start responses and SSE under
   `.tmp/playwright/intersection-comparison/`.
2. Inspect deployed release/image state without printing secrets.
3. Add a failing streamed-bash stdin-drain regression, fix command input and SSH invocation.
4. Run deployment tests, shell/workflow validation, and ensure reference app source unchanged.
5. Validate and activate existing published app images without changing live proxy policy.
6. Repeat browser comparison, review the fix, and commit locally without pushing.

## Evidence

- Local and live datasets/routes match in the reproduced scenario; live API/package is older.
- GitHub main is e621e43; its Actions deployment job is green. The VM's active backend image
  is greenwave-backend:latest from the manual setup, not either prepared commit-tagged image.
- Live VM, reached with the existing dedicated key and pinned IP host key, contains both
  prepared release folders and image tags but no current symlink.

## Resolution and verification

- Two new streamed-bash regressions observed RED: preflight drained remaining commands,
  returned exit0 and never changed active state; even a configured activation failure was hidden.
  Redirecting Compose stdin to/dev/null makes both GREEN;17deployment tests pass.
- Workflow now uploads the script separately and invokes bash on that file with ssh-n.
  No script code shares stdin with subprocesses. Independent review reproduced the original
  failure and found no actionable issues in the correction.
- Actionlint passed (same narrow compatibility ignore for documented concurrency.queue);
  ShellCheck, bash syntax, Ruff test lint/format, existing graphify CI check and git diff checks pass.
- Backend full checks pass:1,304tests, lint, format, mypy. Frontend full checks pass:943tests,
  lint, typecheck, formatting and production build. App source/config/contracts remain byte-identical
  to reference0b7729f; no simulation or frontend motion logic was changed.
- Live recovery used the already-published/built e621e43 backend and frontend images, validated
  canonical dataset/routing startup first, and replaced only those two services. Existing proxy
  retained its two-hour uptime; data, credentials and certificate volumes were untouched. Both
  app containers healthy;current points to the published e621e43 release.
- Browser re-test: enabled mode124/124ticks match local exactly in tick, position, speed and status;
  no zero-speed intersection ticks. Standard mode144/144ticks match local exactly as well.
  Before/after evidence is under.tmp/playwright/intersection-comparison/ (gitignored).
- Code graph refreshed. No source push was performed. Commit the CI fix locally; it must be
  pushed to install the corrected workflow for future automatic deployments. Live app repair
  is already applied using the existing published reference release.
