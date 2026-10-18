"""Visual aid for choosing the signal-cluster radius: named junctions at several radii.

Writes one self-contained HTML file (inline SVG, no network, no basemap). Roads come from the
OSM extract itself, so the picture shows the same data the ETL sees. This is a decision aid, not
an ETL artifact: nothing here feeds the processed outputs.
"""

import html
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import shapely
from numpy.typing import NDArray

from greenwave.etl.clustering import single_linkage_labels
from greenwave.etl.config import (
    CLUSTER_MAP_RADII_METERS,
    NON_BLOCKING_SIGNAL_TAGS,
)
from greenwave.etl.geo import project_lines, project_points
from greenwave.etl.profile_osm import DrivableWay, LonLat, OsmScan, tag
from greenwave.etl.road_rules import is_routable_way

_PAGE_TEMPLATE = Path(__file__).with_name("cluster_map_template.html")
_WINDOW_HALF_SIZE_METERS = 150.0
_PANEL_PIXELS = 300
_PALETTE = ("#1b6ca8", "#d1495b", "#2a9d8f", "#e09f3e", "#7b4fa3", "#6a994e", "#c1666b", "#118ab2")
_ROAD_WIDTH_BY_CLASS = {
    "motorway": 3.0,
    "trunk": 3.0,
    "primary": 3.0,
    "secondary": 2.4,
    "tertiary": 2.0,
}


@dataclass(frozen=True, slots=True)
class JunctionSpec:
    """A junction located by street names: ``names_b`` set means the vertex shared by both."""

    label: str
    names_a: tuple[str, ...]
    names_b: tuple[str, ...] | None = None


JUNCTIONS: tuple[JunctionSpec, ...] = (
    JunctionSpec("Rondo Mogilskie", ("Rondo Mogilskie",)),
    JunctionSpec("Rondo Grunwaldzkie", ("Rondo Grunwaldzkie",)),
    JunctionSpec("Aleje / Czarnowiejska", ("Czarnowiejska",), ("Mickiewicza",)),
    JunctionSpec("Aleje / Reymonta", ("Reymonta",), ("Mickiewicza",)),
    JunctionSpec("Rondo Czyżyńskie", ("Rondo Czyżyńskie",)),
    JunctionSpec("Rondo Matecznego", ("Rondo Antoniego Matecznego",)),
    JunctionSpec("Rondo Ofiar Katynia", ("Rondo Ofiar Katynia",)),
    JunctionSpec("Rondo Kocmyrzowskie", ("Rondo Kocmyrzowskie",)),
    JunctionSpec("Rondo Barei", ("Rondo Stanisława Barei",)),
    JunctionSpec("Rondo 308 Dywizjonu", ("Rondo 308 Dywizjonu",)),
    JunctionSpec("Rondo Grzegórzeckie", ("Rondo Grzegórzeckie",)),
    JunctionSpec("Rondo Hipokratesa", ("Rondo Hipokratesa",)),
)


def _matching_ways(ways: list[DrivableWay], fragments: tuple[str, ...]) -> list[DrivableWay]:
    wanted = [fragment.casefold() for fragment in fragments]
    return [
        way
        for way in ways
        if any(fragment in (tag(way.properties, "name") or "").casefold() for fragment in wanted)
    ]


def locate_junction(spec: JunctionSpec, ways: list[DrivableWay]) -> LonLat | None:
    """Return the junction centre (lon, lat), or None when the names do not identify one."""
    matches_a = _matching_ways(ways, spec.names_a)
    if spec.names_b is None:
        # A roundabout is named on its approaches too; prefer the ring so the centre is its middle.
        ring = [w for w in matches_a if tag(w.properties, "junction") in ("roundabout", "circular")]
        vertices = {vertex for way in (ring or matches_a) for vertex in way.coordinates}
    else:
        vertices = {vertex for way in matches_a for vertex in way.coordinates}
        vertices &= {
            vertex for way in _matching_ways(ways, spec.names_b) for vertex in way.coordinates
        }
    if not vertices:
        return None
    return float(np.mean([lon for lon, _ in vertices])), float(
        np.mean([lat for _, lat in vertices])
    )


def _fmt(value: float) -> str:
    return f"{value:.1f}"


def _cluster_pairs(xy: NDArray[np.float64], radius_meters: float) -> NDArray[np.int64]:
    points = shapely.points(xy)
    pairs = shapely.STRtree(points).query(points, predicate="dwithin", distance=radius_meters)
    mask = pairs[0] < pairs[1]
    return np.asarray(pairs[:, mask], dtype=np.int64)


@dataclass(frozen=True, slots=True)
class _SignalLayer:
    """Projected signal nodes and signalised crossings, shared by every junction panel."""

    signals_xy: NDArray[np.float64]
    signal_variants: list[str]
    crossings_xy: NDArray[np.float64]


@dataclass(frozen=True, slots=True)
class _PanelFrame:
    """The square window of one panel, centred on a junction, and its metre → pixel mapping."""

    center_xy: NDArray[np.float64]
    half: float = _WINDOW_HALF_SIZE_METERS

    @property
    def scale(self) -> float:
        return _PANEL_PIXELS / (2 * self.half)

    def box(self) -> shapely.Geometry:
        x, y = self.center_xy
        return shapely.box(x - self.half, y - self.half, x + self.half, y + self.half)

    def to_pixels(self, x: float, y: float) -> tuple[float, float]:
        return (
            (x - self.center_xy[0] + self.half) * self.scale,
            (self.center_xy[1] - y + self.half) * self.scale,
        )


def _road_parts(frame: _PanelFrame, road_lines: list[tuple[shapely.Geometry, str]]) -> list[str]:
    window = frame.box()
    parts = []
    for line, highway in road_lines:
        clipped = shapely.intersection(line, window)
        for part in getattr(clipped, "geoms", [clipped]):
            if part.is_empty or part.geom_type != "LineString":
                continue
            points = " ".join(
                "{:.1f},{:.1f}".format(*frame.to_pixels(float(x), float(y))) for x, y in part.coords
            )
            width = _ROAD_WIDTH_BY_CLASS.get(highway.removesuffix("_link"), 1.2)
            parts.append(f'<polyline class="road" points="{points}" stroke-width="{width}"/>')
    return parts


def _crossing_parts(frame: _PanelFrame, crossings_xy: NDArray[np.float64]) -> list[str]:
    parts = []
    for x, y in crossings_xy:
        if abs(x - frame.center_xy[0]) <= frame.half and abs(y - frame.center_xy[1]) <= frame.half:
            px, py = frame.to_pixels(float(x), float(y))
            parts.append(
                f'<rect class="crossing" x="{_fmt(px - 1.5)}" y="{_fmt(py - 1.5)}" '
                f'width="3" height="3"/>'
            )
    return parts


def _pair_parts(
    frame: _PanelFrame,
    signals_xy: NDArray[np.float64],
    in_window: NDArray[np.int64],
    pairs: NDArray[np.int64],
    colour_of: Callable[[int], str],
) -> list[str]:
    """Lines joining signals of one cluster when both ends are inside the window."""
    in_window_set = set(in_window.tolist())
    parts = []
    for left, right in pairs.T.tolist():
        if left in in_window_set and right in in_window_set:
            x1, y1 = frame.to_pixels(*map(float, signals_xy[left]))
            x2, y2 = frame.to_pixels(*map(float, signals_xy[right]))
            parts.append(
                f'<line x1="{_fmt(x1)}" y1="{_fmt(y1)}" x2="{_fmt(x2)}" y2="{_fmt(y2)}" '
                f'stroke="{colour_of(left)}" stroke-width="2" stroke-opacity="0.55"/>'
            )
    return parts


def _signal_part(px: float, py: float, colour: str, variant: str) -> str:
    """Hollow circle: non-blocking signal; square: controller; dot: ordinary signal."""
    if variant in NON_BLOCKING_SIGNAL_TAGS:
        return (
            f'<circle cx="{_fmt(px)}" cy="{_fmt(py)}" r="4.5" fill="none" '
            f'stroke="{colour}" stroke-width="2"/>'
        )
    if variant == "controller":
        return f'<rect x="{_fmt(px - 4)}" y="{_fmt(py - 4)}" width="8" height="8" fill="{colour}"/>'
    return f'<circle cx="{_fmt(px)}" cy="{_fmt(py)}" r="4" fill="{colour}"/>'


def _scale_bar(frame: _PanelFrame) -> str:
    bar = 50 * frame.scale
    return (
        f'<line class="scale" x1="10" y1="{_PANEL_PIXELS - 10}" x2="{_fmt(10 + bar)}" '
        f'y2="{_PANEL_PIXELS - 10}"/>'
        f'<text class="scale-text" x="10" y="{_PANEL_PIXELS - 14}">50 m</text></svg>'
    )


def _panel_svg(
    frame: _PanelFrame,
    radius_meters: float,
    road_lines: list[tuple[shapely.Geometry, str]],
    layer: _SignalLayer,
    labels: NDArray[np.int64],
    pairs: NDArray[np.int64],
) -> tuple[str, int, int]:
    """One SVG panel; returns (svg, signals in window, clusters in window)."""
    signals_xy = layer.signals_xy
    in_window = np.flatnonzero(
        (np.abs(signals_xy[:, 0] - frame.center_xy[0]) <= frame.half)
        & (np.abs(signals_xy[:, 1] - frame.center_xy[1]) <= frame.half)
    )
    cluster_sizes = Counter(labels.tolist())
    palette_index = {label: i for i, label in enumerate(sorted(set(labels[in_window].tolist())))}

    def cluster_colour(index: int) -> str:
        return _PALETTE[palette_index[int(labels[index])] % len(_PALETTE)]

    parts = [
        f'<svg viewBox="0 0 {_PANEL_PIXELS} {_PANEL_PIXELS}" role="img" '
        f'aria-label="signals at {radius_meters:g} m">',
        *_road_parts(frame, road_lines),
        *_crossing_parts(frame, layer.crossings_xy),
    ]
    parts += _pair_parts(frame, signals_xy, in_window, pairs, cluster_colour)
    for index in in_window.tolist():
        px, py = frame.to_pixels(*map(float, signals_xy[index]))
        colour = cluster_colour(index) if cluster_sizes[int(labels[index])] > 1 else "#555555"
        parts.append(_signal_part(px, py, colour, layer.signal_variants[index]))
    parts.append(_scale_bar(frame))
    return "".join(parts), len(in_window), len(palette_index)


@dataclass(frozen=True, slots=True)
class _RoadIndex:
    """Routable roads (approved definition, so side clutter is gone), projected and indexed."""

    ways: list[DrivableWay]
    projected: NDArray[np.object_]
    tree: shapely.STRtree

    def lines_in(self, window: shapely.Geometry) -> list[tuple[shapely.Geometry, str]]:
        indices = self.tree.query(window, predicate="intersects")
        return [(self.projected[i], self.ways[i].highway) for i in indices.tolist()]


def _signal_layer(scan: OsmScan) -> _SignalLayer:
    signals = scan.signal_nodes
    signals_xy = project_points(
        np.array([s.lon for s in signals]), np.array([s.lat for s in signals])
    )
    signal_variants = [tag(s.properties, "traffic_signals") or "" for s in signals]
    crossings = [c for c in scan.signalised_crossings if tag(c.properties, "highway") == "crossing"]
    crossings_xy = project_points(
        np.array([c.lon for c in crossings]), np.array([c.lat for c in crossings])
    )
    return _SignalLayer(signals_xy, signal_variants, crossings_xy)


def _road_index(scan: OsmScan) -> _RoadIndex:
    ways = [w for w in scan.drivable_ways if is_routable_way(w)]
    projected = project_lines([shapely.LineString(w.coordinates) for w in ways])
    return _RoadIndex(ways, projected, shapely.STRtree(projected))


def _junction_section(
    spec: JunctionSpec,
    center: LonLat,
    roads: _RoadIndex,
    layer: _SignalLayer,
    labels_by_radius: dict[float, NDArray[np.int64]],
    pairs_by_radius: dict[float, NDArray[np.int64]],
) -> str:
    frame = _PanelFrame(project_points(np.array([center[0]]), np.array([center[1]]))[0])
    road_lines = roads.lines_in(frame.box())
    panels = []
    for radius in CLUSTER_MAP_RADII_METERS:
        svg, node_count, cluster_count = _panel_svg(
            frame, radius, road_lines, layer, labels_by_radius[radius], pairs_by_radius[radius]
        )
        panels.append(
            f"<figure><figcaption><b>{radius:g} m</b> · {node_count} signal nodes → "
            f"{cluster_count} clusters</figcaption>{svg}</figure>"
        )
    return (
        f"<section><h2>{html.escape(spec.label)}"
        f" <small>{center[1]:.5f}, {center[0]:.5f}</small></h2>"
        f'<div class="row">{"".join(panels)}</div></section>'
    )


def render_cluster_map(scan: OsmScan, output_path: Path) -> list[str]:
    """Write the HTML map; returns the labels of junctions that could not be located."""
    layer = _signal_layer(scan)
    roads = _road_index(scan)
    signals_xy = layer.signals_xy
    labels_by_radius = {r: single_linkage_labels(signals_xy, r) for r in CLUSTER_MAP_RADII_METERS}
    pairs_by_radius = {r: _cluster_pairs(signals_xy, r) for r in CLUSTER_MAP_RADII_METERS}

    sections: list[str] = []
    missing: list[str] = []
    for spec in JUNCTIONS:
        center = locate_junction(spec, roads.ways)
        if center is None:
            missing.append(spec.label)
            continue
        sections.append(
            _junction_section(spec, center, roads, layer, labels_by_radius, pairs_by_radius)
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        _PAGE_TEMPLATE.read_text(encoding="utf-8")
        .replace("__MISSING__", _missing_note(missing))
        .replace("__BODY__", "\n".join(sections)),
        encoding="utf-8",
    )
    return missing


def _missing_note(missing: list[str]) -> str:
    if not missing:
        return ""
    return (
        "<p class='note'>Not located from street names: " + html.escape(", ".join(missing)) + "</p>"
    )
