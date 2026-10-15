import json
from pathlib import Path

import pytest

from greenwave.etl.cluster_map import JunctionSpec, locate_junction, render_cluster_map
from greenwave.etl.profile_osm import DrivableWay, scan_osm


def _way(name: str, coordinates: list[tuple[float, float]], **tags: str) -> DrivableWay:
    return DrivableWay(1, "primary", coordinates, {"name": name, **tags})


def test_roundabout_centre_uses_ring_not_long_approaches() -> None:
    ring = [(19.0, 50.0), (19.002, 50.0), (19.002, 50.002), (19.0, 50.002), (19.0, 50.0)]
    approach = [(19.002, 50.0), (19.1, 50.0)]
    ways = [
        _way("Rondo Test", ring, junction="roundabout"),
        _way("Rondo Test", approach),
    ]

    center = locate_junction(JunctionSpec("t", ("Rondo Test",)), ways)

    assert center == pytest.approx((19.001, 50.001), abs=1e-3)


def test_two_street_junction_is_their_shared_vertex() -> None:
    ways = [
        _way("ulica Alfa", [(19.0, 50.0), (19.001, 50.001), (19.002, 50.002)]),
        _way("ulica Beta", [(19.0, 50.002), (19.001, 50.001), (19.002, 50.0)]),
    ]

    center = locate_junction(JunctionSpec("t", ("Alfa",), ("Beta",)), ways)

    assert center == (19.001, 50.001)


def test_unlocatable_junction_returns_none() -> None:
    ways = [_way("ulica Alfa", [(19.0, 50.0), (19.001, 50.001)])]

    assert locate_junction(JunctionSpec("t", ("Alfa",), ("Beta",)), ways) is None


def test_render_writes_self_contained_html_and_reports_missing(tmp_path: Path) -> None:
    def feature(geometry: dict[str, object], properties: dict[str, str]) -> str:
        return json.dumps(
            {"type": "Feature", "geometry": geometry, "properties": properties},
            separators=(",", ":"),
        )

    ring = [[19.0, 50.0], [19.002, 50.0], [19.002, 50.002], [19.0, 50.002], [19.0, 50.0]]
    lines = [
        feature(
            {"type": "LineString", "coordinates": ring},
            {"highway": "primary", "name": "Rondo Mogilskie", "junction": "roundabout"},
        ),
        feature({"type": "Point", "coordinates": [19.0005, 50.0]}, {"highway": "traffic_signals"}),
    ]
    osm = tmp_path / "osm.geojson"
    osm.write_text(
        '{"type":"FeatureCollection","features":[\n' + ",\n".join(lines) + "\n]}\n",
        encoding="utf-8",
    )
    output = tmp_path / "map.html"

    missing = render_cluster_map(scan_osm(osm), output)

    page = output.read_text(encoding="utf-8")
    assert "Rondo Mogilskie" in page
    assert "<svg" in page
    assert "http://" not in page.replace("http://www.w3.org", "")
    assert "Rondo Grunwaldzkie" in missing
    assert "Rondo Mogilskie" not in missing
