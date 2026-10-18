# Contributing

Use focused branches. Run `scripts/check-agent-readiness.sh` before agent-workflow changes. Do not change shared contracts without review.

## Worktree and branch ownership

- One agent owns one branch and one worktree at a time.
- Use `codex/<task>` for Codex work. Do not reuse another agent's dirty worktree.
- Before handoff, commit coherent work when permitted by the applicable repository or task policy, or state exactly which files remain uncommitted.
- Do not merge, push, or delete a branch without explicit maintainer approval.

## Handoff protocol

Record: objective, branch and commit, changed files, commands run and results, known limitations, and the next required action. Keep handoffs terse. Never include secrets, tokens, or local machine paths unless the recipient needs the path to access a managed worktree.

## Review gates

- Run focused checks, then relevant project checks, before requesting review.
- Review contract, safety, and generated-file changes separately from implementation detail.
- `CODEOWNERS` approval is required where the forge enforces it. CI must pass before merge.

## Contract changes

Backend Pydantic schemas are canonical. Contract changes require maintainer approval before implementation. Regenerate `contracts/openapi.json` and `frontend/src/types/api.generated.ts`, run contract-drift checks, and document compatibility or rollout risks in the pull request.
