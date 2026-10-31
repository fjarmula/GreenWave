"""Reproducible incident sampling and honest summaries, including empty strata."""

from pathlib import Path

import polars as pl
import pytest
from experiments.grid import Pair, choose_incidents, fastest_rows, grouped_rows


def test_sampling_matches_original_recipe_and_is_distinct() -> None:
    addresses = pl.DataFrame(
        {"label": [f"A-{i}" for i in range(500)], "lat": [50.0] * 500, "lng": [19.0] * 500}
    )
    chosen = choose_incidents(addresses)
    assert len(chosen) == len({i.address for i in chosen}) == 200
    assert [i.address for i in chosen[:100]] == addresses.sample(n=100, seed=11)["label"].to_list()
    original = addresses.sample(n=100, seed=11)["label"].to_list()
    for label in addresses.sample(n=300, seed=29)["label"].to_list():
        if label not in original:
            original.append(label)
        if len(original) == 200:
            break
    assert [i.address for i in chosen] == original


def pair(rank: int, standard: float, greenwave: float, junctions: int = 2) -> Pair:
    return Pair(
        incident=0,
        address="A",
        station_rank=rank,
        density=1.0,
        status="completed",
        station_id=f"S-{rank}",
        intersections=junctions,
        standard_seconds=standard,
        greenwave_seconds=greenwave,
    )


def test_groups_include_empty_counts_zero_to_maximum_and_all_combinations() -> None:
    rows = grouped_rows([pair(1, 100, 110), pair(2, 100, 90), pair(3, 100, 100)], [1.0, 1.5])
    by_count = [r for r in rows if r["group_by"] == "intersections"]
    assert [r["intersections"] for r in by_count] == [0, 1, 2]
    assert by_count[0]["count"] == 0 and by_count[0]["mean_saved_seconds"] is None
    assert by_count[-1]["faster"] == by_count[-1]["tied"] == by_count[-1]["slower"] == 1
    assert by_count[-1]["mean_saved_seconds"] == 0
    assert by_count[-1]["mean_saved_percent"] == 0
    assert by_count[-1]["slower_percent"] == pytest.approx(100 / 3)
    combined = [r for r in rows if r["group_by"] == "station_rank+density+intersections"]
    assert len(combined) == 3 * 2 * 3


def test_fastest_station_is_selected_separately_per_mode_and_flags_missing_pairs() -> None:
    rows = [pair(1, 100, 110), pair(2, 120, 80)]
    result = fastest_rows(rows)[0]
    assert result["standard_station_ids"] == "S-1"
    assert result["greenwave_station_ids"] == "S-2"
    assert result["complete_three_candidates"] is False


def test_failed_and_on_site_rows_are_explicit_but_not_driving_benefits() -> None:
    rows = [
        Pair(0, "A", 1, 1.0, status="failed", error="route unavailable"),
        Pair(0, "A", 2, 1.0, status="on_site", intersections=0),
        pair(3, 10, 12),
    ]
    overall = grouped_rows(rows, [1.0])[0]
    assert overall["attempts"] == 3 and overall["count"] == 1
    assert overall["failed"] == 1 and overall["on_site"] == 1
    assert overall["mean_saved_seconds"] == -2


def test_actual_engine_runner_records_common_consumption_and_exact_standard_arrival() -> None:
    from experiments.grid import run_drive
    from tests.support.route_fixtures import corridor_index, position_at

    from greenwave.schemas import GreenWaveMode, SimulationStartRequest
    from greenwave.simulation_settings import SimulationSettings

    request = SimulationStartRequest(
        simulation_id="SIM-harness-test",
        origin=position_at(7_422_000),
        destination=position_at(7_422_850.02),
        green_wave_mode=GreenWaveMode.DISABLED,
        traffic_density_multiplier=1.5,
        enable_cascade_mode=True,
    )
    result = run_drive(request, corridor_index(), SimulationSettings(), 1000)
    assert result["arrival_s"] == result["standard_profile_seconds"]
    assert result["common_slowdown_seconds_spent"] == pytest.approx(3 * result["intersections"])
    assert len(result["common_slowdown_starts"]) == result["intersections"]
    assert result["signal_decisions"]
    with pytest.raises(RuntimeError, match="No arrival within 1"):
        run_drive(request, corridor_index(), SimulationSettings(), 1)


def test_fastest_station_uses_successful_mode_even_if_partner_failed() -> None:
    partial = Pair(0, "A", 1, 1.0, status="failed", station_id="S-1", standard_seconds=10)
    row = fastest_rows([partial, pair(2, 20, 18), pair(3, 30, 25)])[0]
    assert row["standard_station_ids"] == "S-1"
    assert row["standard_complete_three_candidates"] is True
    assert row["greenwave_complete_three_candidates"] is False


def test_orchestration_exports_on_site_walk_and_missing_ranks(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    import csv
    import sys
    from types import SimpleNamespace

    from tests.support.route_fixtures import corridor_index, corridor_stations

    from experiments import grid
    from greenwave.routing.planner import SnappedRouteEndpoint
    from greenwave.routing.station_ranking import RankedStation, StationRanking, build_station_nodes
    from greenwave.schemas import Position

    processed = tmp_path / "data"
    processed.mkdir()
    manifest = tmp_path / "MANIFEST.json"
    manifest.write_text("{}")
    monkeypatch.setattr(
        grid,
        "DatasetSettings",
        lambda: SimpleNamespace(processed_dir=processed, raw_manifest_path=manifest),
    )
    index = corridor_index()
    nodes = build_station_nodes(corridor_stations(), index)
    candidate = RankedStation(nodes[0].station, 0, 0, 0, on_site=True, walk_seconds=45)
    ranking = StationRanking(
        SnappedRouteEndpoint("incident", Position(lat=50, lng=19), 0), (candidate,)
    )
    monkeypatch.setattr(
        grid,
        "load_dataset",
        lambda *_: SimpleNamespace(stations=corridor_stations(), addresses=pl.DataFrame()),
    )
    monkeypatch.setattr(grid, "build_routing_index", lambda *_: index)
    monkeypatch.setattr(grid, "choose_incidents", lambda _: [grid.Incident("A", 50, 19)])
    monkeypatch.setattr(grid, "rank_stations", lambda *_: ranking)
    output = tmp_path / "run"
    monkeypatch.setattr(sys, "argv", ["grid", "--smoke", "--output", str(output)])
    assert grid.main() == 0
    with (output / "all-pairs.csv").open() as stream:
        rows = list(csv.DictReader(stream))
    on_site = [r for r in rows if r["status"] == "on_site"]
    assert len(on_site) == 2
    assert all(float(r["walk_seconds"]) == 45 for r in on_site)
    assert sum(r["status"] == "missing_candidate" for r in rows) == 4
