"""The station snapshot export, loaded from its script path like the CLI runs it."""

import importlib.util
from pathlib import Path
from types import ModuleType

import polars as pl

from greenwave.artifacts import STATIONS_FILENAME
from greenwave.schemas import StationsResponse
from tests.support.processed import Layout

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "export_station_snapshot.py"


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("export_station_snapshot", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_snapshot_validates_and_is_sorted(layout: Layout, tmp_path: Path) -> None:
    output = tmp_path / "stations.snapshot.json"

    _load().export_snapshot(layout.processed / STATIONS_FILENAME, output)

    snapshot = StationsResponse.model_validate_json(output.read_text(encoding="utf-8"))
    ids = [s.station_id for s in snapshot.stations]
    assert ids == sorted(ids)
    assert len(ids) == pl.read_parquet(layout.processed / STATIONS_FILENAME).height


def test_snapshot_is_byte_stable(layout: Layout, tmp_path: Path) -> None:
    first, second = tmp_path / "a.json", tmp_path / "b.json"
    module = _load()

    module.export_snapshot(layout.processed / STATIONS_FILENAME, first)
    module.export_snapshot(layout.processed / STATIONS_FILENAME, second)

    assert first.read_bytes() == second.read_bytes()
