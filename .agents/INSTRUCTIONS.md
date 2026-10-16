# Core working rules (sections 1, 3, 4, 10, 11)

> Section numbers kept stable because other docs cite them. Sections 2, 5-9 (stack, engineering principles, domain invariants, testing, performance/security, verification commands) are in `.agents/INSTRUCTIONS_REFERENCE.md`. Read the relevant ones before touching that area: **6** for simulation/spatial/telemetry logic, **7** for tests, **9** for check commands.

## 1. Project Context and Scope

ER-GreenWave is a proof-of-concept system for emergency-vehicle dynamic routing and simulated traffic-signal prioritization, developed for the Kraków "Open Data App" competition.

The system is intended to use open spatial data from the City of Kraków (MSIP and ZDMK) to model emergency-vehicle routes and simulate temporary "green corridors" ("life corridors").

Core capabilities:
1. Spatial ETL that converts source GIS layers (roads and traffic signals) into a directed road graph.
2. A 1 Hz simulation loop that calculates Time to Intersection (TTI) and advances documented traffic-signal states.
3. Corridor batching/cascade behavior for nearby traffic signals.
4. Real-time telemetry delivered to a dispatcher dashboard over WebSockets and/or SSE, according to the existing architecture.

The documented state sequence is:

`NORMAL` → `CLEARING` → `PRIORITY_GREEN` → `RECOVERY`

Treat this as project context, not permission to invent missing behavior. Verify exact transition conditions, timing thresholds, and exceptional cases in `GreenWave_ARCHITECTURE.md` and the implementation before changing them.

### Proof-of-concept boundary

- Treat traffic-signal states and green corridors as **simulation state** unless the repository explicitly documents and authorizes a real controller integration.
- Do not add real-world traffic-controller commands, external actuation, or operational deployment behavior implicitly.
- Do not describe the system as production-ready or safety-certified without evidence.

## 3. Repository Discovery and Source of Truth

Before planning a change, inspect the relevant parts of the repository. Do not assume that the documented directory layout or stack exactly matches the current checkout.

At minimum, as relevant to the task:

1. Inspect the repository structure and relevant source files.
2. Read `GreenWave_ARCHITECTURE.md` and any related domain or API documentation.
3. Inspect `pyproject.toml`, lockfiles, frontend package manifests, and tool configuration before choosing commands or changing dependencies.
4. Inspect relevant tests and fixtures to understand existing behavior and conventions.
5. Check `git status` and the relevant diff before editing. Preserve all unrelated user changes.

Use existing code and documentation as evidence. If they disagree, identify the conflict rather than silently choosing one. Do not overwrite user changes or assume that uncommitted changes are disposable.

### Authority and contracts

- `GreenWave_ARCHITECTURE.md` is the intended architectural reference. Confirm its current contents and relationship to the implementation before relying on it.
- Backend Pydantic models in `backend/src/greenwave/schemas/` are the canonical definition of every REST and telemetry payload.
- Frontend types in `frontend/src/types/api.generated.ts` are generated from them (via `contracts/openapi.json`); never edit generated files by hand. Regeneration steps are in `AGENTS.md`, and CI fails on drift.
- Payloads that are not exposed through a FastAPI route (e.g. WebSocket/SSE messages) must still be registered in the OpenAPI document so they are generated.
- Identify the canonical definition for each API/WebSocket payload. Do not maintain competing definitions without a documented reason.
- When a shared contract changes, update or generate all affected representations within the task's scope, and add a check that detects drift where practical.

## 4. Operating Workflow

### 4.1 Understand before editing

Before making changes:

1. Restate the immediate goal briefly.
2. Identify the relevant files, current behavior, and acceptance criteria.
3. Describe a small implementation plan.
4. Surface material ambiguities, conflicting requirements, or architectural decisions that need the user's input.

Do not ask questions whose answers are already available from the repository. If an ambiguity is minor and low-risk, state a reasonable assumption and proceed. Ask before making a consequential or difficult-to-reverse design choice.

### 4.2 Make the smallest cohesive change

- Prefer small, focused, reviewable diffs over broad rewrites.
- A cohesive change may span a schema, implementation, tests, and directly dependent types when those changes are necessary to keep behavior consistent.
- Do not split inseparable changes into artificial micro-steps.
- Avoid unrelated refactoring, formatting churn, dependency upgrades, or file moves.
- Do not generate large replacement files when a focused edit is sufficient.
- Follow existing conventions unless there is a concrete, explained reason to change them.

### 4.3 Permission checkpoints and autonomy

Work incrementally, but use checkpoints that reflect meaningful decisions rather than every function or file.

Stop and ask for approval before:
- Starting a separate feature after the agreed task is complete.
- Making a major architectural or dependency decision not already authorized.
- Changing a public API or shared contract beyond the requested scope.
- Introducing real external side effects or integrations.
- Performing destructive actions or broad refactors.
- Continuing when a requirement conflict could materially change the result.

When the user explicitly requests a complete implementation, a multi-file change, or a defined batch of work, complete that authorized scope without asking for permission after every micro-step. Do not extend the scope without approval.

### 4.4 Git and environment safety

- Inspect the working tree before editing and preserve unrelated changes.
- Never discard, reset, overwrite, or reformat unrelated user work.
- Do not run destructive Git commands, delete data, or alter external resources unless explicitly authorized.
- Do not commit, push, deploy, publish, or open a pull request unless requested.
- Do not modify secrets, credentials, or environment-specific configuration unnecessarily.
- Add dependencies only when justified. Use `uv add` / `uv add --dev` for backend dependencies and the existing package manager for frontend dependencies. Keep lockfiles consistent with the repository's workflow.

## 10. Definition of Done and Final Report

A task is complete when:
- The requested behavior is implemented within the agreed scope.
- Relevant tests and checks have been run, with results reported accurately.
- Cross-layer contracts and affected documentation are updated where needed.
- The final diff contains no known unrelated changes.
- Remaining assumptions, limitations, and unverified behavior are explicit.

At the end of a task, provide a concise report containing:

1. **Implemented:** the behavior or change delivered.
2. **Files changed:** the main files and their purpose.
3. **Verification:** commands actually run and their outcomes.
4. **Limitations:** failures, assumptions, or checks not run.
5. **Next step:** only if further work is useful or approval is needed.

Do not say "verified" when a change has only been inspected. Distinguish implementation from successful testing.

---

## 11. Interaction Style

- Be direct, technically precise, and concise.
- Explain consequential trade-offs, not every obvious line of code.
- Prefer evidence from the repository over generic best practices.
- Do not claim to have inspected, executed, benchmarked, or verified anything that was not actually inspected, executed, benchmarked, or verified.
- When asking for approval, identify the exact decision or next scope that requires it.
- When the user requests a complete deliverable, provide it within the requested scope rather than stopping at an arbitrary micro-step.
