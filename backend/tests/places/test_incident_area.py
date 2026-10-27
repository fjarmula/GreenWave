import numpy as np
import polars as pl
import pytest

from greenwave.etl.config import AREA_LOOKUP_RADIUS_M
from greenwave.etl.geo import unproject_points
from greenwave.places.incident_area import (
    DELEGATURA_NAMES,
    KRAKOW_DISTRICT_DELEGATURA,
    KRAKOW_DISTRICT_NAMES,
    IncidentArea,
    IncidentAreaLocator,
)
from greenwave.schemas import Position

X0, Y0 = 7_420_000.0, 5_545_000.0


def _position(dx: float, dy: float = 0.0) -> Position:
    lon, lat = unproject_points(np.array([[X0 + dx, Y0 + dy]]))[0]
    return Position(lat=float(lat), lng=float(lon))


def _addresses(*rows: tuple[float, int | None]) -> pl.DataFrame:
    """(metric x offset, district_number or None for an OSM-only row)."""
    positions = [_position(dx) for dx, _ in rows]
    return pl.DataFrame(
        {
            "lat": [p.lat for p in positions],
            "lng": [p.lng for p in positions],
            "district_number": [d for _, d in rows],
        },
        schema={"lat": pl.Float64, "lng": pl.Float64, "district_number": pl.Int8},
    )


EXPECTED_DELEGATURA = {
    **dict.fromkeys(range(1, 4), "1261059"),
    **dict.fromkeys(range(4, 8), "1261029"),
    **dict.fromkeys(range(8, 14), "1261049"),
    **dict.fromkeys(range(14, 19), "1261039"),
}


@pytest.mark.parametrize("district", range(1, 19))
def test_each_district_maps_to_its_delegatura(district: int) -> None:
    locator = IncidentAreaLocator.from_addresses(_addresses((0, district)))

    area = locator.locate(_position(5))

    assert area == IncidentArea(
        teryt=EXPECTED_DELEGATURA[district],
        delegatura_name=DELEGATURA_NAMES[EXPECTED_DELEGATURA[district]],
        district_number=district,
        district_name=KRAKOW_DISTRICT_NAMES[district],
    )


def test_tables_cover_the_18_districts() -> None:
    assert KRAKOW_DISTRICT_DELEGATURA == EXPECTED_DELEGATURA
    assert sorted(KRAKOW_DISTRICT_NAMES) == list(range(1, 19))
    assert KRAKOW_DISTRICT_NAMES[11] == "Podgórze Duchackie"
    assert DELEGATURA_NAMES == {
        "1261059": "Śródmieście",
        "1261029": "Krowodrza",
        "1261049": "Podgórze",
        "1261039": "Nowa Huta",
    }


def test_nearest_address_district_used() -> None:
    locator = IncidentAreaLocator.from_addresses(_addresses((0, 2), (100, 11)))

    area = locator.locate(_position(70))

    assert area is not None and area.district_number == 11


def test_point_beyond_radius_is_unknown() -> None:
    locator = IncidentAreaLocator.from_addresses(_addresses((0, 2)))

    assert locator.locate(_position(AREA_LOOKUP_RADIUS_M - 1)) is not None
    assert locator.locate(_position(AREA_LOOKUP_RADIUS_M + 1)) is None


def test_osm_only_rows_ignored() -> None:
    locator = IncidentAreaLocator.from_addresses(_addresses((0, None), (200, 13)))

    area = locator.locate(_position(0))

    assert area is not None and area.district_number == 13


def test_no_emuia_addresses_gives_unknown() -> None:
    locator = IncidentAreaLocator.from_addresses(_addresses((0, None)))

    assert locator.locate(_position(0)) is None


def test_metric_projection_is_used() -> None:
    # 240 m north is within the radius; a degree comparison would get this wrong.
    locator = IncidentAreaLocator.from_addresses(_addresses((0, 5)))

    assert locator.locate(_position(0, 240)) is not None
    assert locator.locate(_position(0, 260)) is None
