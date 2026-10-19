from pathlib import Path

import networkx as nx
import pytest

from greenwave.etl.bus_lanes import (
    BusLaneRow,
    crosscheck_bus_lanes,
    find_bus_lane_csv,
    parse_opis,
    read_bus_lane_csv,
)
from greenwave.etl.street_names import normalise_street_name

_HEADER = "OBJECTID,Kategoria,Znak,Opis,Zasady,Organizacja,Długość [m]\n"


def test_parse_opis_street_from_to() -> None:
    parsed = parse_opis("ul. Warszawska od Al. Słowackiego do ul. Szlak")

    assert parsed is not None
    assert normalise_street_name(parsed.street) == normalise_street_name("Warszawska")
    assert (parsed.from_, parsed.to) == ("Al. Słowackiego", "ul. Szlak")


def test_parse_opis_aleje_with_stop_names() -> None:
    parsed = parse_opis("Aleje Trzech Wieszczów od przystanku Jubilat 03 do ul. Warszawskiej")

    assert parsed is not None
    assert normalise_street_name(parsed.street) == "aleja trzech wieszczow"
    assert parsed.from_ == "przystanku Jubilat 03"
    assert parsed.to == "ul. Warszawskiej"


def test_parse_opis_without_from_to_is_unparsed() -> None:
    assert parse_opis("rondo bez opisu") is None
    assert parse_opis("ul. Nawojki prawoskręt w ul. Kawiory") is None


def test_read_bus_lane_csv_handles_bom(tmp_path: Path) -> None:
    path = tmp_path / "Buspasy_x.csv"
    path.write_text(
        _HEADER + "7,pas autobusowy,D-11,ul. Pawia od ul. Kurniki do ul. Warszawskiej,,stała,"
        "123.5\n8,pas autobusowy,,rondo,,,\n",
        encoding="utf-8-sig",
    )

    rows = read_bus_lane_csv(path)

    assert rows == [
        BusLaneRow(
            objectid=7,
            kategoria="pas autobusowy",
            organizacja="stała",
            opis="ul. Pawia od ul. Kurniki do ul. Warszawskiej",
            csv_length_m=123.5,
        ),
        BusLaneRow(
            objectid=8, kategoria="pas autobusowy", organizacja="", opis="rondo", csv_length_m=None
        ),
    ]


def test_find_bus_lane_csv_requires_exactly_one_match(tmp_path: Path) -> None:
    (tmp_path / "krakow").mkdir()
    with pytest.raises(FileNotFoundError, match=r"krakow/Buspasy_\*\.csv"):
        find_bus_lane_csv(tmp_path)
    (tmp_path / "krakow" / "Buspasy_a.csv").write_text(_HEADER, encoding="utf-8")
    assert find_bus_lane_csv(tmp_path).name == "Buspasy_a.csv"
    (tmp_path / "krakow" / "Buspasy_b.csv").write_text(_HEADER, encoding="utf-8")
    with pytest.raises(FileNotFoundError, match="exactly one"):
        find_bus_lane_csv(tmp_path)


def _graph() -> nx.MultiDiGraph:
    graph: nx.MultiDiGraph = nx.MultiDiGraph()
    for edge_id, name, bus_lane, length in (
        ("A+", "Warszawska", True, 400.0),
        ("A-", "Warszawska", False, 400.0),
        ("B+", "Lipska", False, 300.0),
        ("C+", "Aleja Marszałka Ferdynanda Focha", True, 250.0),
        ("D+", None, True, 100.0),
    ):
        graph.add_edge(
            edge_id + "u",
            edge_id + "v",
            key=edge_id,
            edge_id=edge_id,
            name=name,
            bus_lane=bus_lane,
            length_m=length,
        )
    return graph


def _row(objectid: int, opis: str) -> BusLaneRow:
    return BusLaneRow(
        objectid=objectid,
        kategoria="pas autobusowy",
        organizacja="stała",
        opis=opis,
        csv_length_m=100.0,
    )


def test_crosscheck_statuses() -> None:
    rows = [
        _row(4, "rondo bez opisu"),
        _row(3, "ul. Nieistniejąca od ul. A do ul. B"),
        _row(2, "ul. Lipska od ul. Saskiej do ul. Rzebika"),
        _row(1, "ul. Warszawska od Al. Słowackiego do ul. Szlak"),
        _row(5, "Al. Focha od ul. Prusa do ul. Kraszewskiego"),
    ]

    frame = crosscheck_bus_lanes(rows, _graph(), {"warszawska", "nieistniejaca"})

    assert frame.columns == [
        "objectid",
        "kategoria",
        "organizacja",
        "street",
        "from",
        "to",
        "csv_length_m",
        "street_in_ulice",
        "osm_edges_on_street",
        "osm_bus_lane_km_on_street",
        "status",
    ]
    by_id = {row["objectid"]: row for row in frame.to_dicts()}
    assert frame["objectid"].to_list() == [1, 2, 3, 4, 5]
    assert by_id[1]["status"] == "osm_has_bus_lane"
    assert by_id[1]["osm_edges_on_street"] == 2
    assert by_id[1]["osm_bus_lane_km_on_street"] == pytest.approx(0.4)
    assert by_id[1]["street_in_ulice"] is True
    assert by_id[2]["status"] == "osm_street_without_bus_lane"
    assert by_id[2]["street_in_ulice"] is False
    assert by_id[3]["status"] == "street_not_found"
    assert by_id[3]["street_in_ulice"] is True
    assert by_id[3]["osm_edges_on_street"] == 0
    assert by_id[4]["status"] == "unparsed"
    assert by_id[4]["street"] is None
    # Abbreviated CSV name matches the longer OSM name by tokens.
    assert by_id[5]["status"] == "osm_has_bus_lane"
