# ETL Equivalence Preflight Design

**Status:** Approved 2026-10-18

## Intent

`backend/scripts/etl_equivalence.py` is a behavior-preservation guard for refactors.
It symlinks the repository's raw and overrides directories into an external scratch
directory and invokes every ETL command. The committed
`backend/data/overrides/roundabouts.json` is a manually verified input to that run.

When that file is missing, the current `draft-overrides` step can generate a draft via
the symlinked overrides directory. That undermines equivalence evidence and can write
to the repository. The harness must reject this invalid precondition before it creates
scratch state or invokes ETL code.

## Goals

1. `etl_equivalence.py run` fails clearly and non-zero when the expected override path
   is not a regular file.
2. The preflight runs before scratch creation, symlink creation, dynamic import of
   `run_etl.py`, or any ETL step.
3. The guard has focused pytest coverage for the missing-input behavior and comparison
   result semantics.
4. The backend operational documentation states this prerequisite and the harness's
   read-only repository intent.

## Non-goals

- Do not make a missing override invalid for the general ETL domain model.
  `greenwave.etl.overrides.load_overrides()` continues to treat an absent file as an
  empty override set for draft-generation and existing synthetic tests.
- Do not alter roundabout override contents, raw data, processed artifacts, ETL steps,
  output hashes, generated API contracts, or data-pipeline configuration.
- Do not run the full real-data ETL in CI or commit a raw-data fixture.
- Do not add a dependency, lockfile, root configuration, or schema change.

## Existing architecture and decisions

- `backend/data/overrides/roundabouts.json` is committed and documented as a hand-made,
  human-verified ETL input in `backend/README.md`.
- `run_etl.py draft-overrides` intentionally writes a draft to the override location
  when the committed file is absent; it must retain that normal command behavior.
- `etl_equivalence.py` alone creates symlinked scratch inputs and promises not to write
  inside the repository, so it owns the stricter precondition.
- Data-pipeline invariants require deterministic, validated inputs and clear failure for
  incomplete inputs. This is simulation-only data preparation.

## Design

Introduce a small harness-local preflight helper, e.g.

```python
def require_committed_override() -> Path:
    path = BACKEND / "data" / "overrides" / OVERRIDE_FILENAME
    if not path.is_file():
        raise SystemExit(f"committed override file is missing: {path}")
    return path
```

Use the existing `OVERRIDE_FILENAME` constant rather than duplicating the filename.
Call the helper as the first operation in `run()`, before resolving or making the
scratch `data/processed` directory. A regular file is sufficient: the harness validates
the presence of its required repository input; ETL parsing remains responsible for
content validation.

Load the script in pytest through its file path so the tests exercise the executable
module rather than a copied helper. Tests may monkeypatch its `BACKEND` constant to a
temporary fake repository. The missing-file test must prove that `run()` raises before
the scratch `data/` path exists. Comparison tests write tiny JSON baselines and assert
that added, removed, altered, and allowed entries produce the documented return code
and diagnostics.

## Ownership boundary

This track owns `backend/scripts/etl_equivalence.py`, its dedicated tests under
`backend/tests/scripts/`, and the relevant backend README note. It must not modify
`run_etl.py`, ETL domain modules, override loading semantics, data files, frontend
files, generated contracts, root documentation, or CI configuration.

## Acceptance criteria

- A missing `backend/data/overrides/roundabouts.json` makes `run` exit non-zero with an
  actionable path-specific message before a scratch directory is populated.
- A present regular override file passes the preflight; the rest of `run()` retains its
  existing behavior.
- `compare` continues to return non-zero for unallowed additions, removals, and hash
  changes, and zero only when every difference is allowed.
- `load_overrides(path)` still returns an empty `OverrideFile` for an absent arbitrary
  path.
- Backend formatting, lint, type checks, and tests pass; a real-data equivalence run,
  when data are available, uses a scratch directory outside the repository.
