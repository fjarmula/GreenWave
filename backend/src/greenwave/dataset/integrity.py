"""Consistency checks across the loaded artifacts: hashes, references, ids and counts."""

import math
from pathlib import Path

import networkx as nx
import polars as pl

from greenwave.artifacts import (
    ADDRESSES_FILENAME,
    APPROACHES_FILENAME,
    IDS_FILENAME,
    INTERSECTIONS_FILENAME,
    NEIGHBOURS_FILENAME,
    NETWORK_EDGES_FILENAME,
    NETWORK_NODES_FILENAME,
    PLACES_ARTIFACT_FILENAMES,
    REPORT_FILENAME,
    STATIONS_FILENAME,
    T4_ARTIFACT_FILENAMES,
    artifact_hashes,
)
from greenwave.dataset.constants import (
    ADDRESS_FILLED_BY_PROVENANCE,
    ADDRESS_MATCH_BASES,
    ADDRESS_PROVENANCES,
    BOUNDS_PADDING_DEG,
    CHAIN,
    COMMAND,
    EXAMPLES_IN_MESSAGE,
    NEIGHBOURS_COMMAND,
    PLACES_COMMAND,
    SOURCE_KINDS,
    STATION_ID_PATTERN,
    STEP_INTERSECTIONS,
    VEHICLE_TYPES,
)
from greenwave.dataset.errors import (
    ArtifactHashMismatchError,
    CountMismatchError,
    MalformedArtifactError,
    ManifestMismatchError,
    ReferentialIntegrityError,
)
from greenwave.dataset.models import (
    IntersectionIdRecord,
    IntersectionsSection,
    LoadedCounts,
    NeighboursSection,
    PlacesSection,
)
from greenwave.etl.neighbours import approach_edges


def check_manifest_hashes(
    manifest_path: Path, manifest_sha256: str, recorded: dict[str, str]
) -> None:
    stale = [where for where, recorded_hash in recorded.items() if recorded_hash != manifest_sha256]
    if stale:
        raise ManifestMismatchError(
            f"{manifest_path} has sha256 {manifest_sha256[:12]}..., but these were built from a "
            f"different manifest: {', '.join(stale)}; re-run {CHAIN}"
        )


def check_artifact_hashes(
    processed_dir: Path,
    intersections_section: IntersectionsSection,
    neighbours_section: NeighboursSection,
) -> None:
    recorded_t4 = intersections_section.artifact_sha256
    recorded_t5 = neighbours_section.artifact_sha256
    consumed = neighbours_section.consumed_sha256
    absent = [
        f"{REPORT_FILENAME} section '{section}' ({field})"
        for section, field, value in (
            ("intersections", "artifact_sha256", recorded_t4),
            ("neighbours", "artifact_sha256", recorded_t5),
            ("neighbours", "consumed_sha256", consumed),
        )
        if value is None
    ]
    if recorded_t4 is None or recorded_t5 is None or consumed is None:
        raise MalformedArtifactError(
            f"{', '.join(absent)} missing: the processed data was written by an older ETL "
            f"version; re-run {CHAIN}"
        )

    expected = {name: recorded_t4.get(name) for name in T4_ARTIFACT_FILENAMES} | {
        NEIGHBOURS_FILENAME: recorded_t5.get(NEIGHBOURS_FILENAME)
    }
    unrecorded = [name for name, value in expected.items() if value is None]
    if unrecorded:
        raise MalformedArtifactError(
            f"{REPORT_FILENAME} records no hash for {', '.join(unrecorded)}; re-run {CHAIN}"
        )

    actual = artifact_hashes(processed_dir, (*T4_ARTIFACT_FILENAMES, NEIGHBOURS_FILENAME))
    for name, on_disk in actual.items():
        if on_disk != expected[name]:
            rerun = NEIGHBOURS_COMMAND if name == NEIGHBOURS_FILENAME else CHAIN
            raise ArtifactHashMismatchError(
                f"{processed_dir / name} has sha256 {on_disk[:12]}..., but {REPORT_FILENAME} "
                f"recorded {str(expected[name])[:12]}... when the step wrote it; the artifacts "
                f"come from different runs or the file was changed, re-run {rerun}"
            )
    different = [name for name in T4_ARTIFACT_FILENAMES if consumed.get(name) != expected[name]]
    if different:
        raise ArtifactHashMismatchError(
            f"{NEIGHBOURS_FILENAME} was built from other versions of {', '.join(different)} than "
            f"the ones on disk now (hashes recorded by the neighbours step differ from section "
            f"'intersections' of {REPORT_FILENAME}); re-run {NEIGHBOURS_COMMAND}"
        )


def check_places_hashes(
    processed_dir: Path, intersections_section: IntersectionsSection, places_section: PlacesSection
) -> None:
    """The places files are the ones the step wrote, from the network files on disk now."""
    recorded = places_section.artifact_sha256
    consumed = places_section.consumed_sha256
    if recorded is None or consumed is None:
        raise MalformedArtifactError(
            f"{REPORT_FILENAME} section 'places' lacks artifact_sha256 or consumed_sha256: the "
            f"processed data was written by an older ETL version; re-run {PLACES_COMMAND}"
        )
    unrecorded = [name for name in PLACES_ARTIFACT_FILENAMES if name not in recorded]
    if unrecorded:
        raise MalformedArtifactError(
            f"{REPORT_FILENAME} records no hash for {', '.join(unrecorded)}; re-run "
            f"{PLACES_COMMAND}"
        )
    for name, on_disk in artifact_hashes(processed_dir, PLACES_ARTIFACT_FILENAMES).items():
        if on_disk != recorded[name]:
            raise ArtifactHashMismatchError(
                f"{processed_dir / name} has sha256 {on_disk[:12]}..., but {REPORT_FILENAME} "
                f"recorded {recorded[name][:12]}... when the step wrote it; re-run {PLACES_COMMAND}"
            )
    network = intersections_section.artifact_sha256 or {}
    different = [
        name
        for name in (NETWORK_NODES_FILENAME, NETWORK_EDGES_FILENAME)
        if consumed.get(name) != network.get(name)
    ]
    if different:
        raise ArtifactHashMismatchError(
            f"{STATIONS_FILENAME} and {ADDRESSES_FILENAME} were built from other versions of "
            f"{', '.join(different)} than the ones on disk now (hashes recorded by the places "
            f"step differ from section 'intersections' of {REPORT_FILENAME}); re-run "
            f"{PLACES_COMMAND}"
        )


def check_delays(processed_dir: Path, intersections: pl.DataFrame) -> None:
    bad = sum(
        value is None or not math.isfinite(value) or value < 0
        for value in intersections["delay_seconds"].to_list()
    )
    if bad:
        raise MalformedArtifactError(
            f"{processed_dir / INTERSECTIONS_FILENAME} column 'delay_seconds' has {bad} null, "
            f"negative or non-finite values; rebuild it with "
            f"`{COMMAND.format(step=STEP_INTERSECTIONS)}`"
        )


def _unknown(values: pl.Series, known: set[str]) -> list[str]:
    return sorted(v for v in values.drop_nulls().unique().to_list() if v not in known)


def _require_known(what: str, location: str, values: pl.Series, known: set[str]) -> None:
    missing = _unknown(values, known)
    if missing:
        shown = ", ".join(missing[:EXAMPLES_IN_MESSAGE])
        more = (
            f" (and {len(missing) - EXAMPLES_IN_MESSAGE} more)"
            if len(missing) > EXAMPLES_IN_MESSAGE
            else ""
        )
        raise ReferentialIntegrityError(
            f"{location} references {len(missing)} {what} that do not exist: {shown}{more}; "
            f"the artifacts come from different runs, re-run {CHAIN}"
        )


def check_references(
    graph: nx.MultiDiGraph,
    intersections: pl.DataFrame,
    approaches: pl.DataFrame,
    neighbours: pl.DataFrame,
) -> None:
    ids = intersections["intersection_id"]
    if ids.null_count() or ids.n_unique() != len(ids):
        raise ReferentialIntegrityError(
            f"{INTERSECTIONS_FILENAME} has null or duplicate intersection_id values; re-run {CHAIN}"
        )
    known_intersections = set(ids.to_list())
    known_edges = {data["edge_id"] for *_, data in graph.edges(data=True)}
    known_nodes = set(graph.nodes)

    for location, column in (
        (APPROACHES_FILENAME, approaches["intersection_id"]),
        (f"{NEIGHBOURS_FILENAME} (from_intersection_id)", neighbours["from_intersection_id"]),
        (f"{NEIGHBOURS_FILENAME} (to_intersection_id)", neighbours["to_intersection_id"]),
    ):
        _require_known(
            f"intersection ids of {INTERSECTIONS_FILENAME}",
            location,
            column,
            known_intersections,
        )
    for location, column in (
        (
            f"{APPROACHES_FILENAME} (controlled_edge_ids)",
            approaches["controlled_edge_ids"].explode(),
        ),
        (f"{NEIGHBOURS_FILENAME} (from_approach_edge_id)", neighbours["from_approach_edge_id"]),
        (f"{NEIGHBOURS_FILENAME} (to_approach_edge_id)", neighbours["to_approach_edge_id"]),
        (f"{NEIGHBOURS_FILENAME} (path_edge_ids)", neighbours["path_edge_ids"].explode()),
    ):
        _require_known(f"edge ids of {NETWORK_EDGES_FILENAME}", location, column, known_edges)
    _require_known(
        f"nodes of {NETWORK_NODES_FILENAME}",
        f"{INTERSECTIONS_FILENAME} (node_key)",
        intersections["node_key"],
        known_nodes,
    )


def _malformed(filename: str, problem: str, rerun: str = PLACES_COMMAND) -> MalformedArtifactError:
    return MalformedArtifactError(f"{filename} {problem}; re-run {rerun}")


def _check_one_of(filename: str, column: str, values: pl.Series, allowed: frozenset[str]) -> None:
    if values.null_count():
        raise _malformed(filename, f"has null values in column '{column}'")
    unknown = _unknown(values, set(allowed))
    if unknown:
        raise _malformed(
            filename,
            f"column '{column}' has unknown values {', '.join(unknown[:EXAMPLES_IN_MESSAGE])} "
            f"(allowed: {', '.join(sorted(allowed))})",
        )


def _check_coordinates(
    filename: str,
    frame: pl.DataFrame,
    graph: nx.MultiDiGraph,
    lng_column: str = "lng",
    rerun: str = PLACES_COMMAND,
) -> None:
    lons = [data["lon"] for _, data in graph.nodes(data=True)]
    lats = [data["lat"] for _, data in graph.nodes(data=True)]
    bounds = {
        "lat": (min(lats) - BOUNDS_PADDING_DEG, max(lats) + BOUNDS_PADDING_DEG),
        lng_column: (min(lons) - BOUNDS_PADDING_DEG, max(lons) + BOUNDS_PADDING_DEG),
    }
    for column, (low, high) in bounds.items():
        values = frame[column]
        if values.null_count() or not values.is_finite().all():
            raise _malformed(filename, f"has null or non-finite values in column '{column}'", rerun)
        outside = int(((values < low) | (values > high)).sum())
        if outside:
            raise _malformed(
                filename,
                f"has {outside} rows with '{column}' outside the network bounds "
                f"[{low:.4f}, {high:.4f}]",
                rerun,
            )


def check_signal_positions(graph: nx.MultiDiGraph, approaches: pl.DataFrame) -> None:
    """Every signal approach has a finite WGS84 position inside the network bounds."""
    rerun = f"`{COMMAND.format(step=STEP_INTERSECTIONS)}`"
    _check_coordinates(APPROACHES_FILENAME, approaches, graph, "lon", rerun)


def _check_address_provenance(addresses: pl.DataFrame) -> None:
    """Provenance values, and the optional columns each provenance fills or leaves null."""
    _check_one_of(ADDRESSES_FILENAME, "provenance", addresses["provenance"], ADDRESS_PROVENANCES)
    if addresses["osm_same_key_elsewhere"].null_count():
        raise _malformed(ADDRESSES_FILENAME, "has null values in column 'osm_same_key_elsewhere'")
    for provenance, columns in ADDRESS_FILLED_BY_PROVENANCE.items():
        rows = addresses.filter(pl.col("provenance") == provenance)
        for column, filled in columns.items():
            nulls = rows[column].null_count()
            if (filled and nulls) or (not filled and nulls != rows.height):
                state = "null" if filled else "set"
                raise _malformed(
                    ADDRESSES_FILENAME, f"has {provenance} rows with '{column}' {state}"
                )
    matched = addresses.filter(pl.col("provenance") == "matched")
    _check_one_of(ADDRESSES_FILENAME, "match_basis", matched["match_basis"], ADDRESS_MATCH_BASES)
    if matched.filter((pl.col("osm_delta_m") < 0) | (pl.col("osm_delta_m") > 500)).height:
        raise _malformed(ADDRESSES_FILENAME, "has 'osm_delta_m' values outside 0 to 500 m")
    if addresses.filter(pl.col("provenance") != "municipal")["osm_same_key_elsewhere"].any():
        raise _malformed(
            ADDRESSES_FILENAME, "has 'osm_same_key_elsewhere' set on a non-municipal row"
        )


def check_places(graph: nx.MultiDiGraph, stations: pl.DataFrame, addresses: pl.DataFrame) -> None:
    """Keys, enumerations and coordinates of stations.parquet and addresses.parquet."""
    ids = stations["station_id"]
    if ids.null_count() or ids.n_unique() != len(ids):
        raise _malformed(STATIONS_FILENAME, "has null or duplicate station_id values")
    badly_formed = ids.filter(~ids.str.contains(STATION_ID_PATTERN)).to_list()
    if badly_formed:
        raise _malformed(
            STATIONS_FILENAME,
            f"has station_id values that do not match {STATION_ID_PATTERN}, e.g. "
            f"{', '.join(badly_formed[:EXAMPLES_IN_MESSAGE])}",
        )
    _check_one_of(STATIONS_FILENAME, "vehicle_type", stations["vehicle_type"], VEHICLE_TYPES)
    _check_one_of(STATIONS_FILENAME, "source_kind", stations["source_kind"], SOURCE_KINDS)
    _check_coordinates(STATIONS_FILENAME, stations, graph)
    for column in ("street", "housenumber", "search_key", "locality", "outside_krakow", "label"):
        if addresses[column].null_count():
            raise _malformed(ADDRESSES_FILENAME, f"has null values in column '{column}'")
    _check_address_provenance(addresses)
    if addresses["label"].n_unique() != addresses.height:
        repeated = addresses.filter(addresses["label"].is_duplicated())["label"].unique().sort()
        raise _malformed(
            ADDRESSES_FILENAME,
            f"has repeated label values, e.g. {', '.join(repeated[:EXAMPLES_IN_MESSAGE])}",
        )
    _check_coordinates(ADDRESSES_FILENAME, addresses, graph)


def check_ids_file(records: list[IntersectionIdRecord], intersections: pl.DataFrame) -> None:
    from_file = {r.id: (r.kind, r.node_key) for r in records}
    from_parquet = {
        row["intersection_id"]: (row["kind"], row["node_key"])
        for row in intersections.select("intersection_id", "kind", "node_key").iter_rows(named=True)
    }
    if len(from_file) != len(records) or from_file != from_parquet:
        differing = sorted(
            i
            for i in from_file.keys() | from_parquet.keys()
            if from_file.get(i) != from_parquet.get(i)
        )
        raise ReferentialIntegrityError(
            f"{IDS_FILENAME} and {INTERSECTIONS_FILENAME} disagree on id -> (kind, node_key) "
            f"for {len(differing)} ids, e.g. {', '.join(differing[:EXAMPLES_IN_MESSAGE])}; "
            f"re-run {CHAIN}"
        )


def check_counts(
    graph: nx.MultiDiGraph,
    intersections: pl.DataFrame,
    approaches: pl.DataFrame,
    neighbours: pl.DataFrame,
    stations: pl.DataFrame,
    addresses: pl.DataFrame,
    intersections_section: IntersectionsSection,
    neighbours_section: NeighboursSection,
    places_section: PlacesSection,
) -> LoadedCounts:
    snapping = intersections_section.snapping
    neighbour_report = neighbours_section.report
    approach_edge_count = len(approach_edges(approaches))
    expected = (
        (
            INTERSECTIONS_FILENAME,
            intersections.height,
            intersections_section.grouping.intersections_total,
        ),
        (
            APPROACHES_FILENAME,
            approaches.height,
            snapping.attached_signals + len(snapping.unsnapped),
        ),
        (NEIGHBOURS_FILENAME, neighbours.height, neighbour_report.pairs),
        (STATIONS_FILENAME, stations.height, sum(places_section.stations.by_vehicle_type.values())),
        (ADDRESSES_FILENAME, addresses.height, places_section.addresses.rows),
        (
            f"{APPROACHES_FILENAME} (approach edges)",
            approach_edge_count,
            neighbour_report.approach_edges,
        ),
    )
    for artifact, actual, recorded in expected:
        if actual != recorded:
            rerun = PLACES_COMMAND if artifact in PLACES_ARTIFACT_FILENAMES else CHAIN
            raise CountMismatchError(
                f"{artifact} has {actual} rows, but {REPORT_FILENAME} records {recorded}; "
                f"re-run {rerun}"
            )
    return LoadedCounts(
        intersections=intersections.height,
        signal_approaches=approaches.height,
        approach_neighbours=neighbours.height,
        stations=stations.height,
        addresses=addresses.height,
        approach_edges=approach_edge_count,
        graph_nodes=graph.number_of_nodes(),
        graph_edges=graph.number_of_edges(),
    )
