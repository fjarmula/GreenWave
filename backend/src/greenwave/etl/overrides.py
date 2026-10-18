"""Hand-made roundabout override file, plus a generator for draft entries to check on a map.

The four named rondos below carry no ``junction=roundabout`` tag in OSM, so tag-based ring
detection misses them. Each override entry lists the ring edges, the entry-arm edges and any
internal edges (for example a bypass link between two ring nodes) by their base edge id
(``W<source line>.<segment>+|-``, valid for the pinned snapshot). A human verifies every entry on a
map (``run_etl.py override-map``) and flips ``verified``; unverified entries are applied but
reported as unverified.
"""

import json
from pathlib import Path

import geopandas as gpd
import networkx as nx
from pydantic import BaseModel, ConfigDict, Field

from greenwave.etl.config import METRIC_CRS, SOURCE_CRS

OVERRIDE_FILENAME = "roundabouts.json"

UNTAGGED_RONDO_NAMES: tuple[str, ...] = (
    "Rondo Mogilskie",
    "Rondo Antoniego Matecznego",
    "Rondo Generała Stanisława Maczka",
    "Rondo Stanisława Barei",
)


class RoundaboutOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    verified: bool = False
    ring_edge_ids: list[str] = Field(default_factory=list)
    entry_arm_edge_ids: list[str] = Field(default_factory=list)
    # Edges inside the intersection that are not part of the circulating ring (for example a
    # bypass link joining two ring nodes): neither ring nor entry arm, and not dangling.
    internal_edge_ids: list[str] = Field(default_factory=list)
    notes: str | None = None


class OverrideFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = 1
    entries: list[RoundaboutOverride] = Field(default_factory=list)


def load_overrides(path: Path) -> OverrideFile:
    """An absent file means "no overrides"; a malformed one is an error, never ignored."""
    if not path.is_file():
        return OverrideFile()
    return OverrideFile.model_validate_json(path.read_text(encoding="utf-8"))


def write_overrides(overrides: OverrideFile, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(overrides.model_dump_json(indent=2) + "\n", encoding="utf-8")


_EdgeRecord = tuple[object, object, str, dict[str, object]]


def draft_override_entries(
    graph: nx.MultiDiGraph, names: tuple[str, ...] = UNTAGGED_RONDO_NAMES
) -> tuple[OverrideFile, dict[str, object]]:
    """Propose ring and entry-arm edges for each name; a human must verify them on a map.

    Heuristic: among the edges carrying the rondo's name, the largest strongly connected piece is
    the circulating ring; every other edge touching a ring node is an entry/exit arm. When no
    closed ring exists the lists stay empty and the note says so.
    """
    entries: list[RoundaboutOverride] = []
    features: list[dict[str, object]] = []
    for name in names:
        entry, edge_features = _draft_entry(graph, name)
        entries.append(entry)
        features.extend(edge_features)
    return OverrideFile(entries=entries), _features_geojson(features)


def _largest_ring_nodes(named: list[_EdgeRecord]) -> set[object] | None:
    """Nodes of the longest closed directed loop among the named edges, if there is one."""
    directed = nx.DiGraph()
    for u, v, _, data in named:
        if u != v:
            directed.add_edge(u, v, length=data["length_m"])
    components = sorted(
        (c for c in nx.strongly_connected_components(directed) if len(c) >= 2),
        key=lambda c: -sum(d["length"] for _, _, d in directed.subgraph(c).edges(data=True)),
    )
    return components[0] if components else None


def _draft_entry(
    graph: nx.MultiDiGraph, name: str
) -> tuple[RoundaboutOverride, list[dict[str, object]]]:
    named: list[_EdgeRecord] = [
        (u, v, key, data)
        for u, v, key, data in graph.edges(keys=True, data=True)
        if data["name"] == name
    ]
    ring_nodes = _largest_ring_nodes(named)
    if ring_nodes is None:
        entry = RoundaboutOverride(
            name=name,
            notes=f"no closed directed ring among {len(named)} edges named {name!r}; "
            "fill in by hand",
        )
        return entry, []
    ring = [(u, v, key, data) for u, v, key, data in named if u in ring_nodes and v in ring_nodes]
    ring_ids = {key for _, _, key, _ in ring}
    arms = [
        (u, v, key, data)
        for u, v, key, data in graph.edges(keys=True, data=True)
        if (u in ring_nodes or v in ring_nodes) and key not in ring_ids
    ]
    entry = RoundaboutOverride(
        name=name,
        ring_edge_ids=sorted(ring_ids),
        entry_arm_edge_ids=sorted(key for _, _, key, _ in arms),
        notes=(
            f"DRAFT: {len(ring)} ring edges (largest closed loop among edges named "
            f"{name!r}), {len(arms)} edges touching it; check on a map"
        ),
    )
    features = [
        {
            "role": role,
            "rondo": name,
            "edge_id": key,
            "street": data["name"],
            "geometry": data["geometry"],
        }
        for role, group in (("ring", ring), ("entry_arm", arms))
        for _, _, key, data in group
    ]
    return entry, features


def _features_geojson(features: list[dict[str, object]]) -> dict[str, object]:
    frame = gpd.GeoDataFrame(
        [{k: v for k, v in f.items() if k != "geometry"} for f in features],
        geometry=[f["geometry"] for f in features],
        crs=METRIC_CRS,
    ).to_crs(SOURCE_CRS)
    return (
        json.loads(frame.to_json(drop_id=True))
        if len(frame)
        else {"type": "FeatureCollection", "features": []}
    )
