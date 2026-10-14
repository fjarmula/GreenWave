import json
from pathlib import Path

import pytest

from greenwave.etl.graph import build_graph
from greenwave.etl.profile_osm import DrivableWay
from greenwave.etl.street_comparison import (
    StreetLength,
    compare_streets,
    graph_street_lengths,
    ulice_street_lengths,
)
from greenwave.etl.street_names import normalise_street_name


@pytest.mark.parametrize(
    ("left", "right"),
    [
        ("ul. Kard. Wyszyńskiego", "Kardynała Wyszyńskiego"),
        ("Generała Henryka Kamieńskiego", "gen. Henryka Kamieńskiego"),
        ("Łagiewnicka", "lagiewnicka"),
        ("Al. Mickiewicza", "Aleja Mickiewicza"),
        ("św. Bronisławy", "Świętej Bronisławy"),
        ("Na  Błoniach", "na błoniach"),
    ],
)
def test_names_that_differ_only_by_form_normalise_equal(left: str, right: str) -> None:
    assert normalise_street_name(left) == normalise_street_name(right)


def test_street_type_words_are_kept_so_a_plac_is_not_a_street() -> None:
    assert normalise_street_name("Plac Matejki") != normalise_street_name("Matejki")


def _way(line: int, points: list[tuple[float, float]], **tags: str) -> DrivableWay:
    return DrivableWay(line, "residential", points, dict(tags))


def test_graph_length_counts_each_two_way_segment_once_and_skips_unnamed() -> None:
    graph = build_graph(
        [
            _way(1, [(19.9, 50.0), (19.9, 50.001)], name="Testowa"),  # ~111 m, two-way
            _way(2, [(19.91, 50.0), (19.91, 50.001)], name="Jednokierunkowa", oneway="yes"),
            _way(3, [(19.92, 50.0), (19.92, 50.001)]),  # unnamed
        ]
    ).graph

    named, unnamed_m = graph_street_lengths(graph)

    assert named["testowa"].length_m == pytest.approx(111.2, rel=0.01)
    assert named["jednokierunkowa"].length_m == pytest.approx(111.2, rel=0.01)
    assert unnamed_m == pytest.approx(111.2, rel=0.01)


def test_ulice_lengths_sum_features_with_the_same_normalised_name(tmp_path: Path) -> None:
    def feature(name: str, coordinates: list[list[float]]) -> dict[str, object]:
        return {
            "type": "Feature",
            "properties": {"nazwa_ulicy": name},
            "geometry": {"type": "LineString", "coordinates": coordinates},
        }

    path = tmp_path / "Ulice.geojson"
    path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    feature("Długa", [[0, 0], [100, 0]]),
                    feature("ul. Długa", [[0, 10], [0, 60]]),
                ],
            }
        ),
        encoding="utf-8",
    )

    assert ulice_street_lengths(path)["dluga"].length_m == pytest.approx(150.0)


def test_comparison_statuses_and_ratio_boundaries() -> None:
    graph = {
        "ok": StreetLength("Ok", 1000.0),
        "at_high": StreetLength("AtHigh", 1250.0),
        "over": StreetLength("Over", 1251.0),
        "at_low": StreetLength("AtLow", 800.0),
        "under": StreetLength("Under", 799.0),
        "graph_only": StreetLength("GraphOnly", 500.0),
    }
    ulice = {
        "ok": StreetLength("Ok", 1000.0),
        "at_high": StreetLength("AtHigh", 1000.0),
        "over": StreetLength("Over", 1000.0),
        "at_low": StreetLength("AtLow", 1000.0),
        "under": StreetLength("Under", 1000.0),
        "ulice_only": StreetLength("UliceOnly", 700.0),
    }

    result = compare_streets(graph, 250.0, ulice, ratio_range=(0.8, 1.25))

    status = dict(zip(result.table["normalised_name"], result.table["status"], strict=True))
    assert status == {
        "ok": "within_range",
        "at_high": "within_range",  # the window is inclusive
        "over": "graph_longer",
        "at_low": "within_range",
        "under": "graph_shorter",
        "graph_only": "graph_only",
        "ulice_only": "ulice_only",
    }
    report = result.report
    assert (report.matched_streets, report.matched_in_range_streets) == (5, 3)
    assert (report.ulice_only_streets, report.graph_only_streets) == (1, 1)
    assert report.graph_unnamed_km == pytest.approx(0.25)
    assert report.worst_graph_longer[0].street == "Over"
