"""Visual aid for choosing the signal-cluster radius: named junctions at several radii.

Writes one self-contained HTML file (inline SVG, no network, no basemap). Roads come from the
OSM extract itself, so the picture shows the same data the ETL sees. This is a decision aid, not
an ETL artifact: nothing here feeds the processed outputs.
"""

import html
from collections import Counter
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


def _panel_svg(
    *,
    center_xy: NDArray[np.float64],
    radius_meters: float,
    road_lines: list[tuple[shapely.Geometry, str]],
    signals_xy: NDArray[np.float64],
    signal_variants: list[str],
    labels: NDArray[np.int64],
    pairs: NDArray[np.int64],
    crossings_xy: NDArray[np.float64],
) -> tuple[str, int, int]:
    """One SVG panel; returns (svg, signals in window, clusters in window)."""
    half = _WINDOW_HALF_SIZE_METERS
    scale = _PANEL_PIXELS / (2 * half)

    def to_pixels(x: float, y: float) -> tuple[float, float]:
        return (x - center_xy[0] + half) * scale, (center_xy[1] - y + half) * scale

    window = shapely.box(
        center_xy[0] - half, center_xy[1] - half, center_xy[0] + half, center_xy[1] + half
    )
    in_window = np.flatnonzero(
        (np.abs(signals_xy[:, 0] - center_xy[0]) <= half)
        & (np.abs(signals_xy[:, 1] - center_xy[1]) <= half)
    )
    window_labels = labels[in_window]
    cluster_sizes = Counter(labels.tolist())
    palette_index = {label: i for i, label in enumerate(sorted(set(window_labels.tolist())))}

    parts = [
        f'<svg viewBox="0 0 {_PANEL_PIXELS} {_PANEL_PIXELS}" role="img" '
        f'aria-label="signals at {radius_meters:g} m">'
    ]
    for line, highway in road_lines:
        clipped = shapely.intersection(line, window)
        for part in getattr(clipped, "geoms", [clipped]):
            if part.is_empty or part.geom_type != "LineString":
                continue
            points = " ".join(
                "{:.1f},{:.1f}".format(*to_pixels(float(x), float(y))) for x, y in part.coords
            )
            width = _ROAD_WIDTH_BY_CLASS.get(highway.removesuffix("_link"), 1.2)
            parts.append(f'<polyline class="road" points="{points}" stroke-width="{width}"/>')
    for x, y in crossings_xy:
        if abs(x - center_xy[0]) <= half and abs(y - center_xy[1]) <= half:
            px, py = to_pixels(float(x), float(y))
            parts.append(
                f'<rect class="crossing" x="{_fmt(px - 1.5)}" y="{_fmt(py - 1.5)}" '
                f'width="3" height="3"/>'
            )

    in_window_set = set(in_window.tolist())
    for left, right in pairs.T.tolist():
        if left in in_window_set and right in in_window_set:
            x1, y1 = to_pixels(*map(float, signals_xy[left]))
            x2, y2 = to_pixels(*map(float, signals_xy[right]))
            colour = _PALETTE[palette_index[int(labels[left])] % len(_PALETTE)]
            parts.append(
                f'<line x1="{_fmt(x1)}" y1="{_fmt(y1)}" x2="{_fmt(x2)}" y2="{_fmt(y2)}" '
                f'stroke="{colour}" stroke-width="2" stroke-opacity="0.55"/>'
            )
    for index in in_window.tolist():
        px, py = to_pixels(*map(float, signals_xy[index]))
        label = int(labels[index])
        colour = (
            _PALETTE[palette_index[label] % len(_PALETTE)]
            if cluster_sizes[label] > 1
            else "#555555"
        )
        variant = signal_variants[index]
        if variant in NON_BLOCKING_SIGNAL_TAGS:
            parts.append(
                f'<circle cx="{_fmt(px)}" cy="{_fmt(py)}" r="4.5" fill="none" '
                f'stroke="{colour}" stroke-width="2"/>'
            )
        elif variant == "controller":
            parts.append(
                f'<rect x="{_fmt(px - 4)}" y="{_fmt(py - 4)}" width="8" height="8" '
                f'fill="{colour}"/>'
            )
        else:
            parts.append(f'<circle cx="{_fmt(px)}" cy="{_fmt(py)}" r="4" fill="{colour}"/>')

    bar = 50 * scale
    parts.append(
        f'<line class="scale" x1="10" y1="{_PANEL_PIXELS - 10}" x2="{_fmt(10 + bar)}" '
        f'y2="{_PANEL_PIXELS - 10}"/>'
        f'<text class="scale-text" x="10" y="{_PANEL_PIXELS - 14}">50 m</text></svg>'
    )
    return "".join(parts), len(in_window), len(palette_index)


def render_cluster_map(scan: OsmScan, output_path: Path) -> list[str]:
    """Write the HTML map; returns the labels of junctions that could not be located."""
    signals = scan.signal_nodes
    signals_xy = project_points(
        np.array([s.lon for s in signals]), np.array([s.lat for s in signals])
    )
    signal_variants = [tag(s.properties, "traffic_signals") or "" for s in signals]
    crossings = [c for c in scan.signalised_crossings if tag(c.properties, "highway") == "crossing"]
    crossings_xy = project_points(
        np.array([c.lon for c in crossings]), np.array([c.lat for c in crossings])
    )

    # Routable roads (approved definition), so side clutter is gone.
    ways = [w for w in scan.drivable_ways if is_routable_way(w)]
    projected = project_lines([shapely.LineString(w.coordinates) for w in ways])
    road_tree = shapely.STRtree(projected)

    labels_by_radius = {r: single_linkage_labels(signals_xy, r) for r in CLUSTER_MAP_RADII_METERS}
    pairs_by_radius = {r: _cluster_pairs(signals_xy, r) for r in CLUSTER_MAP_RADII_METERS}

    sections: list[str] = []
    missing: list[str] = []
    for spec in JUNCTIONS:
        center = locate_junction(spec, ways)
        if center is None:
            missing.append(spec.label)
            continue
        center_xy = project_points(np.array([center[0]]), np.array([center[1]]))[0]
        half = _WINDOW_HALF_SIZE_METERS
        window = shapely.box(
            center_xy[0] - half, center_xy[1] - half, center_xy[0] + half, center_xy[1] + half
        )
        road_indices = road_tree.query(window, predicate="intersects")
        road_lines = [(projected[i], ways[i].highway) for i in road_indices.tolist()]

        panels = []
        for radius in CLUSTER_MAP_RADII_METERS:
            labels = labels_by_radius[radius]
            svg, node_count, cluster_count = _panel_svg(
                center_xy=center_xy,
                radius_meters=radius,
                road_lines=road_lines,
                signals_xy=signals_xy,
                signal_variants=signal_variants,
                labels=labels,
                pairs=pairs_by_radius[radius],
                crossings_xy=crossings_xy,
            )
            panels.append(
                f"<figure><figcaption><b>{radius:g} m</b> · {node_count} signal nodes → "
                f"{cluster_count} clusters</figcaption>{svg}</figure>"
            )
        sections.append(
            f"<section><h2>{html.escape(spec.label)}"
            f" <small>{center[1]:.5f}, {center[0]:.5f}</small></h2>"
            f'<div class="row">{"".join(panels)}</div></section>'
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
