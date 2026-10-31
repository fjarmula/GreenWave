# Prepare a future evaluation snapshot

Do not recreate submission until the post-fix experiment results have been reviewed and main finalized. Never merge the old submission into main. This directory, experiments, their tests/docs and local archives are main-only; remove them from the future snapshot using `remove-paths.json`.

## Preserved evidence

`archive/refs.json` records exact original tips, clean starting worktree, absolute bundle location and SHA-256. The bundle contains complete submission history; verify with `git bundle verify <path>` and `git bundle list-heads <path>`. To inspect later without recreating a branch: `git show 10537bd0973d77fb09317bee08c9043cd1e372ee:README.md`. A bundle can also be cloned into a separate directory for recovery.

`archive/deleted-files.txt` is the exact old deleted-file inventory; `archive/modifications.patch` is every old modified-file diff. `archive/README.submission.md` is archival evidence only. No application source, data, Docker, CI or contract files differed between the original tips.

## Recipe (apply only to a newly authorized snapshot of finalized main)

1. Start from finalized main in a separate clean checkout. Record its revision and current tracked-file hashes. Copy this preparation directory outside that checkout before removing it.
2. Remove precisely the metadata roots/files in `remove-paths.json`, including this preparation directory and maintained experiment code/docs/tests. Review new development metadata added since this manifest was written; do not delete application code by pattern. Ignored caches (`.tmp/`, `graphify-out/`, `.superpowers/`, `.playwright-cli/`) and local archives must not be added to the snapshot.
3. Adapt the documentation/hook/test edits in `archive/modifications.patch` to the CURRENT files. Do not apply the patch blindly: it is a reference, not an overwrite script. Remove graphify post-checkout/post-merge/post-rewrite installation and its hook entry from `.pre-commit-config.yaml`; keep all quality hooks. Remove agent readiness/setup/graph refresh instructions. Point backend/frontend contributor links at CONTRIBUTING.md. Remove ADR 0002/0004 index rows and replace links to removed internal specs with a short omitted-from-evaluation explanation. Preserve all current behavioral explanations, particularly the corrected motion model.
4. Adapt `test_agent_cleanup.sh` to assert metadata absence, evaluator notice presence and protected files. Agent-only setup/graphify shell tests should explicitly skip when metadata is absent, as in the archived patch. Keep application tests, not just a cleanup test. Remove links to experiment material that will no longer be present.
5. Read the CURRENT README.md. Insert the exact paragraph in `evaluator-notice.md` immediately after `<h1 align="center">ER-GreenWave</h1>` and before the centered description, with blank lines. Fail for review if this anchor changed or a notice already exists. Preserve every other byte of the current README. Never restore `archive/README.submission.md` over it. The historical notice's “production-ready” wording describes review presentation; the application remains simulation-only.

## Verification checklist

- Inspect `git diff --name-status` against finalized main: deletions must be in the manifest (or individually reviewed new metadata), modifications must be justified presentation/hook/test adjustments.
- Hash-compare all application source (`backend/src`, `frontend/src`), raw/processed datasets and manifests, contracts and generated types, Dockerfiles, compose files, deployment scripts and `.github/workflows` against finalized main. All must be identical. No real controller integration.
- Preserve every application test and fixture. Only agent-only shell-test adjustments above are expected. Verify application test hashes as well.
- Confirm evaluator notice occurs once, in the stated location, and removing the inserted paragraph restores the CURRENT source README exactly.
- Search retained documentation/configuration for dangling references to removed metadata and experiments. Check README setup instructions and existing data attribution/license content.
- Run full backend/frontend quality checks, shell tests, contract drift check and the existing browser smoke workflow. Review all skips: only metadata-only tests may skip.
- Ensure no archives, experiment tooling/results, agent configuration or ignored files entered the snapshot. Review the final staged diff before committing. Publishing requires separate explicit authorization.
