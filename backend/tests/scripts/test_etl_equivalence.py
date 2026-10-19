"""The ETL equivalence harness, loaded from its script path like the CLI runs it."""

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "etl_equivalence.py"


def _load_harness() -> ModuleType:
    spec = importlib.util.spec_from_file_location("etl_equivalence", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def harness() -> ModuleType:
    return _load_harness()


@pytest.fixture
def fake_backend(tmp_path: Path, harness: ModuleType, monkeypatch: pytest.MonkeyPatch) -> Path:
    backend = tmp_path / "repo" / "backend"
    (backend / "data" / "overrides").mkdir(parents=True)
    monkeypatch.setattr(harness, "BACKEND", backend)
    return backend


@pytest.mark.parametrize("as_directory", [False, True], ids=["missing", "directory"])
def test_run_requires_committed_override_before_creating_scratch(
    harness: ModuleType, fake_backend: Path, tmp_path: Path, as_directory: bool
) -> None:
    if as_directory:
        (fake_backend / "data" / "overrides" / "roundabouts.json").mkdir()
    scratch = tmp_path / "scratch"
    out = tmp_path / "out.json"

    with pytest.raises(SystemExit, match=r"roundabouts\.json"):
        harness.run(scratch, out)

    assert not (scratch / "data").exists()
    assert not out.exists()


def test_committed_override_preflight_accepts_regular_file(
    harness: ModuleType, fake_backend: Path
) -> None:
    override = fake_backend / "data" / "overrides" / "roundabouts.json"
    override.write_text('{"entries": []}\n', encoding="utf-8")

    assert harness.require_committed_override() == override
