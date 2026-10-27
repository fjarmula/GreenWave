"""Step `places`: rescue stations from OSM and address points from EMUiA and OSM, snapped to the
network. Addresses are reconciled (``address_reconcile``) so each carries its provenance."""

import hashlib
import json
import logging
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

import networkx as nx
import numpy as np
import polars as pl
import shapely
import shapely.ops
from pydantic import BaseModel

from greenwave import artifacts
from greenwave.etl.address_reconcile import (
    ReconciliationCounts,
    ReconciliationExamples,
    reconcile_addresses,
    reconciliation_examples,
)
from greenwave.etl.addresses import (
    assign_labels,
    canonical_housenumber,
    dedupe_addresses,
    extract_addresses,
)
from greenwave.etl.config import (
    ADDRESS_DEDUP_RADIUS_M,
    ADDRESS_MATCH_CLEAN_M,
    ADDRESS_MATCH_MAX_M,
    ADDRESS_NAME_VARIANT_RADIUS_M,
    PLACES_MAX_SNAP_DISTANCE_M,
    STATION_DEDUP_RADIUS_M,
)
from greenwave.etl.connectivity import main_component_nodes
from greenwave.etl.geo import project_points, unproject_points
from greenwave.etl.ingest_osm import OsmFeature, iter_osm_records
from greenwave.etl.intersections_pipeline import (
    IDS_FILENAME,
    NETWORK_EDGES_FILENAME,
    NETWORK_NODES_FILENAME,
    artifact_hashes,
)
from greenwave.etl.io import REPORT_FILENAME
from greenwave.etl.manifest import MANIFEST_FILENAME
from greenwave.etl.municipal_addresses import (
    EMUIA_RELATIVE_PATH,
    emuia_export_timestamp,
    load_municipal_addresses,
)
from greenwave.etl.neighbours_pipeline import StaleArtifactError, _recorded_t4_hashes
from greenwave.etl.profile import OSM_RELATIVE_PATH
from greenwave.etl.stations import (
    StationCandidate,
    assign_station_ids,
    classify_station,
    collapse_encoding_twins,
    dedupe_stations,
    extract_station_candidates,
)

logger = logging.getLogger(__name__)

STATIONS_FILENAME = artifacts.STATIONS_FILENAME
ADDRESSES_FILENAME = artifacts.ADDRESSES_FILENAME
PLACES_ARTIFACT_FILENAMES = artifacts.PLACES_ARTIFACT_FILENAMES
_CONSUMED = (NETWORK_NODES_FILENAME, NETWORK_EDGES_FILENAME)


class DroppedPlace(BaseModel):
    name: str
    vehicle_type: str
    reason: str
    snap_distance_m: float


class StationsReport(BaseModel):
    by_vehicle_type: dict[str, int]
    by_source_kind: dict[str, int]
    encoding_twins: int
    duplicates_merged: int
    dropped: list[DroppedPlace]
    police_names: list[str]
    # Polygon stations whose centre was beyond the snap limit, moved to the outline point nearest
    # the network (their access point) instead of being dropped.
    relocated_to_outline: list[str]
    excluded: list[str]  # police and ambulance names left out by the exclusion fragments
    no_usable_point: int


class AddressReconciliationReport(ReconciliationCounts):
    """EMUiA vs OSM; ``municipal_total`` EMUiA points read, ``municipal_rows`` those on-network."""

    municipal_total: int
    municipal_dropped_off_network: int
    thresholds_m: dict[str, float]
    emuia_export_timestamp: str | None
    examples: ReconciliationExamples


class AddressesReport(BaseModel):
    """``rows`` is every written address; the other counts describe the OSM side."""

    rows: int
    skipped_missing_tags: int
    no_usable_point: int
    dropped_off_network: int
    duplicates_merged: int
    reconciliation: AddressReconciliationReport


class PlacesSection(BaseModel):
    """``consumed_sha256`` the network files read; ``artifact_sha256`` the files written."""

    manifest_sha256: str
    snap_limit_m: float
    station_dedup_radius_m: float
    address_dedup_radius_m: float
    consumed_sha256: dict[str, str]
    artifact_sha256: dict[str, str]
    stations: StationsReport
    addresses: AddressesReport


def _relevant_features(path: Path) -> Iterator[OsmFeature]:
    """One pass over the extract, yielding only station- or address-tagged features."""
    for record in iter_osm_records(path):
        if not isinstance(record, OsmFeature):
            continue
        properties = record.properties
        if classify_station(properties) is not None or any(
            key.startswith("addr:") for key in properties
        ):
            yield record


def _snap_distances(node_xy: np.ndarray, lons: list[float], lats: list[float]) -> np.ndarray:
    """Metric distance from each lon/lat point to its nearest network node."""
    if not lons:
        return np.empty(0, dtype=np.float64)
    points = shapely.points(
        project_points(np.array(lons, dtype=np.float64), np.array(lats, dtype=np.float64))
    )
    tree = shapely.STRtree(shapely.points(node_xy))
    _, distances = tree.query_nearest(points, return_distance=True, all_matches=False)
    return np.asarray(distances, dtype=np.float64)


def _relocate_to_access_points(
    candidates: list[StationCandidate], node_xy: np.ndarray, limit_m: float
) -> tuple[list[StationCandidate], list[str]]:
    """Move a polygon station whose centre is beyond ``limit_m`` to the point of its outline
    nearest the network, when that is within ``limit_m`` (a large campus with a road at its edge).
    """
    if not candidates:
        return candidates, []
    distances = _snap_distances(node_xy, [c.lon for c in candidates], [c.lat for c in candidates])
    tree = shapely.STRtree(shapely.points(node_xy))
    relocated: list[StationCandidate] = []
    moved: list[str] = []
    for candidate, distance in zip(candidates, distances, strict=True):
        if distance <= limit_m or candidate.outline is None:
            relocated.append(candidate)
            continue
        metric = shapely.transform(
            candidate.outline, lambda xy: project_points(xy[:, 0].copy(), xy[:, 1].copy())
        )
        node = shapely.points(node_xy[int(tree.nearest(metric))])
        if float(shapely.distance(metric, node)) > limit_m:
            relocated.append(candidate)
            continue
        access, _ = shapely.ops.nearest_points(metric, node)
        lon, lat = unproject_points(np.array([[access.x, access.y]], dtype=np.float64))[0]
        relocated.append(replace(candidate, lon=float(lon), lat=float(lat)))
        moved.append(candidate.name)
    return relocated, sorted(moved)


def run_places(raw_dir: Path, processed_dir: Path) -> PlacesSection:
    manifest_sha256 = hashlib.sha256((raw_dir / MANIFEST_FILENAME).read_bytes()).hexdigest()
    ids = json.loads((processed_dir / IDS_FILENAME).read_text(encoding="utf-8"))
    built_from = ids["valid_for"]["manifest_sha256"]
    if built_from != manifest_sha256:
        raise StaleArtifactError(
            f"processed intersections were built from manifest {built_from[:12]}..., but the "
            f"current manifest is {manifest_sha256[:12]}...; re-run the intersections step"
        )
    recorded = _recorded_t4_hashes(processed_dir / REPORT_FILENAME)
    consumed = artifact_hashes(processed_dir, _CONSUMED)
    changed = [name for name in _CONSUMED if consumed[name] != recorded[name]]
    if changed:
        raise StaleArtifactError(
            f"{', '.join(changed)} differ from the hashes the intersections step recorded in "
            f"{REPORT_FILENAME}; re-run the intersections step"
        )

    # Snap like the runtime router: only to the main component, so no place sits on an island.
    edges = pl.read_parquet(processed_dir / NETWORK_EDGES_FILENAME, columns=["u", "v"])
    routable = main_component_nodes(nx.MultiDiGraph(edges.rows()))
    nodes = pl.read_parquet(
        processed_dir / NETWORK_NODES_FILENAME, columns=["node_key", "x_m", "y_m"]
    )
    node_xy = (
        nodes.filter(pl.col("node_key").is_in(list(routable)))
        .select("x_m", "y_m")
        .to_numpy()
        .astype(np.float64)
    )

    features = list(_relevant_features(raw_dir / OSM_RELATIVE_PATH))
    logger.info("%d station- or address-tagged features", len(features))

    stations_without_point: list[str] = []
    excluded: list[str] = []
    candidates = extract_station_candidates(features, stations_without_point, excluded)
    singles, twins = collapse_encoding_twins(candidates)
    deduped, merged = dedupe_stations(singles, radius_m=STATION_DEDUP_RADIUS_M)
    kept, relocated = _relocate_to_access_points(deduped, node_xy, PLACES_MAX_SNAP_DISTANCE_M)
    distances = _snap_distances(node_xy, [c.lon for c in kept], [c.lat for c in kept])
    distance_by_ref = {c.osm_ref: float(d) for c, d in zip(kept, distances, strict=True)}
    on_network = [c for c in kept if distance_by_ref[c.osm_ref] <= PLACES_MAX_SNAP_DISTANCE_M]
    dropped = [
        DroppedPlace(
            name=c.name,
            vehicle_type=c.vehicle_type,
            reason="off_network",
            snap_distance_m=round(distance_by_ref[c.osm_ref], 1),
        )
        for c in kept
        if distance_by_ref[c.osm_ref] > PLACES_MAX_SNAP_DISTANCE_M
    ]
    stations = assign_station_ids(on_network)
    stations = stations.with_columns(
        pl.col("osm_ref")
        .replace_strict(distance_by_ref, return_dtype=pl.Float64)
        .alias("snap_distance_m")
    )

    addresses, skipped, addresses_without_point = extract_addresses(features)
    address_distances = _snap_distances(
        node_xy, addresses["lng"].to_list(), addresses["lat"].to_list()
    )
    near = address_distances <= PLACES_MAX_SNAP_DISTANCE_M
    # Filter before de-duplicating, so an off-network twin cannot displace the on-network one.
    addresses_on_network, address_twins = dedupe_addresses(
        addresses.filter(pl.Series(near, dtype=pl.Boolean)), ADDRESS_DEDUP_RADIUS_M
    )

    # Every extracted OSM key inside Kraków, before any filter: a municipal record whose key OSM
    # has (even off-network or merged away) is not a gap OSM lacks.
    extracted_keys = frozenset(
        (key, canonical_housenumber(number))
        for key, number, outside in addresses.select(
            "search_key", "housenumber", "outside_krakow"
        ).iter_rows()
        if not outside
    )
    municipal = load_municipal_addresses(raw_dir / EMUIA_RELATIVE_PATH)
    municipal_near = (
        _snap_distances(node_xy, municipal["lng"].to_list(), municipal["lat"].to_list())
        <= PLACES_MAX_SNAP_DISTANCE_M
    )
    reconciled, address_counts = reconcile_addresses(
        municipal.filter(pl.Series(municipal_near, dtype=pl.Boolean)),
        addresses_on_network,
        extracted_keys,
    )
    labelled = assign_labels(reconciled)
    stations.write_parquet(processed_dir / STATIONS_FILENAME)
    labelled.write_parquet(processed_dir / ADDRESSES_FILENAME)

    def counts(column: str) -> dict[str, int]:
        return {str(k): int(v) for k, v in stations[column].value_counts().sort(column).rows()}

    return PlacesSection(
        manifest_sha256=manifest_sha256,
        snap_limit_m=PLACES_MAX_SNAP_DISTANCE_M,
        station_dedup_radius_m=STATION_DEDUP_RADIUS_M,
        address_dedup_radius_m=ADDRESS_DEDUP_RADIUS_M,
        consumed_sha256=consumed,
        artifact_sha256=artifact_hashes(processed_dir, PLACES_ARTIFACT_FILENAMES),
        stations=StationsReport(
            by_vehicle_type=counts("vehicle_type"),
            by_source_kind=counts("source_kind"),
            encoding_twins=twins,
            duplicates_merged=merged,
            dropped=dropped,
            relocated_to_outline=relocated,
            police_names=sorted(
                stations.filter(pl.col("vehicle_type") == "POLICE_CAR")["name"].to_list()
            ),
            excluded=sorted(set(excluded)),
            no_usable_point=len(stations_without_point),
        ),
        addresses=AddressesReport(
            rows=labelled.height,
            skipped_missing_tags=skipped,
            no_usable_point=addresses_without_point,
            dropped_off_network=int((~near).sum()),
            duplicates_merged=address_twins,
            reconciliation=AddressReconciliationReport(
                **address_counts.model_dump(),
                municipal_total=municipal.height,
                municipal_dropped_off_network=int((~municipal_near).sum()),
                thresholds_m={
                    "clean": ADDRESS_MATCH_CLEAN_M,
                    "max": ADDRESS_MATCH_MAX_M,
                    "name_variant": ADDRESS_NAME_VARIANT_RADIUS_M,
                },
                emuia_export_timestamp=emuia_export_timestamp(raw_dir),
                examples=reconciliation_examples(labelled),
            ),
        ),
    )
