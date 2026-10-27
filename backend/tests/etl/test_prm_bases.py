import json
from pathlib import Path

import polars as pl
import pytest
from pydantic import ValidationError

from greenwave.etl.prm_bases import BaseCoordinate, load_base_coordinates, resolve_bases
from greenwave.etl.prm_roster import PrmRosterError

TELIGI = "ul. Teligi Leonida 8, 30-835 Kraków"
SKAWINA = "ul. Niepodległości 12, 32-050 Skawina"


def _addresses() -> pl.DataFrame:
    return pl.DataFrame(
        {"emuia_id": [11, 12, None], "lat": [50.01, 50.02, 50.03], "lng": [19.91, 19.92, 19.93]},
        schema={"emuia_id": pl.Int64, "lat": pl.Float64, "lng": pl.Float64},
    )


def _write(tmp_path: Path, entries: list[dict[str, object]]) -> Path:
    path = tmp_path / "prm_bases.json"
    path.write_text(json.dumps(entries, ensure_ascii=False), encoding="utf-8")
    return path


def test_emuia_entry_resolves_to_address_point() -> None:
    frame = resolve_bases([BaseCoordinate(address=TELIGI, emuia_id=12)], _addresses())

    assert frame.rows(named=True) == [
        {"base_address": TELIGI, "lat": 50.02, "lng": 19.92, "coordinate_source": "emuia:12"}
    ]


def test_explicit_coordinate_resolves_with_its_source() -> None:
    base = BaseCoordinate(address=SKAWINA, lat=49.97, lng=19.83, source="osm:way/1")

    assert resolve_bases([base], _addresses()).row(0, named=True)["coordinate_source"] == (
        "osm:way/1"
    )


def test_resolved_bases_sorted_by_address() -> None:
    bases = [
        BaseCoordinate(address=TELIGI, emuia_id=12),
        BaseCoordinate(address=SKAWINA, lat=49.97, lng=19.83, source="osm:way/1"),
    ]

    assert resolve_bases(bases, _addresses())["base_address"].to_list() == [SKAWINA, TELIGI]


def test_explicit_coordinate_needs_source() -> None:
    with pytest.raises(ValidationError):
        BaseCoordinate(address=SKAWINA, lat=49.97, lng=19.83)


@pytest.mark.parametrize(
    "fields",
    [
        {},
        {"emuia_id": 12, "lat": 49.97, "lng": 19.83, "source": "osm:way/1"},
        {"lat": 49.97, "source": "osm:way/1"},
    ],
)
def test_exactly_one_coordinate_kind(fields: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        BaseCoordinate.model_validate({"address": TELIGI, **fields})


def test_load_reads_the_curated_file(tmp_path: Path) -> None:
    path = _write(tmp_path, [{"address": TELIGI, "emuia_id": 12}])

    assert load_base_coordinates(path) == [BaseCoordinate(address=TELIGI, emuia_id=12)]


def test_duplicate_address_rejected(tmp_path: Path) -> None:
    path = _write(
        tmp_path, [{"address": TELIGI, "emuia_id": 12}, {"address": TELIGI, "emuia_id": 11}]
    )

    with pytest.raises(PrmRosterError, match="Teligi"):
        load_base_coordinates(path)


def test_unknown_emuia_id_raises() -> None:
    with pytest.raises(PrmRosterError, match="999"):
        resolve_bases([BaseCoordinate(address=TELIGI, emuia_id=999)], _addresses())


def test_committed_file_parses() -> None:
    path = Path(__file__).resolve().parents[2] / "data" / "curated" / "prm_bases.json"

    load_base_coordinates(path)
