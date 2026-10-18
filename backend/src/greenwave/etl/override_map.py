"""One-page visual check of the roundabout override file (inline SVG, no network, no basemap)."""

import html
import math
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import networkx as nx
import numpy as np
import shapely
from numpy.typing import NDArray

from greenwave.etl.overrides import OverrideFile, RoundaboutOverride

_PANEL_PIXELS = 640
_MARGIN_METERS = 90.0
_TEMPLATE = Path(__file__).with_name("override_map_template.html")


Projector = Callable[[float, float], tuple[float, float]]


def _polyline(css_class: str, geometry: shapely.Geometry, to_px: Projector) -> str:
    points = " ".join(
        "{:.1f},{:.1f}".format(*to_px(x, y)) for x, y in shapely.get_coordinates(geometry)
    )
    return f'<polyline class="{css_class}" points="{points}"/>'


def _arrow(geometry: shapely.LineString, to_px: Projector, size: float = 15.0) -> str:
    """A small triangle at the middle of the edge pointing in the direction of travel."""
    mid = geometry.interpolate(0.5, normalized=True)
    before = geometry.interpolate(0.45, normalized=True)
    after = geometry.interpolate(0.55, normalized=True)
    angle = math.atan2(-(after.y - before.y), after.x - before.x)  # pixel y points down
    cx, cy = to_px(mid.x, mid.y)
    points = [
        (cx + size * math.cos(angle), cy + size * math.sin(angle)),
        (cx + size * 0.6 * math.cos(angle + 2.5), cy + size * 0.6 * math.sin(angle + 2.5)),
        (cx + size * 0.6 * math.cos(angle - 2.5), cy + size * 0.6 * math.sin(angle - 2.5)),
    ]
    return " ".join(f"{px:.1f},{py:.1f}" for px, py in points)


@dataclass(frozen=True, slots=True)
class _Frame:
    """Square panel window around the listed edges (plus a margin) and its metre → pixel map."""

    min_x: float
    min_y: float
    max_x: float
    max_y: float
    scale: float

    @classmethod
    def around(cls, focus: list[shapely.Geometry]) -> "_Frame":
        min_x, min_y, max_x, max_y = shapely.total_bounds(np.array(focus, dtype=object))
        min_x, min_y = min_x - _MARGIN_METERS, min_y - _MARGIN_METERS
        max_x, max_y = max_x + _MARGIN_METERS, max_y + _MARGIN_METERS
        span = max(max_x - min_x, max_y - min_y)
        return cls(min_x, min_y, max_x, max_y, _PANEL_PIXELS / span)

    def to_px(self, x: float, y: float) -> tuple[float, float]:
        return (x - self.min_x) * self.scale, (self.max_y - y) * self.scale


def _signal_circles(frame: _Frame, signals_xy: NDArray[np.float64]) -> list[str]:
    inside = (
        (signals_xy[:, 0] >= frame.min_x)
        & (signals_xy[:, 0] <= frame.max_x)
        & (signals_xy[:, 1] >= frame.min_y)
        & (signals_xy[:, 1] <= frame.max_y)
    )
    circles = []
    for x, y in signals_xy[inside]:
        px, py = frame.to_px(float(x), float(y))
        circles.append(f'<circle class="signal" cx="{px:.1f}" cy="{py:.1f}" r="4.5"/>')
    return circles


def _panel_svg(
    frame: _Frame,
    ring: list[shapely.Geometry],
    arms: list[shapely.Geometry],
    all_geometries: NDArray[np.object_],
    signals_xy: NDArray[np.float64],
) -> str:
    to_px = frame.to_px
    window = shapely.box(frame.min_x, frame.min_y, frame.max_x, frame.max_y)
    parts = [f'<svg viewBox="0 0 {_PANEL_PIXELS} {_PANEL_PIXELS}" role="img">']
    for geometry in all_geometries[shapely.intersects(all_geometries, window)]:
        parts.append(_polyline("road", geometry, to_px))
    for geometry in arms:
        parts.append(_polyline("arm", geometry, to_px))
    for geometry in ring:
        parts.append(
            _polyline("ring", geometry, to_px)
            + f'<polygon class="arrow" points="{_arrow(geometry, to_px)}"/>'
        )
    parts += _signal_circles(frame, signals_xy)
    scale_px = 50 * frame.scale
    parts.append(
        f'<line class="scale" x1="12" y1="{_PANEL_PIXELS - 14}" x2="{12 + scale_px:.1f}" '
        f'y2="{_PANEL_PIXELS - 14}"/>'
        f'<text class="scale-text" x="12" y="{_PANEL_PIXELS - 20}">50 m</text></svg>'
    )
    return "".join(parts)


def _panel(
    entry: RoundaboutOverride,
    graph: nx.MultiDiGraph,
    all_geometries: NDArray[np.object_],
    signals_xy: NDArray[np.float64],
) -> str:
    ring_ids, arm_ids = set(entry.ring_edge_ids), set(entry.entry_arm_edge_ids)
    ring = [d["geometry"] for *_, d in graph.edges(data=True) if d["base_edge_id"] in ring_ids]
    arms = [d["geometry"] for *_, d in graph.edges(data=True) if d["base_edge_id"] in arm_ids]
    focus = ring or arms
    if not focus:
        return (
            f"<section><h2>{html.escape(entry.name)}</h2>"
            f"<p class='note'>No edges listed. {html.escape(entry.notes or '')}</p></section>"
        )
    svg = _panel_svg(_Frame.around(focus), ring, arms, all_geometries, signals_xy)
    status = "verified" if entry.verified else "NOT verified"
    return (
        f"<section><h2>{html.escape(entry.name)} <small>{status} · "
        f"{len(entry.ring_edge_ids)} ring edges · "
        f"{len(entry.entry_arm_edge_ids)} entry-arm edges</small></h2>"
        f"<p class='note'>{html.escape(entry.notes or '')}</p>{svg}</section>"
    )


def render_override_map(
    graph: nx.MultiDiGraph,
    overrides: OverrideFile,
    signals_xy: NDArray[np.float64],
    output_path: Path,
) -> None:
    geometries = np.array(
        [d["geometry"] for *_, d in graph.edges(data=True) if not d["reverse_twin"]], dtype=object
    )
    body = "\n".join(_panel(entry, graph, geometries, signals_xy) for entry in overrides.entries)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        _TEMPLATE.read_text(encoding="utf-8").replace("__BODY__", body), encoding="utf-8"
    )
