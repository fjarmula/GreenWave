# Active project memory

ER-GreenWave is a Kraków emergency-vehicle green-corridor simulation. It never controls physical traffic signals.

## Sources of truth

- `GreenWave_ARCHITECTURE.md`: architecture and state-machine intent.
- `backend/src/greenwave/schemas/`: canonical API payloads.
- `.agents/INSTRUCTIONS.md` and `.agents/INSTRUCTIONS_REFERENCE.md`: operating and domain constraints.
- `docs/adr/`: accepted durable decisions.

## Active technical boundaries

- Backend: Python 3.12, FastAPI, Pydantic v2, GeoPandas/NetworkX, uv.
- Frontend: Next.js 16, React 19, TypeScript strict, MapLibre.
- Generated contracts: `contracts/openapi.json` and `frontend/src/types/api.generated.ts`.
- Agent tooling: shared skills at `.agent/skills/`; Claude and Codex symlink to it. Graphify and Context7 are MCP tools; Playwright is CLI-only.

## Working rules

- Read Graphify output before broad repository search.
- Keep simulation state explicitly simulated.
- Regenerate generated contracts after schema changes.
- Run `scripts/check-agent-readiness.sh` after agent-tooling changes.

Update this file only for durable, active context. Put decisions in ADRs and task detail in issues or pull requests.
