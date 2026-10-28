"""Hand-built metric graphs with exact route and stop-line distances for simulation tests."""

from collections.abc import Callable, Mapping
from types import MappingProxyType

import networkx as nx
import numpy as np
import polars as pl
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

from greenwave.etl.geo import unproject_points
from greenwave.routing.edge_times import NEUTRAL_ROAD_FACTORS
from greenwave.routing.network_index import (
    ApproachRef,
    EdgeView,
    IntersectionInfo,
    RoutingIndex,
    SignalApproachRef,
)
from greenwave.schemas.simulation import Position
from greenwave.simulation_settings import SimulationSettings

_X = 7_421_000.0
_Y = 5_541_000.0

RoadAttributes = Mapping[str, Mapping[str, object]]


def neutral_settings(**overrides: float) -> SimulationSettings:
    return SimulationSettings(**(NEUTRAL_ROAD_FACTORS | overrides))


def position_at(x_m: float, y_m: float = _Y) -> Position:
    lon, lat = unproject_points(np.array([[x_m, y_m]], dtype=np.float64))[0]
    return Position(lat=float(lat), lng=float(lon))


def route_edges(
    edge_ids: tuple[str, ...],
    lengths: tuple[float, ...],
    speeds: tuple[float, ...],
    road_attributes: RoadAttributes | None = None,
) -> tuple[EdgeView, ...]:
    """Straight consecutive edges for a hand-built ``PlannedRoute`` (neutral road attributes)."""
    overrides = road_attributes or {}
    starts = np.cumsum([0.0, *lengths])
    return tuple(
        EdgeView(
            edge_id=edge_id,
            source_node=f"n{i}",
            target_node=f"n{i + 1}",
            length_m=length,
            speed_kmh=speed,
            geometry=LineString([(starts[i], 0.0), (starts[i + 1], 0.0)]),
            **overrides.get(edge_id, {}),  # type: ignore[arg-type]
        )
        for i, (edge_id, length, speed) in enumerate(zip(edge_ids, lengths, speeds, strict=True))
    )


def _builders(
    graph: nx.MultiDiGraph, overrides: RoadAttributes
) -> tuple[Callable[..., None], Callable[..., None]]:
    def node(key: str, x: float, y: float = _Y) -> None:
        position = position_at(x, y)
        graph.add_node(key, x_m=x, y_m=y, lon=position.lng, lat=position.lat)

    def edge(
        edge_id: str,
        source: str,
        target: str,
        length: float,
        speed: float,
        *,
        bus_lane: bool = False,
        tram_track: bool = False,
        lanes_per_direction: int | None = None,
        surface_class: str | None = None,
        calming_count: int = 0,
    ) -> None:
        source_data = graph.nodes[source]
        target_data = graph.nodes[target]
        attributes: dict[str, object] = {
            "bus_lane": bus_lane,
            "tram_track": tram_track,
            "lanes_per_direction": lanes_per_direction,
            "surface_class": surface_class,
            "calming_count": calming_count,
            **overrides.get(edge_id, {}),
        }
        graph.add_edge(
            source,
            target,
            key=edge_id,
            edge_id=edge_id,
            length_m=length,
            speed_kmh=speed,
            geometry=LineString(
                [(source_data["x_m"], source_data["y_m"]), (target_data["x_m"], target_data["y_m"])]
            ),
            **attributes,
        )

    return node, edge


def corridor_index(
    road_attributes: RoadAttributes | None = None,
    *,
    signal_count: int = 1,
    approach_count: int = 1,
    needs_review: bool = False,
    neighbour_candidates: Mapping[tuple[str, str], float] | None = None,
    signal_approaches: Mapping[str, tuple[SignalApproachRef, ...]] | None = None,
) -> RoutingIndex:
    """An index with a fast detour, corridor stop lines, a one-way edge, and an island.

    ``road_attributes`` overrides the neutral road attributes per edge id, e.g.
    ``{"corridor-a": {"calming_count": 3}}``. Signal positions are absent unless
    ``signal_approaches`` (intersection id -> refs) is given.
    """
    graph = nx.MultiDiGraph()
    node, edge = _builders(graph, road_attributes or {})

    node("short-start", _X)
    node("short-end", _X + 100)
    node("fast-mid", _X + 50, _Y + 100)
    edge("short-slow", "short-start", "short-end", 100, 30)
    edge("fast-a", "short-start", "fast-mid", 60, 90)
    edge("fast-b", "fast-mid", "short-end", 60, 90)

    node("corridor-0", _X + 1_000)
    node("corridor-1", _X + 1_100)
    node("corridor-2", _X + 1_350)
    node("corridor-3", _X + 1_600.01)
    node("corridor-4", _X + 1_850.02)
    edge("corridor-a", "corridor-0", "corridor-1", 100, 36)
    edge("corridor-twin-1", "corridor-1", "corridor-2", 250, 36)
    edge("corridor-twin-2", "corridor-2", "corridor-3", 250.01, 36)
    edge("corridor-b", "corridor-3", "corridor-4", 250.01, 36)
    # A signal-free tail, so a route can end past the last stop line (its D_min is dwelled).
    node("corridor-5", _X + 1_950.02)
    edge("corridor-tail", "corridor-4", "corridor-5", 100, 36)

    node("one-way-start", _X + 3_000)
    node("one-way-end", _X + 3_100)
    edge("one-way", "one-way-start", "one-way-end", 100, 36)
    node("island", _X + 5_000)

    approaches = {
        "corridor-a": (ApproachRef("INT-A", "sig-a", "corridor-a"),),
        "corridor-twin-1": (ApproachRef("INT-TWIN", "sig-twin-1", "corridor-twin-1"),),
        "corridor-twin-2": (
            ApproachRef("INT-TWIN", "sig-twin-2", "corridor-twin-2"),
            ApproachRef("INT-C", "sig-c", "corridor-twin-2"),
        ),
        "corridor-b": (ApproachRef("INT-B", "sig-b", "corridor-b"),),
    }
    intersections = {
        identifier: IntersectionInfo(
            id=identifier,
            name=identifier,
            kind="signalised_junction",
            lon=position_at(x).lng,
            lat=position_at(x).lat,
            delay_seconds=delay,
            signal_count=signal_count,
            approach_count=approach_count,
            needs_review=needs_review,
        )
        for identifier, x, delay in (
            ("INT-A", _X + 1_100, 10),
            ("INT-TWIN", _X + 1_350, 20),
            ("INT-C", _X + 1_600.01, 30),
            ("INT-B", _X + 1_850.02, 40),
        )
    }
    return _index(graph, approaches, intersections, neighbour_candidates, signal_approaches)


def signal_ref(
    intersection_id: str, signal_key: str, x_m: float, y_m: float, *edge_ids: str
) -> SignalApproachRef:
    position = position_at(x_m, y_m)
    return SignalApproachRef(
        intersection_id, signal_key, "traffic_signals", position.lng, position.lat, edge_ids
    )


def branch_index(road_attributes: RoadAttributes | None = None) -> RoutingIndex:
    """Two branches of equal length and speed from ``branch-start`` (``_X``) to ``branch-end``
    (``_X + 200``): via ``north-*`` and via ``south-*``. No signals."""
    graph = nx.MultiDiGraph()
    node, edge = _builders(graph, road_attributes or {})
    node("branch-start", _X)
    node("branch-end", _X + 200)
    node("north-mid", _X + 100, _Y + 50)
    node("south-mid", _X + 100, _Y - 50)
    for side in ("north", "south"):
        edge(f"{side}-a", "branch-start", f"{side}-mid", 120, 30)
        edge(f"{side}-b", f"{side}-mid", "branch-end", 120, 30)
    return _index(graph, {}, {}, None)


def _index(
    graph: nx.MultiDiGraph,
    approaches: dict[str, tuple[ApproachRef, ...]],
    intersections: dict[str, IntersectionInfo],
    neighbour_candidates: Mapping[tuple[str, str], float] | None,
    signal_approaches: Mapping[str, tuple[SignalApproachRef, ...]] | None = None,
) -> RoutingIndex:
    edges = {
        data["edge_id"]: EdgeView(
            edge_id=data["edge_id"],
            source_node=source,
            target_node=target,
            length_m=float(data["length_m"]),
            speed_kmh=float(data["speed_kmh"]),
            geometry=data["geometry"],
            bus_lane=data["bus_lane"],
            tram_track=data["tram_track"],
            lanes_per_direction=data["lanes_per_direction"],
            surface_class=data["surface_class"],
            calming_count=data["calming_count"],
        )
        for source, target, data in graph.edges(data=True)
    }
    node_keys = tuple(graph.nodes)
    node_points = tuple(
        Point(graph.nodes[key]["x_m"], graph.nodes[key]["y_m"]) for key in node_keys
    )
    return RoutingIndex(
        graph=nx.freeze(graph),
        cascade_threshold_m=250,
        _node_keys=node_keys,
        _node_points=node_points,
        _tree=STRtree(np.asarray(node_points, dtype=object)),
        _max_snap_distance_meters=SimulationSettings().max_snap_distance_meters,
        _edges=MappingProxyType(edges),
        _approaches=MappingProxyType(approaches),
        _intersections=MappingProxyType(intersections),
        _neighbour_candidates=MappingProxyType(dict(neighbour_candidates or {})),
        _signal_approaches=MappingProxyType(dict(signal_approaches or {})),
    )


PARK_CENTRE: tuple[float, float] = (_X + 500, _Y + 400)


def park_index(*, trap: bool = False) -> RoutingIndex:
    """A park (``PARK_CENTRE``) between a slow south road and a fast north road, with a depot
    road at each end. Only ``s-mid`` (400 m) and ``n-mid`` (500 m) are within the default
    on-foot reach. ``trap`` adds ``trap`` (_X + 500, _Y - 900), entered one-way from ``s-mid``."""
    graph = nx.MultiDiGraph()
    node, edge = _builders(graph, {})

    def two_way(name: str, a: str, b: str, length: float, speed: float) -> None:
        edge(f"{name}-fwd", a, b, length, speed)
        edge(f"{name}-rev", b, a, length, speed)

    node("s-west", _X)
    node("s-mid", _X + 500)
    node("s-east", _X + 1_000)
    node("n-west", _X, _Y + 900)
    node("n-mid", _X + 500, _Y + 900)
    node("depot-w", _X - 3_000, _Y + 900)
    node("depot-e", _X + 2_000)
    two_way("south-w", "s-west", "s-mid", 500, 30)
    two_way("south-e", "s-mid", "s-east", 500, 30)
    two_way("north", "n-west", "n-mid", 500, 90)
    two_way("west-link", "n-west", "s-west", 900, 30)
    two_way("depot-w-road", "depot-w", "n-west", 3_000, 90)
    two_way("depot-e-road", "depot-e", "s-east", 1_000, 90)
    if trap:
        node("trap", _X + 500, _Y - 900)
        edge("trap-in", "s-mid", "trap", 900, 30)
    return _index(graph, {}, {}, None)


def park_stations() -> pl.DataFrame:
    """Ambulances at the west and east depots of ``park_index``."""
    return stations_frame(
        ("STN-A-0001", "AMBULANCE", _X - 3_000, _Y + 900),
        ("STN-A-0002", "AMBULANCE", _X + 2_000, _Y),
    )


def stations_frame(*rows: tuple[str, str, float, float]) -> pl.DataFrame:
    """``stations.parquet``-shaped rows ``(station_id, vehicle_type, x_m, y_m)`` on a fixture."""
    kinds = {"AMBULANCE": "prm_base", "FIRE_TRUCK": "fire_state", "POLICE_CAR": "police"}
    positions = [position_at(x, y) for _, _, x, y in rows]
    return pl.DataFrame(
        {
            "station_id": [r[0] for r in rows],
            "vehicle_type": [r[1] for r in rows],
            "source_kind": [kinds[r[1]] for r in rows],
            "name": [f"Station {r[0]}" for r in rows],
            "lat": [p.lat for p in positions],
            "lng": [p.lng for p in positions],
            "osm_ref": [f"line:{i}" for i in range(len(rows))],
            "snap_distance_m": [0.0] * len(rows),
        }
    )


def corridor_stations() -> pl.DataFrame:
    """Stations on ``corridor_index``: ambulances along the one-way corridor, one at its end
    (``corridor-4``), one on the island; a fire station mid-corridor."""
    return stations_frame(
        ("STN-A-0001", "AMBULANCE", _X + 1_000, _Y),
        ("STN-A-0002", "AMBULANCE", _X + 1_100, _Y),
        ("STN-A-0003", "AMBULANCE", _X + 1_600.01, _Y),
        ("STN-A-0004", "AMBULANCE", _X + 1_850.02, _Y),
        ("STN-A-0005", "AMBULANCE", _X + 5_000, _Y),
        ("STN-F-0001", "FIRE_TRUCK", _X + 1_350, _Y),
    )
