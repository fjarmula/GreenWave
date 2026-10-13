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

## 2. Technology Stack

Use the repository's actual configuration as the source of truth for installed versions and commands. The following describes the intended stack; verify it before relying on it.

### Backend

- Python 3.12+
- `uv` for dependency and environment management
- FastAPI and asynchronous ASGI
- WebSockets and/or SSE for telemetry
- GeoPandas, Polars, NetworkX, and Shapely for data and spatial processing, where used by the existing implementation
- Pydantic v2 for validation and serialization
- Ruff for linting and formatting
- Mypy for static type checking
- Pytest, including async tests where needed

### Frontend

- Next.js App Router
- TypeScript in strict mode
- Tailwind CSS and `shadcn/ui`
- Mapbox GL JS for map rendering
- React hooks and the project's existing state-management approach for real-time updates

Do not introduce a listed technology merely because it appears here. Prefer existing dependencies and established project conventions.

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
- Backend Pydantic models live in `backend/src/schemas/` if that path exists in the current repository.
- Frontend types are expected under `frontend/src/types/` if that path exists.
- Identify the canonical definition for each API/WebSocket payload. Do not maintain competing definitions without a documented reason.
- When a shared contract changes, update or generate all affected representations within the task's scope, and add a check that detects drift where practical.
- If the project does not yet have a reliable contract-generation workflow, explain the options and ask before introducing a broad tooling change.

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

## 5. Architecture and Engineering Principles

### 5.1 Separation of concerns

Preserve the repository's established architecture. Unless the architecture documentation specifies otherwise:

- Keep GIS ingestion, normalization, and graph construction separate from the real-time simulation loop.
- Keep domain and graph logic out of FastAPI request handlers and WebSocket transport code.
- Keep Mapbox rendering isolated within the existing map component boundary (expected at `frontend/src/components/map/`).
- Keep dashboard/HUD presentation components separate from map rendering (expected at `frontend/src/components/hud/`).
- Keep transport, validation, domain logic, persistence, and presentation responsibilities distinct.
- Avoid unnecessary abstractions; introduce a new layer when it provides a clear boundary or testability benefit.

Treat these paths as expected conventions, not guaranteed facts; inspect the actual repository before using them.

### 5.2 Types and schemas

- Python functions should have explicit parameter and return annotations, following the project's type-checking configuration.
- Avoid `Any`; if it is genuinely necessary at an integration boundary, keep it narrow and explain why.
- TypeScript's `any` should not be used. Prefer precise types, discriminated unions, and `unknown` with validation at untrusted boundaries.
- Validate untrusted input at system boundaries.
- Use Pydantic for input/output validation, parsing, and normalization where appropriate; keep domain decisions and stateful business logic in domain/service modules.
- REST and real-time payloads must conform to the documented contracts.
- Handle schema changes as cross-layer changes rather than updating only one side.

### 5.3 Naming and readability

- Use clear, descriptive English names.
- Avoid unexplained abbreviations; retain standard domain terminology such as TTI when defined in the architecture.
- Use single-letter variables only for conventional loop counters or well-defined mathematical notation.
- Write comments to explain reasoning, constraints, or non-obvious decisions—not to paraphrase each line.
- Prefer straightforward code over cleverness or premature abstraction.

### 5.4 Configuration and constants

- Keep operationally tunable values—such as corridor radius, TTI thresholds, simulation intervals, and telemetry limits—in the project's established configuration mechanism.
- Reuse existing configuration instead of duplicating values.
- Do not move every literal into global configuration: local implementation details and mathematical constants may remain local when they are not operationally tunable.
- Use explicit units in names and documentation, such as `_meters`, `_seconds`, or `_milliseconds`.
- Validate configuration ranges where invalid values could break the simulation or spatial calculations.
- Do not invent default thresholds when the architecture or user has not specified them. Identify the missing decision instead.

### 5.5 Error handling and resilience

- Handle expected failure modes explicitly, including missing routes, disconnected clients, invalid coordinates, malformed GIS records, and unavailable signal data.
- Prefer meaningful domain-specific exceptions or typed error results where they improve clarity.
- Do not catch broad exceptions merely to hide failures or continue in an invalid state.
- Never silently convert invalid or missing data into plausible-looking values.
- Include actionable context in logs and errors without exposing secrets or unnecessarily sensitive data.
- Define retry, timeout, stale-data, and fallback behavior according to the architecture rather than improvising it in individual handlers.

## 6. ER-GreenWave Domain Invariants

These are review and testing concerns. Verify the precise expected behavior against the architecture and existing product requirements; do not invent transition rules or thresholds.

### 6.1 Simulation state machine

- Allow only documented state transitions.
- Make transition preconditions, timeout behavior, interruption handling, and recovery behavior explicit.
- Ensure a completed, cancelled, or interrupted simulated priority sequence can return to a valid documented state.
- Prevent stale events or duplicate processing from causing invalid or repeated transitions, according to the system's event semantics.
- Keep state-transition logic testable independently of HTTP/WebSocket handlers.

### 6.2 Time and event-loop behavior

- Keep time-dependent domain logic testable with an injectable or controllable clock where practical.
- Distinguish simulation time from wall-clock time.
- Avoid unbounded work in the 1 Hz simulation loop.
- Measure loop execution time and identify missed deadlines where observability is implemented.
- Define behavior for delayed ticks and long-running operations from documented requirements; do not assume that skipped ticks or catch-up processing is correct without checking.

### 6.3 Spatial and routing correctness

- Confirm the coordinate reference system (CRS) and units of each input layer before calculating distances.
- Do not compare angular coordinates as if they were meters. Use an appropriate projected CRS or a suitable geodesic calculation.
- Validate geometries and coordinates at ingestion boundaries and report invalid records in a diagnosable way.
- Make assumptions about directed roads, one-way restrictions, connectivity, and graph edge weights explicit.
- Handle disconnected graphs and unreachable intersections without fabricating routes.
- Check that distance and time calculations use consistent units and that edge weights meet the algorithm's requirements.
- Test boundary conditions for corridor batching, including values below, at, and above the configured threshold.
- Treat missing or stale vehicle, road, or signal data explicitly.

### 6.4 Concurrent requests and telemetry

- Follow documented semantics for duplicate, conflicting, cancelled, or stale emergency-vehicle requests.
- Define message ordering, client reconnection, and stale-update behavior according to the existing protocol.
- Avoid unbounded queues or per-client work that can block the simulation loop.
- Handle client disconnects without crashing the service or corrupting simulation state.
- Do not invent arbitration policies for simultaneous requests; flag missing policy as a design decision.

### 6.5 Simulation versus real-world actuation

- The PoC's simulated signal state is not evidence that a physical traffic light has changed.
- Do not add controller protocols, live signal commands, or real-world actuation without explicit requirements, authorization, and a separate safety review.
- Clearly label simulated values and telemetry so consumers do not mistake them for verified physical signal states.

## 7. Testing Strategy

### 7.1 What to test

- Add or update tests for behavioral changes.
- For bug fixes, add a regression test that fails under the original behavior when practical.
- Test public interfaces, domain invariants, boundary conditions, error paths, and important integration points.
- Prefer deterministic tests; control time, randomness, and external dependencies when relevant.
- Use unit tests for isolated domain logic and integration tests for important cross-layer behavior.
- Do not write brittle tests that merely duplicate implementation details.
- Documentation-only and purely stylistic changes do not need artificial tests; run relevant validation instead.
- Never remove or weaken a test simply to make a change pass without explaining the reason and obtaining approval when the expected behavior is in question.

### 7.2 Test-first workflow

For new or changed behavior, follow test-driven development where practical:
1. Define expected behavior and edge cases.
2. Add or update a focused test.
3. Implement the smallest change that satisfies the test.
4. Run the focused test and relevant broader checks.

If strict test-first development is impractical, explain why briefly and still provide meaningful verification.

### 7.3 Cross-layer contracts

When backend models or API/WebSocket payloads change:
- Update all affected backend and frontend representations within scope.
- Add or update contract tests, schema validation, or code generation checks when the project supports them.
- Verify serialization and deserialization behavior at the boundary.
- Do not claim the frontend and backend contracts are synchronized unless that has been checked.

## 8. Performance, Observability, and Security

### 8.1 Performance

- Prefer algorithmic clarity and correctness before optimization.
- Identify likely time and space complexity for non-trivial graph, GIS, and simulation algorithms.
- Avoid repeated expensive graph or spatial preprocessing in the simulation loop unless measured and justified.
- Benchmark representative workloads before claiming a performance improvement.
- Use realistic graph sizes and signal counts when available; clearly label synthetic workloads.
- Record relevant constraints such as data size, runtime, hardware, and methodology when reporting benchmarks.
- Do not invent performance budgets or report unmeasured latency figures. If a budget is needed but unspecified, recommend one and ask for agreement.

### 8.2 Observability

Where relevant to the existing architecture, support diagnosis through:
- Simulation-loop duration and missed-deadline indicators.
- Stale or invalid input data counts.
- Routing failures and unreachable destinations.
- WebSocket/SSE connection health and client disconnects.
- Queue depth, dropped messages, and telemetry latency where measurable.
- Structured logs with useful identifiers and clear error context.

Do not add an observability framework or extensive instrumentation for a small change unless justified by the task.

### 8.3 Security and privacy

- Treat external GIS data, client payloads, and environment variables as untrusted input.
- Never commit secrets or print credentials into logs.
- Validate input size, format, and ranges at system boundaries.
- Avoid exposing stack traces, internal paths, or sensitive configuration to API clients.
- Do not introduce permissive CORS, authentication bypasses, or disabled validation as a quick fix.
- Keep external side effects explicit and testable.

## 9. Verification and Tooling

Inspect the project's actual configuration and scripts before running commands. The commands below are defaults for the expected layout, not proof that every command exists or is configured identically.

### Backend (run from `backend/` when applicable)

```bash
uv run ruff check .
uv run ruff format --check .
uv run mypy src
uv run pytest
```

### Frontend (run from `frontend/` when applicable)

```bash
npm run lint
npx tsc --noEmit
```

Use the package manager and scripts actually declared by the repository. Do not run `npm` commands if the project uses another package manager or has no matching script.

### Verification rules

- Run focused tests first, then the relevant broader test suite and static checks.
- Run checks affected by the change; for cross-layer changes, verify both sides where possible.
- If time or environment constraints prevent the full suite from running, report exactly what was and was not run.
- If a command fails, include the relevant failure summary and whether it appears related to the change or pre-existing.
- Never claim a check passed unless it completed successfully.
- Do not hide, suppress, or work around a failing check without explaining the trade-off.
- Review the final diff and check for accidental edits, debug output, secrets, and unrelated formatting changes.

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
