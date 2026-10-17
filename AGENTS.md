# ER-GreenWave: agent rules (Claude Code + Codex; CLAUDE.md imports this)

Kraków emergency-vehicle green-corridor PoC. Simulation only; never add real signal actuation.

## Rules

- **Navigate:** Read `graphify-out/GRAPH_REPORT.md` or run `graphify query "<q>"`, `graphify path A B`, or `graphify explain X` before grep/find/glob. Missing graph: `graphify update .`. Rerun after structural refactors.
- **Workflow:** Start with a spec and short plan; use TDD and small verifiable steps. Verify before claiming completion.
- **Browser/E2E:** Use `@playwright/cli` through bash and the `playwright-cli` skill. Never use `@playwright/mcp`, dump DOM/a11y trees, or write output outside `.tmp/playwright/`.
- **Docs:** Use Context7 or a project skill for library documentation. Do not generic-web-fetch library docs.
- **Git:** Check status and preserve existing changes. Keep diffs focused; never reformat unrelated work. Do not commit, push, create branches, switch branches, or open pull requests without explicit authorization. Tell the human before editing this file or `GreenWave_ARCHITECTURE.md`.
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

Load only task-relevant skills and supporting references. Do not repeatedly load the same documentation without a specific reason.

## Plan execution and human review

When implementing a plan from `docs/superpowers/plans/`:

1. Read the complete plan, its associated specification, and relevant architecture and engineering documentation.
2. Load and follow applicable plan-execution, TDD, debugging, and verification skills.
3. Group implementation tasks into logical, independently verifiable milestones, respecting dependencies and acceptance criteria.
4. Execute each milestone autonomously in small, test-driven increments.
5. After each milestone:
   - Run relevant tests and quality checks.
   - Summarize completed changes, affected files, and verification results.
   - Report significant decisions, deviations, or blockers.
   - Propose a Conventional Commit message.
   - Stop and wait for explicit human approval before proceeding.
6. Incorporate human feedback before beginning the next milestone.
7. Escalate significant architectural conflicts or blocking ambiguities immediately.
8. Verify all acceptance criteria before declaring the complete plan finished.

Do not request approval for routine implementation steps within an approved milestone.

Never commit, push, or create a PR without explicit authorization.
