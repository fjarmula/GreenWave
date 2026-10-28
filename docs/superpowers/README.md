# Feature specs and plans

`specs/` holds feature designs (`*-design.md`); `plans/` holds the implementation and coordination plans that execute them. Neither is a permanent engineering-rule source.

Authority order: direct user requirements, `AGENTS.md`, `docs/engineering/`, `GreenWave_ARCHITECTURE.md`, accepted ADRs, then applicable plans. Preserve historical plans where possible; update live path references when their target moves.

**Archive rule.** When a feature is complete (its plan finished and merged), `git mv` its plan to `plans/archive/` and its spec to `specs/archive/`, add a row to [HISTORY.md](HISTORY.md) (date, feature, spec, plan, ADR, pull request), and update references to the moved files. Only in-progress work stays at the top level. Archived files are history only: ignore them unless a task points to a specific file there.

One-off verification and validation logs live in `docs/engineering/history/`.
