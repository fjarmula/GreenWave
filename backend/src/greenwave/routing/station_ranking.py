"""Rank one vehicle type's stations for an incident by the green-wave estimate (spec, Ranking).

A reversed Dijkstra from the incident gives every station's motion time with the weight
``plan_route`` minimises; the best ``dispatch_shortlist_size`` then get the real pipeline
(``plan_route``, route model, ``estimate_times``), so the displayed time is the preflight one.
The shortlist is a speed cut: per-intersection delay can reorder stations beyond it.
"""

import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import networkx as nx
import polars as pl

from greenwave.routing.errors import NoRoute, NoStationReachable, OriginOffNetwork
from greenwave.routing.estimates import estimate_times
from greenwave.routing.network_index import RoutingIndex
from greenwave.routing.planner import SnappedRouteEndpoint, edge_weight, plan_route, snap_endpoint
from greenwave.schemas import Position, Station, VehicleType
from greenwave.simulation.route_model import build_route_model
from greenwave.simulation_settings import SimulationSettings

logger = logging.getLogger(__name__)

MAX_CANDIDATES = 3


@dataclass(frozen=True)
class StationNode:
    station: Station
    node_key: str


@dataclass(frozen=True)
class RankedStation:
    station: Station
    greenwave_seconds: float
    distance_m: float


@dataclass(frozen=True)
class StationRanking:
    incident_snap: SnappedRouteEndpoint
    candidates: tuple[RankedStation, ...]  # best first, at most MAX_CANDIDATES
    station_at_incident: Station | None


def station_from_row(row: Mapping[str, Any]) -> Station:
    """One ``stations.parquet`` row as the API ``Station``."""
    return Station(
        station_id=row["station_id"],
        vehicle_type=row["vehicle_type"],
        source_kind=row["source_kind"],
        name=row["name"],
        position=Position(lat=row["lat"], lng=row["lng"]),
    )


def build_station_nodes(stations: pl.DataFrame, index: RoutingIndex) -> tuple[StationNode, ...]:
    """Snap each station once (origin semantics); unsnappable ones are skipped with a warning."""
    nodes: list[StationNode] = []
    for row in stations.sort("station_id").iter_rows(named=True):
        station = station_from_row(row)
        try:
            snap = snap_endpoint(index, station.position, origin=True)
        except OriginOffNetwork:
            logger.warning("station %s is off the routable network; skipped", station.station_id)
            continue
        nodes.append(StationNode(station, snap.node_key))
    return tuple(nodes)


def rank_stations(
    index: RoutingIndex,
    stations: Sequence[StationNode],
    incident: Position,
    vehicle_type: VehicleType,
    settings: SimulationSettings,
) -> StationRanking:
    """Raises ``DestinationOffNetwork`` or ``NoStationReachable``."""
    incident_snap = snap_endpoint(index, incident, origin=False)
    of_type = [s for s in stations if s.station.vehicle_type == vehicle_type]
    at_incident = sorted(
        (s.station for s in of_type if s.node_key == incident_snap.node_key),
        key=lambda station: station.station_id,
    )
    motion = nx.single_source_dijkstra_path_length(
        index.graph.reverse(copy=False),
        incident_snap.node_key,
        weight=lambda _source, _target, data: edge_weight(index, data, settings),
    )
    shortlist = sorted(
        (s for s in of_type if s.node_key != incident_snap.node_key and s.node_key in motion),
        key=lambda s: (motion[s.node_key], s.station.station_id),
    )[: settings.dispatch_shortlist_size]

    ranked: list[RankedStation] = []
    for node in shortlist:
        try:
            route = plan_route(index, node.station.position, incident, settings)
        except NoRoute:
            continue
        model = build_route_model(route, index, settings, False)
        estimates = estimate_times(route, model, 1.0, settings)
        ranked.append(
            RankedStation(node.station, estimates.greenwave_seconds, route.total_distance_m)
        )
    if not ranked:
        raise NoStationReachable(f"no {vehicle_type.value} station can reach the incident")
    ranked.sort(key=lambda r: (r.greenwave_seconds, r.station.station_id))
    return StationRanking(
        incident_snap=incident_snap,
        candidates=tuple(ranked[:MAX_CANDIDATES]),
        station_at_incident=at_incident[0] if at_incident else None,
    )
