from pathlib import Path

from greenwave.etl.feature_points import feature_point
from greenwave.etl.ingest_osm import OsmFeature, iter_osm_records
from tests.support.osm_fixtures import closed_way, line, write_osm

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
