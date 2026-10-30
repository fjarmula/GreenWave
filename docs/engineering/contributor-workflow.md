# Contributor workflow and engineering rules

## Authority and discovery

`GreenWave_ARCHITECTURE.md` is the intended architecture. Confirm it against the implementation before relying on it. Accepted ADRs record durable decisions. Backend Pydantic models in `backend/src/greenwave/schemas/` define REST and telemetry payloads; `contracts/openapi.json` and `frontend/src/types/api.generated.ts` are generated artifacts, never hand-edit them.

Before planning or editing, inspect the relevant structure, source, related documentation, tests, fixtures, manifests, lockfiles, and tool configuration. Check `git status` and the relevant diff; preserve unrelated work. Identify conflicts between code and docs instead of silently choosing one.

## Stack and design rules

- Backend: Python 3.12+, `uv`, FastAPI/ASGI, Pydantic v2, GeoPandas, Polars, NetworkX, Shapely, Ruff, mypy, and pytest. Use the repository configuration as the source of truth; do not introduce a listed technology merely because it appears here.
- Frontend: Next.js App Router, strict TypeScript, React, Tailwind, lucide icons, MapLibre, and the existing real-time state approach.
- Keep GIS ingestion and graph construction separate from the simulation loop; keep domain logic out of FastAPI/transport code; keep MapLibre within the map boundary and HUD components separate. Keep transport, validation, domain, persistence, and presentation responsibilities distinct.
- Use explicit Python parameter/return annotations and precise TypeScript types. Avoid Python `Any` and TypeScript `any`; validate untrusted boundaries. Use Pydantic for parsing/validation and keep stateful domain decisions in domain/service modules.
- Keep tunable values in existing configuration with explicit units and range validation. Reuse existing configuration; do not invent unspecified thresholds or turn local implementation literals into global settings without reason.
- Prefer clear English names, focused changes, comments that explain reasoning/constraints, and no unnecessary layers, dependencies, formatting churn, or broad refactors. Use standard domain terms such as TTI when defined.

## Change workflow

1. State the immediate goal, relevant behavior, acceptance criteria, and a small plan.
2. Use test-first development where practical. For behavior changes, test public interfaces, invariants, boundary cases, errors, and integration points with deterministic fixtures.
3. Make the smallest cohesive change. A schema change includes all affected generated representations and boundary verification.
4. Ask before an architectural/dependency/public-contract expansion, external side effect, destructive action, or material requirement conflict. Complete explicitly authorized multi-file work without micro-approval checkpoints.

For a bug, add a regression test when practical. Documentation-only and purely stylistic changes do not need artificial tests; run relevant validation instead. Never weaken a test merely to pass without explaining why and obtaining approval if expected behavior is uncertain.

## Security, performance, and observability

- Treat GIS data, client payloads, and environment variables as untrusted. Validate size, format, and ranges; never commit secrets or expose stack traces, internal paths, or sensitive configuration. Keep logs actionable without leaking secrets.
- Do not add permissive CORS, authentication bypasses, disabled validation, or hidden external side effects.
- Prefer correctness and algorithmic clarity before optimization. Identify time/space complexity for non-trivial spatial, graph, and simulation algorithms. Benchmark representative workloads before claiming an improvement; report data size, runtime, hardware, and method.
- Where relevant, expose simulation-loop duration/deadlines, stale or invalid inputs, routing failures, connection health, queue depth, drops, and telemetry latency. Do not add instrumentation frameworks without task justification.

## Verification and completion

Inspect scripts before running commands. Default checks are:

```bash
cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest
cd frontend && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build
```

Run focused checks first, then affected broader checks. For cross-layer work, verify both layers and serialization/deserialization boundaries. Use `npm run typecheck`, not bare `tsc`, because Next generates route types. Report commands actually run, failures, skipped checks, assumptions, and limitations. Review the final diff for unrelated edits, debug output, secrets, and formatting churn.

A task is done only when requested behavior, contracts, and relevant documentation are current; relevant checks have completed; and no unrelated changes remain. Final reports state implemented work, changed files, verification, limitations, and a next step only when useful.

## Working style and Git

Be concise, technically precise, and evidence-led. Explain consequential trade-offs. Do not claim inspection or verification that did not occur.

Do not discard or reformat unrelated work or change secrets unnecessarily. Create local commits after relevant checks and staged-diff review, using `<category>: <message>` subjects as described in `CONTRIBUTING.md`. Do not push, deploy, publish, or open a pull request unless asked. Use `uv add` / `uv add --dev` and the established frontend package manager for approved dependencies.
