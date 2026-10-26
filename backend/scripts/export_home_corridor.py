"""Write the home page corridor from ``road_edges.parquet`` and ``intersections.parquet``.

The home page plays a simulated green wave along a real Kraków corridor (Aleje Trzech Wieszczów)
over a drawing of the real road network. Both are baked here into committed frontend files:

- ``frontend/src/data/home-corridor.json``: the route (pixel path and lon/lat), its signals and
  provenance;
- ``frontend/public/home/krakow-roads.svg``: the road network in three tiers, white on transparent,
  used as an alpha mask so the page can colour it per theme.

Regenerating them is a manual step after ``run_etl.py``:

    uv run python scripts/export_home_corridor.py
"""

import json
from datetime import UTC, datetime
from itertools import pairwise
from pathlib import Path

import networkx as nx
import polars as pl
from pyproj import Transformer
from shapely import wkb
from shapely.geometry import LineString, Point

from greenwave.artifacts import INTERSECTIONS_FILENAME
from greenwave.dataset import DatasetSettings
from greenwave.etl.config import METRIC_CRS
from greenwave.etl.graph_io import EDGES_FILENAME

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
JSON_PATH = FRONTEND / "src" / "data" / "home-corridor.json"
SVG_PATH = FRONTEND / "public" / "home" / "krakow-roads.svg"

WIDTH, HEIGHT = 1600, 1000
# Aleje Trzech Wieszczów: Monte Cassino (south of the Vistula) north to Słowackiego.
START = (19.9235, 50.0478)
END = (19.9345, 50.0725)
# Frames the corridor in the right half of a 16:10 screen, leaving the left for the text.
CENTER = (19.911, 50.0598)

TIERS = {
    "major": {"motorway", "trunk", "primary", "motorway_link", "trunk_link", "primary_link"},
    "mid": {"secondary", "tertiary", "secondary_link", "tertiary_link"},
}
TIER_STYLE = {"minor": (0.35, 0.7), "mid": (0.65, 1.2), "major": (1.0, 2.0)}
FRAME_PAD_M = 600.0
SIMPLIFY_M = 2.0
ROUTE_SIMPLIFY_M = 1.5
NON_ARTERIAL_COST = 4.0
SIGNAL_RADIUS_M = 40.0
MIN_SIGNAL_GAP = 0.035
PHONE_PAD_PX = 60.0
PHONE_ASPECT = 0.46


def _tier(highway: str) -> str:
    return next((tier for tier, kinds in TIERS.items() if highway in kinds), "minor")


def _phone_view_box(points: list[tuple[float, float]]) -> list[float]:
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    x0, x1 = min(xs) - PHONE_PAD_PX, max(xs) + PHONE_PAD_PX
    y0, y1 = min(ys) - PHONE_PAD_PX, max(ys) + PHONE_PAD_PX
    w, h = x1 - x0, y1 - y0
    if w / h < PHONE_ASPECT:
        grow = h * PHONE_ASPECT - w
        x0, w = x0 - grow / 2, w + grow
    else:
        grow = w / PHONE_ASPECT - h
        y0, h = y0 - grow / 2, h + grow
    return [round(v, 1) for v in (x0, y0, w, h)]


def export_home_corridor(
    processed: Path,
    json_out: Path,
    svg_out: Path,
    *,
    start: tuple[float, float] = START,
    end: tuple[float, float] = END,
    center: tuple[float, float] = CENTER,
    span_x_m: float = 7600.0,
) -> dict:
    to_metric = Transformer.from_crs("EPSG:4326", METRIC_CRS, always_xy=True)
    to_lonlat = Transformer.from_crs(METRIC_CRS, "EPSG:4326", always_xy=True)
    cx, cy = to_metric.transform(*center)
    span_y_m = span_x_m * HEIGHT / WIDTH

    def to_px(x: float, y: float) -> tuple[float, float]:
        return (
            (x - (cx - span_x_m / 2)) / span_x_m * WIDTH,
            ((cy + span_y_m / 2) - y) / span_y_m * HEIGHT,
        )

    def in_frame(x: float, y: float, pad: float) -> bool:
        return abs(x - cx) < span_x_m / 2 + pad and abs(y - cy) < span_y_m / 2 + pad

    def path_d(points: list[tuple[float, float]]) -> str:
        return "M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in points)

    edges = pl.read_parquet(processed / EDGES_FILENAME).filter(~pl.col("reverse_twin"))
    tiers: dict[str, list[str]] = {"minor": [], "mid": [], "major": []}
    graph = nx.Graph()
    node_xy: dict[str, tuple[float, float]] = {}
    for row in edges.iter_rows(named=True):
        line = wkb.loads(row["geometry_wkb"])
        tier = _tier(row["highway"])
        cost = row["length_m"] * (NON_ARTERIAL_COST if tier == "minor" else 1.0)
        graph.add_edge(row["u"], row["v"], weight=cost, geom=line)
        node_xy.setdefault(row["u"], line.coords[0])
        node_xy.setdefault(row["v"], line.coords[-1])
        if in_frame(line.centroid.x, line.centroid.y, FRAME_PAD_M):
            tiers[tier].append(path_d([to_px(*c) for c in line.simplify(SIMPLIFY_M).coords]))

    def nearest(lonlat: tuple[float, float]) -> str:
        target = Point(*to_metric.transform(*lonlat))
        return min(node_xy, key=lambda node: (Point(node_xy[node]).distance(target), node))

    nodes = nx.shortest_path(graph, nearest(start), nearest(end), weight="weight")
    coords: list[tuple[float, float]] = []
    for a, b in pairwise(nodes):
        seg = list(graph.edges[a, b]["geom"].coords)
        here = Point(node_xy[a])
        if Point(seg[0]).distance(here) > Point(seg[-1]).distance(here):
            seg.reverse()
        coords.extend(seg if not coords else seg[1:])
    route = LineString(coords).simplify(ROUTE_SIMPLIFY_M)
    route_px = LineString([to_px(*c) for c in route.coords])

    signals: list[dict] = []
    intersections = pl.read_parquet(processed / INTERSECTIONS_FILENAME)
    candidates = []
    for row in intersections.iter_rows(named=True):
        if route.distance(Point(row["x_m"], row["y_m"])) >= SIGNAL_RADIUS_M:
            continue
        x, y = to_px(row["x_m"], row["y_m"])
        t = route_px.project(Point(x, y)) / route_px.length
        candidates.append((t, row, x, y))
    for t, row, x, y in sorted(candidates, key=lambda c: (c[0], c[1]["intersection_id"])):
        if signals and t - signals[-1]["t"] <= MIN_SIGNAL_GAP:
            continue
        signals.append(
            {
                "id": row["intersection_id"],
                "name": row["name"],
                "t": round(t, 4),
                "x": round(x, 1),
                "y": round(y, 1),
                "lon": round(row["lon"], 6),
                "lat": round(row["lat"], 6),
            }
        )

    corridor = {
        "provenance": {
            "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "sources": [EDGES_FILENAME, INTERSECTIONS_FILENAME],
            "crs": METRIC_CRS,
            "center": list(center),
            "span_x_m": span_x_m,
        },
        "viewBox": [0, 0, WIDTH, HEIGHT],
        "phoneViewBox": _phone_view_box(list(route_px.coords)),
        "route": {
            "path": path_d(list(route_px.coords)),
            "lonLat": [[round(v, 6) for v in to_lonlat.transform(*c)] for c in route.coords],
        },
        "signals": signals,
    }
    json_out.parent.mkdir(parents=True, exist_ok=True)
    json_out.write_text(json.dumps(corridor, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    paths = "".join(
        f'<path class="{tier}" stroke-opacity="{opacity}" stroke-width="{width}" '
        f'd="{"".join(tiers[tier])}"/>'
        for tier, (opacity, width) in TIER_STYLE.items()
    )
    svg_out.parent.mkdir(parents=True, exist_ok=True)
    svg_out.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}" fill="none" '
        f'stroke="#fff" stroke-linecap="round" stroke-linejoin="round">{paths}</svg>\n',
        encoding="utf-8",
    )
    return corridor


def main() -> None:
    corridor = export_home_corridor(DatasetSettings().processed_dir, JSON_PATH, SVG_PATH)
    print(f"wrote {JSON_PATH} ({len(corridor['signals'])} signals) and {SVG_PATH}")


if __name__ == "__main__":
    main()
