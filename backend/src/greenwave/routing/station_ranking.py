"""Rank one vehicle type's stations for an incident by the estimate of the run's time mode.

A reversed Dijkstra from the incident gives every station's motion time with the weight
``plan_route`` minimises; the best ``dispatch_shortlist_size`` then get the real pipeline
(``plan_route``, route model, ``estimate_times``, ``standard_run_seconds``), so the displayed
times are the preflight ones. Candidates are ordered by the green-wave or the standard total
(``time_mode``).
The shortlist is a speed cut: per-intersection delay can reorder stations beyond it. Team
ranking (ADR 0014) lifts it by estimating every eligible base.

An incident off the network seeds that Dijkstra at every access node with its walking time, so
the shortlist already orders by drive + walk; candidates are sorted by the same total.

A station on the incident's own node is an *on-site* candidate (ADR 0012): no route, only the
walk from the station. Off the network, a station whose node is an access node is on-site when
that walk beats its driven option (or it has none); driving wins ties.
"""

import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import polars as pl

from greenwave.artifacts import STATIONS_FILENAME
from greenwave.dataset.constants import PLACES_COMMAND
from greenwave.dataset.errors import MalformedArtifactError
from greenwave.routing.access import AccessNode, access_nodes, seeded_lengths, walk_between
from greenwave.routing.errors import (
    DestinationOffNetwork,
    NoRoute,
    NoStationReachable,
    OriginOffNetwork,
)
from greenwave.routing.estimates import estimate_times
from greenwave.routing.network_index import RoutingIndex
from greenwave.routing.planner import (
    PlannedRoute,
    SnappedRouteEndpoint,
    edge_weight,
    node_position,
    plan_route,
    snap_endpoint,
)
from greenwave.schemas import GreenWaveMode, Position, Station, StationSourceKind, VehicleType
from greenwave.simulation.route_model import build_route_model
from greenwave.simulation.standard_estimate import standard_run_seconds
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
    standard_seconds: float
    distance_m: float
    on_foot: AccessNode | None = None
    # On-site (ADR 0012): no drive; the walk from the station to the incident.
    on_site: bool = False
    walk_m: float | None = None
    walk_seconds: float | None = None

    def total_seconds_for(self, mode: GreenWaveMode) -> float:
        """The drive estimate of ``mode`` plus the walk from the access node (on-site: the walk)."""
        if self.on_site:
            return self.walk_seconds or 0.0
        drive = self.greenwave_seconds if mode is GreenWaveMode.ENABLED else self.standard_seconds
        return drive + (self.on_foot.on_foot_seconds if self.on_foot else 0.0)


@dataclass(frozen=True)
class StationRanking:
    incident_snap: SnappedRouteEndpoint
    candidates: tuple[RankedStation, ...]  # best first, at most MAX_CANDIDATES


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
    """Snap each station once (origin semantics); unsnappable ones are skipped with a warning.

    A ``prm_base`` that does not snap raises ``MalformedArtifactError``: its teams would vanish
    from every ranking without a trace (ADR 0014).
    """
    nodes: list[StationNode] = []
    for row in stations.sort("station_id").iter_rows(named=True):
        station = station_from_row(row)
        try:
            snap = snap_endpoint(index, station.position, origin=True)
        except OriginOffNetwork as error:
            if row["source_kind"] == StationSourceKind.PRM_BASE:
                raise MalformedArtifactError(
                    f"{STATIONS_FILENAME}: PRM base {station.station_id} is off the routable "
                    f"network, so its teams could never be dispatched; re-run {PLACES_COMMAND}"
                ) from error
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
    traffic_density_multiplier: float = 1.0,
    *,
    time_mode: GreenWaveMode = GreenWaveMode.ENABLED,
    include_fastest_of: frozenset[str] = frozenset(),
    max_candidates: int = MAX_CANDIDATES,
    shortlist_size: int | None = None,
) -> StationRanking:
    """Raises ``DestinationOffNetwork`` or ``NoStationReachable``.

    ``traffic_density_multiplier`` only changes each candidate's standard estimate. On-site vs
    drive and the final order use the ``time_mode`` totals. ``shortlist_size`` overrides
    ``settings.dispatch_shortlist_size``. Of the station ids in ``include_fastest_of``, the one
    with the lowest reversed-Dijkstra time joins the shortlist even beyond its size (team ranking
    needs the best in-area base, ADR 0014). At most ``max_candidates`` are returned.
    """
    incident_snap: SnappedRouteEndpoint | None
    access: dict[str, AccessNode] = {}
    try:
        incident_snap = snap_endpoint(index, incident, origin=False)
        seeds = {incident_snap.node_key: 0.0}
    except DestinationOffNetwork:
        # Off the network: every access node within walking reach starts at its walking time.
        incident_snap = None
        access = {n.node_key: n for n in access_nodes(index, incident, settings)}
        seeds = {key: n.on_foot_seconds for key, n in access.items()}
    incident_node = incident_snap.node_key if incident_snap else None
    of_type = [s for s in stations if s.station.vehicle_type == vehicle_type]
    # On the network only the incident's own node is on-site; off it, any access node may be.
    on_site_nodes = {incident_node} if incident_node else set(seeds)
    on_site: dict[str, RankedStation] = {}
    for s in of_type:
        if s.node_key in on_site_nodes:
            walk_m, walk_seconds = walk_between(s.station.position, incident, settings)
            on_site[s.station.station_id] = RankedStation(
                s.station, 0.0, 0.0, 0.0, on_site=True, walk_m=walk_m, walk_seconds=walk_seconds
            )
    motion = seeded_lengths(
        index.graph.reverse(copy=False),
        seeds,
        lambda _source, _target, data: edge_weight(index, data, settings),
    )
    reachable = sorted(
        (s for s in of_type if s.node_key != incident_node and s.node_key in motion),
        key=lambda s: (motion[s.node_key], s.station.station_id),
    )
    shortlist = reachable[: shortlist_size or settings.dispatch_shortlist_size]
    forced = next((s for s in reachable if s.station.station_id in include_fastest_of), None)
    if forced is not None and forced not in shortlist:
        shortlist.append(forced)

    ranked: list[tuple[RankedStation, PlannedRoute | None]] = []
    for node in shortlist:
        try:
            route = plan_route(index, node.station.position, incident, settings)
        except NoRoute:
            continue
        model = build_route_model(route, index, settings, False)
        estimates = estimate_times(route, model, traffic_density_multiplier, settings)
        candidate = RankedStation(
            node.station,
            estimates.greenwave_seconds,
            standard_run_seconds(route, model, traffic_density_multiplier, settings),
            route.total_distance_m,
            route.on_foot,
        )
        walk = on_site.get(node.station.station_id)
        if walk is not None and walk.total_seconds_for(time_mode) < candidate.total_seconds_for(
            time_mode
        ):
            continue  # walking from the station beats driving to another access point
        on_site.pop(node.station.station_id, None)
        ranked.append((candidate, route))
    ranked.extend((candidate, None) for candidate in on_site.values())
    if not ranked:
        raise NoStationReachable(f"no {vehicle_type.value} station can reach the incident")
    ranked.sort(key=lambda item: (item[0].total_seconds_for(time_mode), item[0].station.station_id))
    return StationRanking(
        incident_snap=incident_snap or _off_road_snap(index, ranked, access, stations),
        candidates=tuple(candidate for candidate, _ in ranked[:max_candidates]),
    )


def _off_road_snap(
    index: RoutingIndex,
    ranked: Sequence[tuple[RankedStation, PlannedRoute | None]],
    access: Mapping[str, AccessNode],
    stations: Sequence[StationNode],
) -> SnappedRouteEndpoint:
    """The fastest candidate's access node: its route's end, or an on-site station's own node."""
    best, route = ranked[0]
    if route is not None:
        return route.destination_snap
    node_key = next(
        s.node_key
        for s in stations
        if s.station.station_id == best.station.station_id and s.node_key in access
    )
    return SnappedRouteEndpoint(
        node_key, node_position(index, node_key), access[node_key].straight_m
    )
