# ER-GreenWave: agent rules (Claude Code + Codex; CLAUDE.md imports this)

Kraków emergency-vehicle green-corridor PoC. Backend: Python 3.12, FastAPI, uv, GeoPandas/NetworkX, Pydantic v2, ruff, mypy strict, pytest (`backend/src/greenwave/`). Frontend: Next.js 16 (breaking changes: read `frontend/node_modules/next/dist/docs/` first), React 19, TS strict, Tailwind, shadcn, MapLibre, vitest (`frontend/`). Simulation only, no real signal actuation.

## Rules
- **Navigate (Claude and Codex):** read `graphify-out/GRAPH_REPORT.md` or run `graphify query "<q>"` / `graphify path A B` / `graphify explain X` BEFORE grep/find/glob. Codex must not bypass this rule when hooks are unavailable. Missing `graph.json`: `graphify update .` (AST, ~10s, free). Rerun after structural refactors.
- **Output:** caveman terse for explanations, handoffs, subagent prompts. No filler. Code and technical facts exact.
- **Workflow:** spec first, short plan, TDD, small verifiable steps. No big-bang features. Verify before claiming done.
- **Browser/E2E:** `@playwright/cli` via bash + `playwright-cli` skill. NEVER `@playwright/mcp`, never dump DOM/a11y trees. Save to `.tmp/playwright/`, read targeted output only.
- **Docs:** library docs via Context7 (`ctx7` / "use context7") or skills in `.claude/skills/`. No generic web fetch for lib docs.
- **Git:** pull, check `git status`; keep diffs focused; never reformat others' work; no commit/push/PR unless asked. Tell human before editing `.agents/`, this file, or the architecture doc.

## Read when relevant
`.agents/INSTRUCTIONS.md` (core rules + done-definition; read before non-trivial change) · `.agents/INSTRUCTIONS_REFERENCE.md` (stack, engineering rules, domain invariants §6, testing §7, security §8; read the section for your area) · `GreenWave_ARCHITECTURE.md` · `frontend/AGENTS.md`.
Dirs: `.agents/` = docs/handoffs; `.agent/skills/` = skills (tool-managed, don't hand-edit).

## Contracts
Pydantic models in `backend/src/greenwave/schemas/` are canonical. `contracts/openapi.json` and `frontend/src/types/api.generated.ts` are generated, never hand-edit. After schema change: `cd backend && uv run python scripts/export_openapi.py && cd ../frontend && npm run generate:types`. CI fails on drift.

## Checks
- `backend/`: `uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`
- `frontend/` (Node 22+): `npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`

## Skills
Shared dir `.agent/skills/` (symlinked at `.claude/skills`, `.codex/skills`). Load skill by name when task matches (brainstorming, TDD, systematic-debugging, writing-plans, verification-before-completion, graphify, playwright-cli, context7-cli, caveman...).

## Plan execution
- When asked to implement a plan from `docs/superpowers/plans/`, read it in full, along with its associated specification and relevant architecture documentation.
- Load and follow available plan-execution, TDD, debugging, and verification skills.
- Execute tasks in dependency order, in small test-driven increments.
- Treat plan acceptance criteria as the completion checklist.
- Resolve non-blocking ambiguities autonomously; escalate architectural conflicts.
- Continue through executable tasks without unnecessary approval checkpoints.
- Verify the complete implementation before claiming done.
- Do not stop after producing an implementation outline.
