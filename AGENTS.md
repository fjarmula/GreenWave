# ER-GreenWave: agent entry point

This file is the shared entry point for every AI coding agent working in this repo
(Claude Code, ChatGPT/Codex, ...). `CLAUDE.md` imports it, so all agents follow the same rules.

## Read first

1. `.agents/INSTRUCTIONS.md`: mandatory working rules, domain invariants, definition of done.
2. `GreenWave_ARCHITECTURE.md`: system design and JSON contracts.
3. `frontend/AGENTS.md`: Next.js specifics. This Next.js has breaking changes; read
   `frontend/node_modules/next/dist/docs/` before writing frontend code.

## Layout

- `backend/`: FastAPI service. Python package at `backend/src/greenwave/` (`schemas/` holds the
  canonical Pydantic contract models). Tests in `backend/tests/`.
- `frontend/`: Next.js dashboard. Map code in `src/components/map/`, HUD in `src/components/hud/`.
- `contracts/openapi.json`: generated from the backend; input for frontend types.
- `frontend/src/types/api.generated.ts`: generated, never edit by hand.

## Commands

Backend (from `backend/`):

```bash
uv run ruff check . && uv run ruff format --check .
uv run mypy
uv run pytest
```

Frontend (from `frontend/`, Node 22+):

```bash
npm run lint && npm run typecheck && npm run format:check && npm test && npm run build
```

Contract changes: edit `backend/src/greenwave/schemas/`, then run
`cd backend && uv run python scripts/export_openapi.py && cd ../frontend && npm run generate:types`.
CI fails if the generated files are stale.

## Working with two contributors and two agents

- Pull and check `git status` before starting; never overwrite or reformat the other contributor's work.
- Use one short-lived branch per task and keep diffs focused; do not commit, push or open PRs
  unless the human asks.
- Do not change files under `.agents/`, this file, or the architecture doc without telling the
  human, since both agents depend on them.
