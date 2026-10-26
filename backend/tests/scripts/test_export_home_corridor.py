"""The home corridor export, loaded from its script path like the CLI runs it."""

import importlib.util
import json
from pathlib import Path
from types import ModuleType

import polars as pl
from pyproj import Transformer
from shapely.geometry import LineString

from greenwave.artifacts import INTERSECTIONS_FILENAME
from greenwave.etl.config import METRIC_CRS
from greenwave.etl.graph_io import EDGES_FILENAME

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "export_home_corridor.py"
TO_LL = Transformer.from_crs(METRIC_CRS, "EPSG:4326", always_xy=True)
X0, Y0 = 7421000.0, 5547000.0
STEP = 200.0


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("export_home_corridor", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _node(i: int, j: int) -> tuple[float, float]:
    return X0 + i * STEP, Y0 + j * STEP


def _key(point: tuple[float, float]) -> str:
    lon, lat = TO_LL.transform(*point)
    return f"{lon:.7f},{lat:.7f}"


def _fixture(processed: Path) -> tuple[tuple[float, float], tuple[float, float]]:
    """A 3x3 grid; the middle row is the arterial the corridor should follow."""
    rows = []
    for j in range(3):
        for i in range(2):
            a, b = _node(i, j), _node(i + 1, j)
            rows.append((a, b, "primary" if j == 1 else "residential"))
    for i in range(3):
        for j in range(2):
            rows.append((_node(i, j), _node(i, j + 1), "residential"))
    edges = pl.DataFrame(
        {
            "u": [_key(a) for a, _, _ in rows],
            "v": [_key(b) for _, b, _ in rows],
            "highway": [h for _, _, h in rows],
            "length_m": [STEP] * len(rows),
            "reverse_twin": [False] * len(rows),
            "geometry_wkb": [LineString([a, b]).wkb for a, b, _ in rows],
        }
    )
    edges.write_parquet(processed / EDGES_FILENAME)
    points = [_node(0, 1), _node(1, 1), _node(1, 2)]
    lonlat = [TO_LL.transform(*p) for p in points]
    pl.DataFrame(
        {
            "intersection_id": ["INT-A", "INT-B", "INT-OFF"],
            "name": ["West", "Middle", "North"],
            "x_m": [p[0] for p in points],
            "y_m": [p[1] for p in points],
            "lon": [c[0] for c in lonlat],
            "lat": [c[1] for c in lonlat],
        }
    ).write_parquet(processed / INTERSECTIONS_FILENAME)
    start = TO_LL.transform(*_node(0, 1))
    end = TO_LL.transform(*_node(2, 1))
    return start, end


def _run(tmp_path: Path, name: str) -> tuple[dict, str]:
    processed = tmp_path / "processed"
    processed.mkdir(exist_ok=True)
    start, end = _fixture(processed)
    center = TO_LL.transform(*_node(1, 1))
    json_out, svg_out = tmp_path / f"{name}.json", tmp_path / f"{name}.svg"
    _load().export_home_corridor(
        processed, json_out, svg_out, start=start, end=end, center=center, span_x_m=1200.0
    )
    return json.loads(json_out.read_text(encoding="utf-8")), svg_out.read_text(encoding="utf-8")


def test_route_follows_arterial_and_lists_its_signals(tmp_path: Path) -> None:
    corridor, _ = _run(tmp_path, "a")
    signals = corridor["signals"]
    assert [s["id"] for s in signals] == ["INT-A", "INT-B"]
    assert all(0 <= s["t"] <= 1 for s in signals)
    assert signals[0]["t"] < signals[1]["t"]
    assert len(corridor["route"]["lonLat"]) >= 2


def test_svg_has_three_tiers_in_json_viewbox(tmp_path: Path) -> None:
    corridor, svg = _run(tmp_path, "b")
    assert corridor["viewBox"] == [0, 0, 1600, 1000]
    assert 'viewBox="0 0 1600 1000"' in svg
    for tier in ("major", "mid", "minor"):
        assert f'class="{tier}"' in svg


def test_provenance_recorded(tmp_path: Path) -> None:
    corridor, _ = _run(tmp_path, "c")
    provenance = corridor["provenance"]
    assert provenance["crs"] == METRIC_CRS
    assert set(provenance["sources"]) == {EDGES_FILENAME, INTERSECTIONS_FILENAME}


def test_output_is_deterministic(tmp_path: Path) -> None:
    first, first_svg = _run(tmp_path, "d")
    second, second_svg = _run(tmp_path, "e")
    for corridor in (first, second):
        corridor["provenance"].pop("generated_at")
    assert first == second
    assert first_svg == second_svg
