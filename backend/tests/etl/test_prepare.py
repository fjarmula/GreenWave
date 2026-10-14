import json
from pathlib import Path

from osm_fixtures import line, point, write_osm

from greenwave.etl.graph import build_graph
from greenwave.etl.near_misses import find_near_misses
from greenwave.etl.prepare import prepare_scan, tertiary_plus_cases, welds_frame
from greenwave.etl.profile import OSM_RELATIVE_PATH
from greenwave.etl.profile_osm import DrivableWay, LonLat
from greenwave.etl.weld import weld_ways

STEP = 0.001
METRE_LAT = 1 / 111_200


def at(x: float, y: float) -> LonLat:
    return round(19.9 + x * STEP, 7), round(50.0 + y * STEP, 7)


def north_of(point_: LonLat, metres: float) -> LonLat:
    return point_[0], round(point_[1] + metres * METRE_LAT, 7)


def way(line_number: int, points: list[LonLat], highway: str, **tags: str) -> DrivableWay:
    return DrivableWay(line_number, highway, points, dict(tags))


def test_tertiary_plus_list_shows_what_the_weld_step_did_to_each_case() -> None:
    ways = [
        way(1, [at(0, 0), at(4, 0)], "tertiary", name="Glowna"),
        way(2, [at(1, 2), north_of(at(1, 0), 0.5)], "service"),  # 0.5 m short: welded
        way(3, [at(2, 2), north_of(at(2, 0), 1.3)], "service"),  # 1.3 m short: beyond tolerance
        way(4, [at(3, 2), north_of(at(3, 0), 0.4)], "service", bridge="yes"),  # other level
        way(5, [at(0, 5), at(4, 5)], "residential"),
        way(6, [at(1, 7), north_of(at(1, 5), 0.5)], "residential"),  # near-miss, but no main road
    ]
    frame, _ = find_near_misses(build_graph(ways).graph, ways, 1.5)
    _, report = weld_ways(ways, frame)

    cases = tertiary_plus_cases(frame, report)

    status = {row["way_line"]: row["weld_status"] for row in cases.iter_rows(named=True)}
    assert set(status) == {2, 3, 4}  # way 6 involves only residential roads
    assert status[2].startswith("welded")
    assert status[3] == "not welded: 1.30 m is beyond the weld tolerance"
    assert status[4] == "not welded: different layer, bridge or tunnel"
    assert frame.height == 4  # the near-misses of ways 2, 3, 4 and 6
    assert report.welded == 2  # ways 2 and 6; way 3 is too far and way 4 is on another level
    assert welds_frame(report).height == report.welded


def test_prepare_scan_welds_the_ways_every_later_step_sees(tmp_path: Path) -> None:
    from greenwave.etl.manifest import (
        MANIFEST_FILENAME,
        Manifest,
        ManifestEntry,
        sha256_of_file,
        write_manifest,
    )

    raw = tmp_path / "raw"
    osm = raw / OSM_RELATIVE_PATH
    osm.parent.mkdir(parents=True)
    (raw / "krakow").mkdir()
    source = write_osm(
        tmp_path,
        line([at(0, 0), at(2, 0)], highway="primary"),
        line([at(1, 2), north_of(at(1, 0), 0.5)], highway="service"),
        point(*at(1, 1), highway="traffic_signals"),
    )
    source.rename(osm)
    write_manifest(
        Manifest(
            entries=[
                ManifestEntry(
                    path=OSM_RELATIVE_PATH,
                    sha256=sha256_of_file(osm),
                    size_bytes=osm.stat().st_size,
                    source="test",
                    url=None,
                    retrieved_on="2026-10-14",
                    licence=None,
                    attribution=None,
                )
            ]
        ),
        raw / MANIFEST_FILENAME,
    )

    prepared = prepare_scan(raw)

    assert prepared.weld_report.welded == 1
    stem = next(w for w in prepared.scan.drivable_ways if w.highway == "service")
    main = next(w for w in prepared.scan.drivable_ways if w.highway == "primary")
    assert stem.coordinates[-1] in main.coordinates  # now a shared vertex
    assert len(prepared.scan.signal_nodes) == 1  # everything else in the scan is untouched
    json.dumps(prepared.weld_report.model_dump())
