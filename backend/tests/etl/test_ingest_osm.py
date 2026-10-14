from pathlib import Path

from greenwave.etl.ingest_osm import MalformedRecord, OsmFeature, iter_osm_records

HEADER = '{"type":"FeatureCollection","features":['


def _write(tmp_path: Path, *feature_lines: str) -> Path:
    path = tmp_path / "osm.geojson"
    path.write_text("\n".join([HEADER, *feature_lines, "]}", ""]), encoding="utf-8")
    return path


def test_yields_features_and_skips_header_footer_and_trailing_comma(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        '{"type":"Feature","geometry":{"type":"Point","coordinates":[19.9,50.0]},'
        '"properties":{"highway":"traffic_signals"}},',
        '{"type":"Feature","geometry":{"type":"Point","coordinates":[19.8,50.1]},"properties":{}}',
    )

    records = list(iter_osm_records(path))

    assert [type(r) for r in records] == [OsmFeature, OsmFeature]
    first = records[0]
    assert isinstance(first, OsmFeature)
    assert (first.line_number, first.geometry_type) == (2, "Point")
    assert first.properties == {"highway": "traffic_signals"}


def test_reports_malformed_lines_instead_of_dropping_them(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        "garbage",
        '{"type":"Feature","geometry":null,"properties":{}},',
        '{"type":"Feature","geometry":{"type":"Point","coordinates":[1,2]},"properties":',
        '{"type":"Feature","geometry":{"type":"Point","coordinates":[1,2]},"properties":[]},',
    )

    records = list(iter_osm_records(path))

    assert all(isinstance(r, MalformedRecord) for r in records)
    assert [r.line_number for r in records if isinstance(r, MalformedRecord)] == [2, 3, 4, 5]
