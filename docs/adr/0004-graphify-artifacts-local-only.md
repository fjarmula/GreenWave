# 0004: Graphify artifacts are local only

- Status: Accepted
- Date: 2026-10-16
- Owners: @fjarmula @Piotrek406
- Supersedes: Part of 0002 (graphify output as a tracked artifact)

## Context

ADR 0002 tracked `graphify-out/graph.json` and `GRAPH_REPORT.md` and added a CI job requiring the graph's `built_at_commit` to be an ancestor of `HEAD`. Two problems followed:

- A squash merge drops the branch commit the graph was built at. This happened on `main`: the graph pointed at `efb8078`, which is not in `main`'s history, and CI failed.
- `graph.json` is one very large JSON line, so any two branches that regenerate it conflict on the whole file. Phase 2 runs two parallel feature branches.

The old check verified ancestry only, not that the graph matched the code, so it did not even guarantee freshness.

## Decision

Graphify output is generated locally by `graphify update .` and in CI, and is never committed. `graphify-out/` is gitignored. Squash merging is allowed. CI keeps a `graphify-build` job that installs a pinned `graphifyy` and proves the graph still builds. `scripts/setup-agent-env.sh --install` builds the graph after installing the tools; `--check` and `scripts/check-agent-readiness.sh` report a missing graph and do not build it.

## Consequences

- Fresh clones and agents must run `graphify update .` (setup does this). The MCP servers in `.mcp.json` and `.codex/config.toml` read the local `graphify-out/graph.json`.
- No pull request touches `graphify-out/`, so it cannot conflict or go stale in review.
- A local graph can lag behind the working tree; rerun `graphify update .` after structural changes (AGENTS.md).
- CI pins the `graphifyy` version; bump it deliberately together with the local install.
- People who pulled the tracked files lose them on the pull that removes them; rerun `graphify update .`.

## Alternatives considered

- A bot commit to `main` after each merge: rejected, a bot writing to `main`.
- A content-hash freshness check: rejected, it forces every PR to regenerate the graph, so parallel branches conflict.
- A warn-only check: rejected, it keeps the conflicts.

## Validation

`tests/scripts/test_graphify_ci.sh` and `tests/scripts/test_setup_agent_env.sh`, the `graphify-build` CI job, and `scripts/check-agent-readiness.sh`.
