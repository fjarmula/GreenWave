import json
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from conftest import Layout
from greenwave.dataset import DatasetError, MissingArtifactError, load_dataset
from greenwave.main import create_app

BACKEND = Path(__file__).resolve().parents[2]


def test_startup_fails_on_a_bad_directory(tmp_path: Path) -> None:
    app = create_app(processed_dir=tmp_path / "empty", manifest_path=tmp_path / "MANIFEST.json")

    with pytest.raises(MissingArtifactError), TestClient(app):
        pass


def test_startup_loads_a_good_directory_and_health_is_ok(layout: Layout) -> None:
    app = create_app(processed_dir=layout.processed, manifest_path=layout.manifest)

    with TestClient(app) as client:
        assert client.get("/api/v1/health").json() == {"status": "ok"}
        assert app.state.dataset.counts.intersections == 2


def test_startup_uses_an_injected_dataset_without_reading_anything(layout: Layout) -> None:
    dataset = load_dataset(layout.processed, layout.manifest)
    app = create_app(dataset=dataset)

    with TestClient(app) as client:
        assert client.get("/api/v1/health").json() == {"status": "ok"}
        assert app.state.dataset is dataset


def test_dataset_and_directory_are_mutually_exclusive(layout: Layout) -> None:
    dataset = load_dataset(layout.processed, layout.manifest)

    with pytest.raises(ValueError, match="either"):
        create_app(dataset=dataset, processed_dir=layout.processed)


def test_default_paths_come_from_settings(layout: Layout, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GREENWAVE_PROCESSED_DIR", str(layout.processed))
    monkeypatch.setenv("GREENWAVE_RAW_MANIFEST_PATH", str(layout.manifest))

    with TestClient(create_app()) as client:
        assert client.get("/api/v1/health").status_code == 200


def test_failed_startup_error_is_a_dataset_error(tmp_path: Path) -> None:
    app = create_app(processed_dir=tmp_path, manifest_path=tmp_path / "m.json")

    with pytest.raises(DatasetError), TestClient(app):
        pass


def test_importing_the_app_module_loads_no_data() -> None:
    """A fresh interpreter, pointed at a directory that does not exist, still imports it."""
    code = (
        "import greenwave.main, sys;"
        "assert not hasattr(greenwave.main.app.state, 'dataset');"
        "assert 'greenwave.dataset.loader' in sys.modules"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        env={"GREENWAVE_PROCESSED_DIR": "/nonexistent", "PATH": ""},
        capture_output=True,
        text=True,
        check=False,
        cwd=BACKEND,
    )
    assert result.returncode == 0, result.stderr


def test_openapi_document_is_unchanged() -> None:
    committed = json.loads((BACKEND.parent / "contracts" / "openapi.json").read_text())

    assert create_app().openapi() == committed
