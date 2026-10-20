from pathlib import Path

from greenwave.etl.feature_points import feature_outline, feature_point
from greenwave.etl.ingest_osm import OsmFeature, iter_osm_records
from tests.support.osm_fixtures import closed_way, line, point, write_osm

RING = [(19.9, 50.0), (19.902, 50.0), (19.902, 50.002), (19.9, 50.002)]


def _feature(tmp_path: Path, text: str) -> OsmFeature:
    (record,) = iter_osm_records(write_osm(tmp_path, text))
    assert isinstance(record, OsmFeature)
    return record


def test_closed_linestring_gives_point_inside_ring(tmp_path: Path) -> None:
    feature = _feature(tmp_path, closed_way(RING, amenity="fire_station"))
    assert feature.geometry_type == "LineString"
    lon, lat = feature_point(feature) or (0.0, 0.0)
    assert 19.9 < lon < 19.902
    assert 50.0 < lat < 50.002


def test_open_linestring_gives_none(tmp_path: Path) -> None:
    assert feature_point(_feature(tmp_path, line(RING, highway="service"))) is None


def test_outline_of_a_closed_way_is_its_ring(tmp_path: Path) -> None:
    outline = feature_outline(_feature(tmp_path, closed_way(RING, amenity="hospital")))
    assert outline is not None
    assert outline.bounds == (19.9, 50.0, 19.902, 50.002)


def test_points_and_open_lines_have_no_outline(tmp_path: Path) -> None:
    assert feature_outline(_feature(tmp_path, point(19.9, 50.0, amenity="police"))) is None
    open_way = line([(19.9, 50.0), (19.901, 50.0)], amenity="police")
    assert feature_outline(_feature(tmp_path, open_way)) is None
