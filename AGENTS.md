# ER-GreenWave: agent rules (Claude Code + Codex; CLAUDE.md imports this)

Kraków emergency-vehicle green-corridor PoC. Simulation only; never add real signal actuation.

## Rules

- **Navigate:** Read `graphify-out/GRAPH_REPORT.md` or run `graphify query "<q>"`, `graphify path A B`, or `graphify explain X` before grep/find/glob. Missing graph: `graphify update .`. Rerun after structural refactors.
- **Workflow:** Start with a spec and short plan; use TDD and small verifiable steps. Verify before claiming completion.
- **Browser/E2E:** Use `@playwright/cli` through bash and the `playwright-cli` skill. Never use `@playwright/mcp`, dump DOM/a11y trees, or write output outside `.tmp/playwright/`.
- **Docs:** Use Context7 or a project skill for library documentation. Do not generic-web-fetch library docs.
- **Git:** Check status, keep diffs focused, and never reformat unrelated work. No commit, push, or PR unless asked. Tell the human before editing this file or `GreenWave_ARCHITECTURE.md`.
- **Style:** Use terse, exact explanations, handoffs, and subagent prompts.

## Read when relevant

- `docs/engineering/contributor-workflow.md`: workflow, testing, security, verification, and done-definition.
- `docs/engineering/domain-invariants.md`: simulation, spatial, telemetry, and PoC safety invariants.
- `docs/engineering/data-pipeline.md` and `docs/engineering/frontend-dashboard.md`: area-specific constraints.
- `GreenWave_ARCHITECTURE.md`, accepted `docs/adr/`, and `frontend/AGENTS.md`.
- `docs/superpowers/README.md` before using a feature plan.

## Contracts

Pydantic models in `backend/src/greenwave/schemas/` are canonical. `contracts/openapi.json` and `frontend/src/types/api.generated.ts` are generated, never hand-edit. After schema change: `cd backend && uv run python scripts/export_openapi.py && cd ../frontend && npm run generate:types`. CI fails on drift.

## Checks

- `backend/`: `uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`
- `frontend/` (Node 22+): `npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`

## Skills

Shared dir `.agent/skills/` (symlinked at `.claude/skills`, `.codex/skills`); do not hand-edit managed skills. Load a matching skill (brainstorming, TDD, systematic-debugging, writing-plans, verification-before-completion, graphify, playwright-cli, context7-cli, caveman...).

## Plan execution

- When asked to implement a plan from `docs/superpowers/plans/`, read it in full, along with its associated specification and relevant architecture documentation.
- Load and follow available plan-execution, TDD, debugging, and verification skills.
- Execute tasks in dependency order, in small test-driven increments.
- Treat plan acceptance criteria as the completion checklist.
- Resolve non-blocking ambiguities autonomously; escalate architectural conflicts.
- Continue through executable tasks without unnecessary approval checkpoints.
- Verify the complete implementation before claiming done.
- Do not stop after producing an implementation outline.
