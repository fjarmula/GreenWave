"""Evidence table for the road-attribute factor approval (manual report tool, like scripts/bench/).

    uv run python scripts/road_attribute_evidence.py
    uv run python scripts/road_attribute_evidence.py \\
        --profile mild --set normal_single_lane_factor=1.1 --set ambulance_bus_lane_factor=1.1 \\
        --profile strong --set normal_calming_seconds=3 --set ambulance_bus_lane_factor=1.3

Prints Markdown to stdout: (a) km and edge counts per road-attribute value on the loaded network,
(b) the bus-lane register cross-check counts, (c) for every dashboard origin x destination and every
profile, the normal and GreenWave estimates (as the start response rounds them) and the time saved.
Two profiles always come first: ``neutral`` (every road-attribute factor at its no-effect value,
``NEUTRAL_ROAD_FACTORS``) and ``approved`` (the ``SimulationSettings`` defaults, ADR 0005). Each
``--profile`` starts from neutral; each ``--set`` applies to the most recent ``--profile``; values
are validated by ``SimulationSettings``. ``GREENWAVE_SIM_*`` variables apply to fields no profile
sets. Reads the built
``data/processed/`` (run ``intersections`` then ``neighbours`` first); writes nothing.
"""

import argparse
import json
from collections import Counter, defaultdict
from collections.abc import Sequence
from typing import Any

from greenwave.artifacts import REPORT_FILENAME
from greenwave.dataset import DatasetSettings, load_dataset
from greenwave.routing.edge_times import NEUTRAL_ROAD_FACTORS
from greenwave.routing.errors import RoutePlanningError
from greenwave.routing.estimates import estimate_times
from greenwave.routing.network_index import RoutingIndex, build_routing_index
from greenwave.routing.planner import PlannedRoute, plan_route
from greenwave.schemas.simulation import Position
from greenwave.simulation.route_model import build_route_model
from greenwave.simulation_settings import SimulationSettings

# Copied from frontend/src/components/map/dispatch-endpoints.ts (ORIGIN_ENDPOINTS /
# DESTINATION_ENDPOINTS); keep in sync. (id, lon, lat)
ORIGINS: tuple[tuple[str, float, float], ...] = (
    ("hospital", 19.955, 50.015),
    ("prokocim", 20.011, 50.005),
    ("rydygier", 19.949, 50.093),
)
DESTINATIONS: tuple[tuple[str, float, float], ...] = (
    ("station", 19.96, 50.063),
    ("wroclawska", 19.934, 50.08),
    ("nowa-huta", 20.037, 50.073),
)
# frontend/src/lib/mock-simulation-config.ts DEFAULT_TRAFFIC_DENSITY_MULTIPLIER
DEFAULT_DENSITY = 1.5
NEUTRAL = "neutral"
APPROVED = "approved"


class _ProfileAction(argparse.Action):
    def __call__(
        self,
        parser: argparse.ArgumentParser,
        namespace: argparse.Namespace,
        values: str | Sequence[Any] | None,
        option_string: str | None = None,
    ) -> None:
        profiles: list[tuple[str, dict[str, float]]] = namespace.profiles
        if option_string == "--profile":
            if values in (NEUTRAL, APPROVED) or any(name == values for name, _ in profiles):
                parser.error(f"duplicate profile name {values!r}")
            profiles.append((str(values), {}))
            return
        if not profiles:
            parser.error("--set must follow a --profile")
        key, separator, raw = str(values).partition("=")
        if not separator or key not in SimulationSettings.model_fields:
            parser.error(f"--set expects <SimulationSettings field>=<value>, got {values!r}")
        try:
            profiles[-1][1][key] = float(raw)
        except ValueError:
            parser.error(f"--set {key}: {raw!r} is not a number")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.set_defaults(profiles=[])
    parser.add_argument("--profile", action=_ProfileAction, metavar="NAME")
    parser.add_argument("--set", action=_ProfileAction, metavar="FIELD=VALUE")
    parser.add_argument("--density", type=float, default=DEFAULT_DENSITY)
    return parser.parse_args()


def _attribute_table(index: RoutingIndex) -> list[str]:
    km: defaultdict[tuple[str, str], float] = defaultdict(float)
    edges: Counter[tuple[str, str]] = Counter()
    for *_, data in index.graph.edges(data=True):
        view = index.edge(str(data["edge_id"]))
        values = {
            "bus_lane": str(view.bus_lane).lower(),
            "tram_track": str(view.tram_track).lower(),
            "lanes_per_direction": str(view.lanes_per_direction or "unknown"),
            "surface_class": view.surface_class or "unknown",
            "calming_count": str(view.calming_count) if view.calming_count < 3 else "3+",
        }
        for attribute, value in values.items():
            km[(attribute, value)] += view.length_m / 1000
            edges[(attribute, value)] += 1
    lines = ["| attribute | value | directed km | edges |", "|---|---|---:|---:|"]
    for key in sorted(km):
        lines.append(f"| {key[0]} | {key[1]} | {km[key]:.1f} | {edges[key]} |")
    return lines


def _route_composition(route: PlannedRoute) -> str:
    bus = sum(e.length_m for e in route.edges if e.bus_lane) / 1000
    tram = sum(e.length_m for e in route.edges if e.tram_track) / 1000
    single = sum(e.length_m for e in route.edges if e.lanes_per_direction == 1) / 1000
    unpaved = sum(e.length_m for e in route.edges if e.surface_class == "unpaved") / 1000
    calming = sum(e.calming_count for e in route.edges)
    return (
        f"{route.total_distance_m / 1000:.2f} km; bus {bus:.2f}, tram {tram:.2f}, "
        f"1-lane {single:.2f}, unpaved {unpaved:.2f} km; calming {calming}"
    )


def _position(lon: float, lat: float) -> Position:
    return Position(lat=lat, lng=lon)


def main() -> int:
    args = _parse_args()
    profiles = [(NEUTRAL, NEUTRAL_ROAD_FACTORS), (APPROVED, {}), *args.profiles]
    settings_by_profile = {
        name: SimulationSettings(**values)
        if name == APPROVED
        else SimulationSettings(**(NEUTRAL_ROAD_FACTORS | values))
        for name, values in profiles
    }
    dataset_settings = DatasetSettings()
    dataset = load_dataset(dataset_settings.processed_dir, dataset_settings.raw_manifest_path)
    report = json.loads((dataset_settings.processed_dir / REPORT_FILENAME).read_text("utf-8"))
    road = report["road_attributes"]
    index = build_routing_index(dataset, settings_by_profile[NEUTRAL])

    out = ["# Road-attribute evidence", ""]
    out += ["## Profiles", "", "| profile | settings |", "|---|---|"]
    out += [
        f"| {name} | {'(SimulationSettings defaults)' if name == APPROVED else values} |"
        for name, values in profiles
    ]
    out += ["", "## (a) Attributes on the network", ""]
    out += _attribute_table(index)
    calming, tram = road["calming"], road["tram"]
    out += [
        "",
        f"Calming points: {calming['points_total']} total, {calming['points_on_edges']} on edges, "
        f"{calming['points_off_network']} off network. Tram: {tram['edges_marked']} edges, "
        f"{tram['km_marked']:.1f} km (match {tram['match_m']} m, share >= {tram['min_share']}). "
        f"Unknown surface values: {road['unknown_surface_values']}.",
        "",
        "## (b) Bus-lane register cross-check",
        "",
        "| status | rows |",
        "|---|---:|",
    ]
    out += [f"| {status} | {count} |" for status, count in road["bus_lane_crosscheck"].items()]
    out += [
        "",
        f"## (c) Dispatch pairs (traffic density {args.density:g})",
        "",
        "| origin | destination | profile | normal s | GreenWave s | saved s | route |",
        "|---|---|---|---:|---:|---:|---|",
    ]
    for origin_id, origin_lon, origin_lat in ORIGINS:
        for destination_id, destination_lon, destination_lat in DESTINATIONS:
            for name, _ in profiles:
                settings = settings_by_profile[name]
                try:
                    route = plan_route(
                        index,
                        _position(origin_lon, origin_lat),
                        _position(destination_lon, destination_lat),
                        settings,
                    )
                except RoutePlanningError as error:
                    out.append(f"| {origin_id} | {destination_id} | {name} | - | - | - | {error} |")
                    continue
                model = build_route_model(route, index, settings, cascade_enabled=True)
                estimates = estimate_times(route, model, args.density, settings)
                normal, greenwave = (
                    round(estimates.normal_seconds),
                    round(estimates.greenwave_seconds),
                )
                out.append(
                    f"| {origin_id} | {destination_id} | {name} | {normal} | {greenwave} | "
                    f"{normal - greenwave} | {_route_composition(route)} |"
                )
    print("\n".join(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
