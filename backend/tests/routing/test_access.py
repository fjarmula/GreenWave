import networkx as nx
import pytest
from tests.support.route_fixtures import PARK_CENTRE, corridor_index, park_index, position_at

from greenwave.routing.access import (
    AccessNode,
    EdgeWeight,
    access_nodes,
    best_access,
    seeded_lengths,
)
from greenwave.routing.errors import DestinationOffNetwork
from greenwave.routing.network_index import RoutingIndex
from greenwave.routing.planner import edge_weight
from greenwave.simulation_settings import SimulationSettings

SETTINGS = SimulationSettings()


def test_access_nodes_carry_walk_cost() -> None:
    nodes = {n.node_key: n for n in access_nodes(park_index(), position_at(*PARK_CENTRE), SETTINGS)}
    assert set(nodes) == {"s-mid", "n-mid"}
    s_mid = nodes["s-mid"]
    assert s_mid.straight_m == pytest.approx(400, abs=1e-3)
    assert s_mid.on_foot_m == pytest.approx(520, abs=1e-3)
    assert s_mid.on_foot_seconds == pytest.approx(371.43, abs=0.01)


def test_limit_is_inclusive() -> None:
    reach = SETTINGS.max_on_foot_meters / SETTINGS.on_foot_detour_factor
    x, y = PARK_CENTRE[0], PARK_CENTRE[1] - 400  # s-mid
    accepted = access_nodes(park_index(), position_at(x, y - reach), SETTINGS)
    assert [n.node_key for n in accepted] == ["s-mid"]
    with pytest.raises(
        DestinationOffNetwork,
        match=r"^Incident is farther than 800 m on foot from any vehicle access point$",
    ):
        access_nodes(park_index(), position_at(x, y - reach - 0.01), SETTINGS)


def _weight(index: RoutingIndex) -> EdgeWeight:
    return lambda _source, _target, data: edge_weight(index, data, SETTINGS)


def test_seeded_lengths_equal_networkx_for_one_seed() -> None:
    index = corridor_index()
    reverse = index.graph.reverse(copy=False)
    for node in index.graph.nodes:
        expected = nx.single_source_dijkstra_path_length(reverse, node, weight=_weight(index))
        assert seeded_lengths(reverse, {node: 0.0}, _weight(index)) == pytest.approx(expected)


def test_seeds_start_at_their_value() -> None:
    index = park_index()
    lengths = seeded_lengths(index.graph, {"s-mid": 10.0, "n-mid": 0.0}, _weight(index))
    assert lengths["s-mid"] == 10.0
    assert lengths["n-mid"] == 0.0
    # Every other node takes the cheaper of the two starts.
    from_s = nx.single_source_dijkstra_path_length(index.graph, "s-mid", weight=_weight(index))
    from_n = nx.single_source_dijkstra_path_length(index.graph, "n-mid", weight=_weight(index))
    for node in index.graph.nodes:
        assert lengths[node] == pytest.approx(min(10.0 + from_s[node], from_n[node]))


def _node(key: str, seconds: float) -> AccessNode:
    return AccessNode(key, seconds, seconds, seconds)


def test_best_access_prefers_total_and_skips_excluded_and_unreachable() -> None:
    nodes = [_node("a", 100), _node("b", 10), _node("c", 1), _node("d", 10)]
    lengths = {"a": 0.0, "b": 50.0, "d": 50.0}  # c is unreachable
    # a: 100, b: 60, d: 60 → b wins the tie by node key.
    assert best_access(lengths, nodes) == _node("b", 10)
    assert best_access(lengths, nodes, exclude="b") == _node("d", 10)
    assert best_access({"c": 0.0}, [_node("c", 1)], exclude="c") is None
    assert best_access({}, nodes) is None
