"""Recorded provenance of the raw inputs, loaded from the script path like the CLI runs it."""

import importlib.util
from pathlib import Path
from types import ModuleType

from greenwave.etl.municipal_addresses import EMUIA_AKTUALNOSC_PATH, EMUIA_RELATIVE_PATH

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "build_manifest.py"


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("build_manifest", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_emuia_sources_recorded_with_attribution() -> None:
    sources = {entry[0]: entry for entry in _load()._SOURCES}

    _, source, url, _, licence, attribution, notes = sources[EMUIA_RELATIVE_PATH.as_posix()]
    assert url == "https://msip.krakow.pl/dataset/1492"
    assert "Punkty adresowe (EMUiA)" in source
    assert attribution is not None and "Punkty adresowe (EMUiA)" in attribution
    assert licence is not None and "regulaminem MSIP" in (notes or "")
    assert "EPSG:2178" in (notes or "")
    assert EMUIA_AKTUALNOSC_PATH.as_posix() in sources
