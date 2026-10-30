# Contributing

Use focused branches. Do not change shared contracts without review.

## Git hooks

`uv run --project backend pre-commit install --install-hooks` installs the quality hooks once per clone. The hooks run formatting, lint, type and contract checks at their configured stages; the `commit-msg` hook requires a `<category>: <message>` subject.

## Quality checks

```bash
cd backend
uv run ruff check .
uv run ruff format --check .
uv run mypy
uv run pytest
```

```bash
cd frontend
npm run lint
npm run typecheck
npm run format:check
npm test
npm run build
```

`cd frontend && npx knip` reports unused files, exports and dependencies (config: `frontend/knip.json`).

## Worktree and branch ownership

- One agent owns one branch and one worktree at a time.
- Name branches `<category>/<topic>`, with the commit categories (`feat/optional-team-dispatch`, `fix/its-eta`). Do not reuse another agent's dirty worktree.
- Before handoff, commit coherent work when permitted by the applicable repository or task policy, or state exactly which files remain uncommitted.
- Do not merge, push, or delete a branch without explicit maintainer approval.

## Handoff protocol

Record: objective, branch and commit, changed files, commands run and results, known limitations, and the next required action. Keep handoffs terse. Never include secrets, tokens, or local machine paths unless the recipient needs the path to access a managed worktree.

## Review gates

- Run focused checks, then relevant project checks, before requesting review.
- Review contract, safety, and generated-file changes separately from implementation detail.
- `CODEOWNERS` approval is required where the forge enforces it. CI must pass before merge.

## Contract changes

Backend Pydantic schemas in `backend/src/greenwave/schemas/` are canonical. Contract changes require maintainer approval before implementation. Regenerate both committed outputs, then run the contract-drift checks:

```bash
cd backend
uv run python scripts/export_openapi.py
cd ../frontend
npm run generate:types
```

Document compatibility or rollout risks in the pull request.
