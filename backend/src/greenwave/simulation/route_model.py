"""Unique intersections and forward-only cascade relationships for a planned route."""

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import TYPE_CHECKING

from greenwave.routing.network_index import RoutingIndex, SignalApproachRef
from greenwave.routing.planner import PlannedRoute
from greenwave.schemas.simulation import (
    GreenWaveMode,
    OnFootLeg,
    Position,
    RouteGeometry,
    SignalMovementKind,
    SimulationStartResponse,
    SnappedEndpoint,
)
from greenwave.schemas.simulation import (
    RouteIntersection as ResponseRouteIntersection,
)
from greenwave.simulation_settings import SimulationSettings

if TYPE_CHECKING:
    from greenwave.routing.estimates import Estimates


@dataclass(frozen=True, slots=True)
class RouteIntersection:
    """One unique controlled intersection encountered by the ambulance, in route order."""

    id: str
    first_stop_line_m: float
    last_stop_line_m: float
    delay_seconds: float
    approach_edge_ids: tuple[str, ...] = ()  # route edges ending at one of its stop lines
    signals: tuple[SignalApproachRef, ...] = ()  # known signal positions; empty without geometry
    # Vehicle-capable signals controlling the route approach: the only lights priority turns green.
    route_signal_keys: frozenset[str] = frozenset()
    # Every route stop line of the intersection, ascending; empty means only first and last.
    stop_lines_m: tuple[float, ...] = ()
    name: str | None = None  # ETL name, as in the start response; ``None`` when it has none

    @property
    def route_stop_lines_m(self) -> tuple[float, ...]:
        """Each distinct route stop line position of this intersection, ascending."""
        return self.stop_lines_m or tuple(sorted({self.first_stop_line_m, self.last_stop_line_m}))


@dataclass(frozen=True, slots=True)
class RouteModel:
    """Route-local intersection state and one-hop cascade targets.

    Cascade distance is measured from each source's first stop line to each target's first stop
    line. The first line is the moment an intersection may enter CLEARING; using its last line
    would make a multi-approach intersection's cascade depend on how long the route stays inside it.
    """

    intersections: tuple[RouteIntersection, ...]
    _cascade_targets: Mapping[str, tuple[str, ...]]

    def cascade_targets(self, intersection_id: str) -> tuple[str, ...]:
        """Return only enabled, forward, within-threshold cascade targets in route order."""
        return self._cascade_targets.get(intersection_id, ())


def build_route_model(
    route: PlannedRoute,
    index: RoutingIndex,
    settings: SimulationSettings,
    cascade_enabled: bool,
) -> RouteModel:
    """Group stop lines by id, preserving first/last route positions and canonical delays."""
    del settings  # settings is part of the stable engine-facing builder interface.
    positions: dict[str, list[float]] = {}
    edge_ids: dict[str, list[str]] = {}
    ordered_ids: list[str] = []
    for stop_line in route.stop_lines:
        if stop_line.intersection_id not in positions:
            positions[stop_line.intersection_id] = []
            edge_ids[stop_line.intersection_id] = []
            ordered_ids.append(stop_line.intersection_id)
        positions[stop_line.intersection_id].append(stop_line.distance_along_route_m)
        if stop_line.edge_id not in edge_ids[stop_line.intersection_id]:
            edge_ids[stop_line.intersection_id].append(stop_line.edge_id)
    intersections = tuple(
        RouteIntersection(
            id=intersection_id,
            first_stop_line_m=min(positions[intersection_id]),
            last_stop_line_m=max(positions[intersection_id]),
            delay_seconds=(info := index.intersection(intersection_id)).delay_seconds,
            name=info.name,
            approach_edge_ids=tuple(edge_ids[intersection_id]),
            stop_lines_m=tuple(sorted(set(positions[intersection_id]))),
            signals=(signals := index.signal_approaches(intersection_id)),
            route_signal_keys=frozenset(
                signal.signal_key
                for signal in signals
                if SignalMovementKind.VEHICLE in signal.movement_kinds
                and not set(signal.controlled_edge_ids).isdisjoint(edge_ids[intersection_id])
            ),
        )
        for intersection_id in ordered_ids
    )
    targets: dict[str, tuple[str, ...]] = {}
    if cascade_enabled:
        for source_index, source in enumerate(intersections):
            targets[source.id] = tuple(
                target.id
                for target in intersections[source_index + 1 :]
                if target.first_stop_line_m - source.first_stop_line_m <= index.cascade_threshold_m
            )
    return RouteModel(intersections, MappingProxyType(targets))


def to_start_response(
    simulation_id: str,
    route: PlannedRoute,
    route_model: RouteModel,
    estimates: "Estimates",
    index: RoutingIndex,
    green_wave_mode: GreenWaveMode = GreenWaveMode.ENABLED,
) -> SimulationStartResponse:
    """Map route domain data to the frozen start-response contract at the API boundary."""
    route_intersections = [
        ResponseRouteIntersection(
            id=intersection.id,
            name=(info := index.intersection(intersection.id)).name,
            kind=info.kind,
            position=Position(lat=info.lat, lng=info.lon),
            distance_along_route_m=intersection.first_stop_line_m,
            signal_count=info.signal_count,
            approach_count=info.approach_count,
            needs_review=info.needs_review,
            cascade_targets=list(route_model.cascade_targets(intersection.id)),
        )
        for intersection in route_model.intersections
    ]
    return SimulationStartResponse(
        schema_version="1.0",
        is_simulated=True,
        simulation_id=simulation_id,
        status="INITIALIZED",
        route_geometry=RouteGeometry(type="LineString", coordinates=route.polyline_wgs84),
        total_distance_m=route.total_distance_m,
        estimated_normal_time_sec=round(estimates.normal_seconds),
        estimated_greenwave_time_sec=round(estimates.greenwave_seconds),
        intersections_on_route=[intersection.id for intersection in route_model.intersections],
        route_intersections=route_intersections,
        origin_snapped=SnappedEndpoint(
            position=route.origin_snap.position, snap_distance_m=route.origin_snap.snap_distance_m
        ),
        destination_snapped=SnappedEndpoint(
            position=route.destination_snap.position,
            snap_distance_m=route.destination_snap.snap_distance_m,
        ),
        green_wave_mode=green_wave_mode,
        destination_on_foot=(
            OnFootLeg(
                access_point=route.destination_snap.position,
                distance_m=route.on_foot.on_foot_m,
                seconds=route.on_foot.on_foot_seconds,
            )
            if route.on_foot
            else None
        ),
    )
