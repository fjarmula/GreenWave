# ETL Equivalence Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the ETL equivalence harness from running without the committed roundabout override input and prove its comparison behavior through focused tests.

**Architecture:** The stricter existence check lives only in `scripts/etl_equivalence.py`, before it constructs any scratch data path. It uses the ETL-owned `OVERRIDE_FILENAME` constant but leaves `load_overrides()` unchanged because ordinary ETL draft workflows intentionally accept an absent override file. New pytest coverage imports the script by path, monkeypatches its repository root, and exercises the executable harness boundary.

**Tech Stack:** Python 3.12 / pytest / Ruff / mypy strict / `uv`.

**Spec:** `docs/superpowers/specs/2026-10-18-etl-equivalence-preflight-design.md`

## Global Constraints

- Preserve every ETL command, artifact format, raw-data input, and `load_overrides()` behavior.
- Keep the equivalence scratch directory outside the repository and do not write to `backend/data/raw`, `backend/data/overrides`, or `backend/data/processed`.
- Add no API schema, generated-contract, dependency, lockfile, CI, or frontend change.
- The required committed input is exactly `backend/data/overrides/roundabouts.json`, obtained through `greenwave.etl.overrides.OVERRIDE_FILENAME` rather than a duplicate string literal.
- Own only `backend/scripts/etl_equivalence.py`, `backend/tests/scripts/`, and `backend/README.md`.

## Review Focus

1. Scratch mutation before preflight — a missing override must raise before `scratch/data` or `scratch/data/processed` exists; Task 1 pins this.
2. Accidental global ETL behavior change — absent arbitrary paths must still yield `OverrideFile()` through `load_overrides`; Task 1 keeps the existing ETL test green.
3. A directory or broken path accepted as input — only `Path.is_file()` satisfies the harness preflight; Task 1 tests the missing/non-file case.
4. Hidden comparison regression — additions, removals, changed hashes, and allowed differences must retain their documented exit status; Task 2 tests all four.
5. An ambiguous operator recovery path — Task 3 documents the expected committed file and external scratch location without suggesting that the harness generate a replacement.

## File structure

- Modify: `backend/scripts/etl_equivalence.py` — harness-local override preflight before scratch setup.
- Create: `backend/tests/scripts/test_etl_equivalence.py` — script-boundary and compare tests.
- Modify: `backend/README.md` — equivalence command preconditions and repository-safety note.

### Task 1: Add and test the missing-override preflight

**Files:**
- Create: `backend/tests/scripts/test_etl_equivalence.py`
- Modify: `backend/scripts/etl_equivalence.py`
- Existing regression: `backend/tests/etl/test_junctions.py`

**Interfaces:**
- Produces: `require_committed_override() -> Path` in the script, returning the expected regular file or raising `SystemExit` with its absolute path.
- Consumes: `BACKEND` and `OVERRIDE_FILENAME`.

- [ ] **Step 1: Write a failing script-boundary test for a missing override**

Load `backend/scripts/etl_equivalence.py` with `importlib.util.spec_from_file_location`, monkeypatch its `BACKEND` to a temporary fake backend root without `data/overrides/roundabouts.json`, and choose a scratch path outside that fake root. Call `run(scratch, out)` and assert `SystemExit` mentions `roundabouts.json`. Assert neither `scratch/data` nor `out` exists after the exception.

- [ ] **Step 2: Run the focused test to verify the current harness fails the assertion**

Run: `cd backend && uv run pytest tests/scripts/test_etl_equivalence.py::test_run_requires_committed_override_before_creating_scratch -v`

Expected: FAIL because the current `run()` attempts scratch setup instead of rejecting the missing repository input.

- [ ] **Step 3: Implement the smallest harness-local preflight**

Import `OVERRIDE_FILENAME` from `greenwave.etl.overrides`. Add `require_committed_override() -> Path` that builds `BACKEND / "data" / "overrides" / OVERRIDE_FILENAME`, requires `is_file()`, and raises `SystemExit` with an actionable message otherwise. Invoke it as the first statement of `run()` before resolving `scratch` or calling `mkdir`, `symlink_to`, `spec_from_file_location`, or ETL code.

- [ ] **Step 4: Verify focused behavior and preserve general override semantics**

Run: `cd backend && uv run pytest tests/scripts/test_etl_equivalence.py::test_run_requires_committed_override_before_creating_scratch tests/etl/test_junctions.py::test_override_file_roundtrip_and_missing_file -v`

Expected: PASS. The harness rejects its required input while `load_overrides(absent_path)` still returns an empty `OverrideFile`.

- [ ] **Step 5: Commit the preflight behavior and regression test**

```bash
git add backend/scripts/etl_equivalence.py backend/tests/scripts/test_etl_equivalence.py
git commit -m "fix: fail fast when etl override is missing"
```

### Task 2: Characterize comparison result semantics

**Files:**
- Modify: `backend/tests/scripts/test_etl_equivalence.py`

**Interfaces:**
- Consumes: `compare(base_path: Path, new_path: Path, allow: set[str]) -> int`.
- Produces: tests documenting its diagnostic labels and exit status for artifact-set and hash differences.

- [ ] **Step 1: Write failing parameterized comparison tests**

Write minimal baseline/new JSON files containing `_timing` plus synthetic artifact hashes. Cover: changed value, entry present only in base, entry present only in new, and a changed entry supplied in `allow`. Assert unallowed cases return `1`, the allowed case returns `0`, and captured output contains `DIFF    <name>` or `allowed <name>` as appropriate.

- [ ] **Step 2: Run the focused comparison tests**

Run: `cd backend && uv run pytest tests/scripts/test_etl_equivalence.py -v`

Expected: PASS if current comparison behavior already matches the characterization; otherwise FAIL with the precise discrepancy to resolve without changing the documented interface.

- [ ] **Step 3: Make only a necessary compatibility fix, if the test exposed one**

Do not refactor `compare()` pre-emptively. If a discrepancy is found, preserve the current CLI format and change only the smallest code needed to satisfy the specified result semantics.

- [ ] **Step 4: Run script and ETL-focused regression tests**

Run: `cd backend && uv run pytest tests/scripts/test_etl_equivalence.py tests/etl/test_junctions.py -v`

Expected: PASS.

- [ ] **Step 5: Commit comparison coverage**

```bash
git add backend/tests/scripts/test_etl_equivalence.py backend/scripts/etl_equivalence.py
git commit -m "test: cover etl equivalence comparison results"
```

### Task 3: Document safe harness use and complete verification

**Files:**
- Modify: `backend/README.md`

**Interfaces:**
- Consumes: existing `etl_equivalence.py run` and `compare` commands.
- Produces: concise operational instructions stating the committed-override and external-scratch prerequisites.

- [ ] **Step 1: Add an ETL-equivalence README note**

Under the data-pipeline section, document commands for creating two baselines and comparing a new run. State that the committed `data/overrides/roundabouts.json` must exist, that the harness fails before running if it does not, and that its scratch directory must be outside the repository. State that the harness symlinks inputs read-only by intent and must not be used to generate or repair overrides.

- [ ] **Step 2: Run formatting, quality checks, and all backend tests**

Run: `cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`

Expected: every command exits 0.

- [ ] **Step 3: Optionally exercise a real-data equivalence run without changing repository data**

When the approved raw bundle is locally available, choose a new scratch directory outside the repository and run `uv run python scripts/etl_equivalence.py run <scratch>/base <scratch>/base.json`. Do not run it with a missing override or use it to create one. Record the result and elapsed step timings in the handoff; do not commit scratch output.

- [ ] **Step 4: Review focused ownership and commit documentation**

Run: `git diff --check` and inspect changed paths. Confirm no data, ETL-domain, schema, generated-contract, frontend, or CI file changed.

```bash
git add backend/README.md
git commit -m "docs: explain etl equivalence prerequisites"
```

## Final verification

- [ ] Run `git diff --check` and inspect `git diff --name-only <base>...HEAD`; only the three ownership areas may appear.
- [ ] Re-run the full backend verification command from Task 3 after the final commit.
- [ ] Report whether the optional real-data run was completed or skipped because the raw-data bundle was unavailable.
