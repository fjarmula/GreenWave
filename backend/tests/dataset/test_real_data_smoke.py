import json
from datetime import datetime

import polars as pl
import pytest

from greenwave.artifacts import BACKEND_ROOT
from greenwave.dataset import DatasetSettings, ProcessedDataset, load_dataset
from greenwave.etl.connectivity import main_component_nodes
from greenwave.etl.manifest import sha256_of_file
from greenwave.etl.prm_roster import PRM_TABLES_RELATIVE_PATH, load_roster
from greenwave.routing.network_index import RoutingIndex, build_routing_index
from greenwave.routing.planner import plan_route
from greenwave.routing.station_ranking import build_station_nodes, rank_stations
from greenwave.routing.team_eligibility import classify, teams_from_frame
from greenwave.schemas import Position, VehicleType
from greenwave.simulation.cascade_check import find_cascade_mismatches
from greenwave.simulation.route_model import build_route_model
from greenwave.simulation_settings import SimulationSettings

ORIGINS = [(19.955, 50.015), (20.011, 50.005), (19.949, 50.093)]
DESTINATIONS = [(19.96, 50.063), (19.934, 50.08), (20.037, 50.073)]


@pytest.fixture(scope="module")
def real_dataset() -> ProcessedDataset:
    settings = DatasetSettings()
    if not (settings.processed_dir / "intersection_ids.json").is_file():
        pytest.skip("processed data not present on this machine")
    return load_dataset(settings.processed_dir, settings.raw_manifest_path)


@pytest.fixture(scope="module")
def real_index(real_dataset: ProcessedDataset) -> RoutingIndex:
    return build_routing_index(real_dataset, SimulationSettings())


def test_real_processed_data_loads(real_dataset: ProcessedDataset) -> None:
    """Skipped where data/processed is absent (CI, demo machines without a build)."""
    assert real_dataset.counts.intersections == real_dataset.intersections.height > 0
    assert real_dataset.provenance.sources


@pytest.mark.parametrize(("origin", "destination"), [(o, d) for o in ORIGINS for d in DESTINATIONS])
def test_demo_routes_have_no_cascade_mismatches(
    real_index: RoutingIndex,
    origin: tuple[float, float],
    destination: tuple[float, float],
) -> None:
    settings = SimulationSettings()
    route = plan_route(
        real_index,
        Position(lng=origin[0], lat=origin[1]),
        Position(lng=destination[0], lat=destination[1]),
        settings,
    )
    route_model = build_route_model(route, real_index, settings, cascade_enabled=True)

    assert find_cascade_mismatches(route, route_model, real_index) == ()


def test_pedestrian_island_incident_snaps_into_the_main_network(
    real_dataset: ProcessedDataset, real_index: RoutingIndex
) -> None:
    """Floriańska's nearest node is a 5-node pedestrian island; snapping must skip it."""
    settings = SimulationSettings()
    stations = build_station_nodes(real_dataset.stations, real_index)
    incident = Position(lat=50.0620218, lng=19.9391928)

    ranking = rank_stations(real_index, stations, incident, VehicleType.FIRE_TRUCK, settings)

    assert ranking.incident_snap.node_key in main_component_nodes(real_dataset.graph)
    assert ranking.incident_snap.snap_distance_m <= settings.max_snap_distance_meters
    assert ranking.candidates


def test_every_krakow_based_team_is_in_scope(real_dataset: ProcessedDataset) -> None:
    roster = load_roster(DatasetSettings().raw_manifest_path.parent / PRM_TABLES_RELATIVE_PATH)
    krakow = set(roster.filter(pl.col("base_teryt").str.starts_with("1261"))["team_code"])

    assert len(krakow) == 23
    assert krakow <= set(real_dataset.resources["team_code"])


def test_daytime_teams_are_off_shift_at_21(real_dataset: ProcessedDataset) -> None:
    teams = teams_from_frame(real_dataset.resources)
    result = classify(teams, datetime(2026, 10, 27, 21, 0), {})

    assert sorted(t.team_code for t, _ in result.excluded) == [
        "K01 134", "K01 158", "K01 176", "K01 178"
    ]  # fmt: skip
    assert len(result.eligible) == 19


def test_committed_curated_files_match_the_processed_report(
    real_dataset: ProcessedDataset,
) -> None:
    """Editing a curated or override file without re-running its ETL step is caught here."""
    report = json.loads((DatasetSettings().processed_dir / "etl_report.json").read_text())
    recorded = {
        **report["intersections"].get("curated_sha256", {}),
        **report["places"].get("curated_sha256", {}),
    }

    assert set(recorded) == {"data/curated/prm_bases.json", "data/overrides/roundabouts.json"}
    for relative, sha in recorded.items():
        assert sha256_of_file(BACKEND_ROOT / relative) == sha, relative
