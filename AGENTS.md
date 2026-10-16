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

<skills_system priority="1">

## Available Skills

<!-- SKILLS_TABLE_START -->
<usage>
When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.

How to use skills:
- Invoke: `npx openskills read <skill-name>` (run in your shell)
  - For multiple: `npx openskills read skill-one,skill-two`
- The skill content will load with detailed instructions on how to complete the task
- Base directory provided in output for resolving bundled resources (references/, scripts/, assets/)

Usage notes:
- Only use skills listed in <available_skills> below
- Do not invoke a skill that is already loaded in your context
- Each skill invocation is stateless
</usage>

<available_skills>

<skill>
<name>brainstorming</name>
<description>"You MUST use this before any creative work - creating features, building components, adding functionality, modifying behavior, or planning anything new, in software or out of it (a talk, a business, a renovation)."</description>
<location>project</location>
</skill>

<skill>
<name>caveman</name>
<description>Terse response style that preserves technical facts. Use for /caveman, caveman mode, or requests to be brief.</description>
<location>project</location>
</skill>

<skill>
<name>context7-cli</name>
<description>Use the ctx7 CLI to fetch library documentation and configure Context7 MCP. Activate when the user mentions "ctx7" or "context7", needs current docs for any library, or needs to set up Context7 for their AI coding agent.</description>
<location>project</location>
</skill>

<skill>
<name>diagnosing-superpowers</name>
<description>Use when a superpowers session went wrong and your human partner wants to know why — repeated work, ignored plans, stumbles, poor results, a skill that didn't fire, "it took too long", "why is it so expensive", "what is it doing" — or wants to build a bug report for the superpowers maintainers, for the current session or a past one identified by id or path, on any harness.</description>
<location>project</location>
</skill>

<skill>
<name>dispatching-parallel-agents</name>
<description>Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies</description>
<location>project</location>
</skill>

<skill>
<name>executing-plans</name>
<description>Use when executing an implementation plan in the current session as the implementer yourself — your human partner chose inline execution, or no subagent tool is available</description>
<location>project</location>
</skill>

<skill>
<name>finishing-a-development-branch</name>
<description>Use when implementation is complete, all tests pass, and you need to decide how to integrate the work</description>
<location>project</location>
</skill>

<skill>
<name>graphify</name>
<description>"Use for any question about a codebase, its architecture, file relationships, or project content — especially when graphify-out/ exists, where the question should be treated as a graphify query first. Turns any input (code, docs, papers, images, videos) into a persistent knowledge graph with god nodes, community detection, and query/path/explain tools."</description>
<location>project</location>
</skill>

<skill>
<name>playwright-cli</name>
<description>Automate browser interactions, test web pages and work with Playwright tests.</description>
<location>project</location>
</skill>

<skill>
<name>receiving-code-review</name>
<description>Use when receiving code review feedback, before implementing suggestions, especially if feedback seems unclear or technically questionable - requires technical rigor and verification, not performative agreement or blind implementation</description>
<location>project</location>
</skill>

<skill>
<name>requesting-code-review</name>
<description>Use when completing tasks, implementing major features, or before merging to verify work meets requirements</description>
<location>project</location>
</skill>

<skill>
<name>subagent-driven-development</name>
<description>Use when executing implementation plans with independent tasks in the current session</description>
<location>project</location>
</skill>

<skill>
<name>systematic-debugging</name>
<description>Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes</description>
<location>project</location>
</skill>

<skill>
<name>test-driven-development</name>
<description>Use when implementing any feature or bugfix, before writing implementation code</description>
<location>project</location>
</skill>

<skill>
<name>using-git-worktrees</name>
<description>Use when starting feature work that needs isolation from current workspace or before executing implementation plans - ensures an isolated workspace exists via native tools or git worktree fallback</description>
<location>project</location>
</skill>

<skill>
<name>using-superpowers</name>
<description>Use when starting any conversation - establishes how to find and use skills, requiring skill invocation before ANY response including clarifying questions</description>
<location>project</location>
</skill>

<skill>
<name>verification-before-completion</name>
<description>Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming output before making any success claims; evidence before assertions always</description>
<location>project</location>
</skill>

<skill>
<name>writing-plans</name>
<description>Use when you have a spec or requirements for a multi-step task, before touching code</description>
<location>project</location>
</skill>

<skill>
<name>writing-skills</name>
<description>Use when creating new skills, editing existing skills, or verifying skills work before deployment</description>
<location>project</location>
</skill>

</available_skills>
<!-- SKILLS_TABLE_END -->

</skills_system>
