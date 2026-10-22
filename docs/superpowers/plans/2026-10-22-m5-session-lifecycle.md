# M5 — Session Lifecycle Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development). Steps use checkbox (`- [ ]`) syntax. Master: `2026-10-22-repo-audit-master.md` (findings B3, B4; decision D3). Requires M4.

**Goal:** The backend keeps a bounded number of sessions, and each run publishes exactly one terminal event, even when stop and a superseding start race.

**Architecture:**
- **Retention:** a new setting `retained_session_limit: int = Field(default=4, ge=1)` in `SimulationSettings`. After a new session is registered in `start`, evict the oldest *terminal* sessions (insertion order of `_sessions`) until the count is at the limit. The active session is never evicted. An evicted id answers 404, which the frontend already treats as "Simulation no longer exists".
- **Single terminal:** `_cancel` becomes idempotent. After awaiting the cancelled task, return if `session.terminal` is already set. `stop` also returns without cancelling if the terminal appeared while it waited. No extra locking, so stop never waits behind route planning.

**Tech stack:** Python asyncio, pytest.

## Root cause

`session.py:103` adds every session to `_sessions`, and nothing removes them, so engines, routes and phase state build up for the life of the process. `stop()` (`:110`) runs without `_lock`. Both it and a superseding `start` can pass `terminal is None`, await the same task, and then each publish a `SIMULATION_CANCELLED`.

## File map

- `backend/src/greenwave/simulation_settings.py`: `retained_session_limit`.
- `backend/src/greenwave/simulation/session.py`: `_evict_retained()`, idempotent `_cancel`.
- `backend/tests/simulation/test_session.py`: new cases.
- `GreenWave_ARCHITECTURE.md` §4 currently says "A finished session stays readable until superseded". Tell the human and change it to "the most recent sessions (setting `retained_session_limit`, default 4) stay readable".

## Tasks

### Task 1: Retention bound

- [ ] RED:
  - with `retained_session_limit=2`, start runs A, B and C in turn (each superseding the last): `exists("A")` is false, B and C exist, and `stream`/`stop` for A raise `SimulationNotFoundError`;
  - with limit 1, the active run is kept even when it is the only session;
  - a finished-but-latest session stays streamable (its terminal is replayed).
- [ ] GREEN.

### Task 2: One terminal under a race

- [ ] RED: with a planner that yields (`asyncio.sleep(0)`), call `asyncio.gather(manager.stop("A"), manager.start(request_B))` while A is live, then collect every event A's subscriber gets: exactly one `SIMULATION_CANCELLED` (`STOPPED` or `SUPERSEDED`, whichever won) and then the end of the stream. Repeat with the order swapped. Also: a stop that arrives just after natural completion publishes nothing. Also (found in M4): the `_run` `except` branch publishes `SERVER_ERROR` without checking `session.terminal`, so an exception raised after a terminal was already published in the same step would add a second terminal. Cover it with the same one-terminal guard.
- [ ] GREEN: idempotent `_cancel`.
- [ ] Backend gate.

### Task 3: Docs and check

- [ ] Tell the human, then update the §4 sentence. Check memory by hand: start 10 runs against the real backend and confirm `len(app.state.session_manager._sessions)` stays ≤ 4. Use a short test-only script under the scratchpad, not committed.

## Acceptance

- Session count stays bounded; the active session and the latest results stay readable.
- No run ever emits two terminal events; the existing supersede, stop and complete tests stay green.
- Backend gate green; no contract change.
