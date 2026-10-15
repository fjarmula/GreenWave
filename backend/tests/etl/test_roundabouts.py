from pathlib import Path

from greenwave.etl.profile_osm import scan_osm
from greenwave.etl.roundabouts import analyse_roundabouts
from greenwave.etl.signals import build_signals
from tests.support.osm_fixtures import line, point, write_osm

LON, LAT = 19.9, 50.0
D = 0.0003  # ~33 m of latitude

# A ring made of two ways that share their end vertices.
NORTH = (LON, LAT + D)
SOUTH = (LON, LAT - D)
EAST = (LON + D, LAT)
WEST = (LON - D, LAT)
RING_A = line([NORTH, EAST, SOUTH], highway="primary", junction="roundabout", name="Rondo Test")
RING_B = line([SOUTH, WEST, NORTH], highway="primary", junction="roundabout", name="Rondo Test")
ARM_EAST = line([EAST, (LON + 0.003, LAT)], highway="secondary")
ARM_WEST = line([WEST, (LON - 0.003, LAT)], highway="secondary")
SIGNAL = {"highway": "traffic_signals"}


def _analyse(tmp_path: Path, *features: str):  # type: ignore[no-untyped-def]
    scan = scan_osm(write_osm(tmp_path, *features))
    return analyse_roundabouts(scan.drivable_ways, build_signals(scan, {}).frame)


def test_ring_ways_sharing_vertices_form_one_ring_with_its_arms(tmp_path: Path) -> None:
    far = point(LON + 0.02, LAT, **SIGNAL)
    result = _analyse(tmp_path, RING_A, RING_B, ARM_EAST, ARM_WEST, point(*EAST, **SIGNAL), far)

    assert result.rings_total == 1
    assert result.rings_with_signals == 1
    assert result.signal_nodes_at_rings == 1
    assert result.counted_signal_nodes_total == 2
    ring = result.signalised_rings[0]
    assert (ring.name, ring.ring_ways, ring.entry_arm_ways, ring.contact_vertices) == (
        "Rondo Test",
        2,
        2,
        2,
    )


def test_conventions_are_reported_side_by_side_without_choosing(tmp_path: Path) -> None:
    # EAST and WEST are ~66 m apart (two clusters at 40 m); a third signal is far from the ring.
    result = _analyse(
        tmp_path,
        RING_A,
        RING_B,
        point(*EAST, **SIGNAL),
        point(*WEST, **SIGNAL),
        point(LON + 0.03, LAT, **SIGNAL),
    )

    assert result.provisional_clusters_total == 3
    assert result.provisional_clusters_touching_rings == 2
    assert result.intersections_if_ring_clusters_stay_separate == 3
    assert result.intersections_if_each_ring_is_one == 2


def test_signal_beyond_association_distance_is_not_at_the_ring(tmp_path: Path) -> None:
    result = _analyse(tmp_path, RING_A, RING_B, point(LON + 0.003, LAT, **SIGNAL))

    assert result.rings_with_signals == 0
    assert result.rings_without_signals == 1


def test_named_rondo_without_ring_tag_is_listed(tmp_path: Path) -> None:
    untagged = line([(LON, LAT), (LON, LAT + 0.001)], highway="primary", name="Rondo Brak Tagu")

    result = _analyse(tmp_path, untagged)

    assert result.rings_total == 0
    assert result.named_rondos_without_ring_tag == ["Rondo Brak Tagu"]
