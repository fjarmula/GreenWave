"""Pydantic models for the ``profile`` section of ``etl_report.json`` (step T1)."""

from pydantic import BaseModel


class Bbox(BaseModel):
    min_lon: float
    min_lat: float
    max_lon: float
    max_lat: float


class InvalidGeometrySample(BaseModel):
    line_number: int
    geometry_type: str
    reason: str


class GeometryProfile(BaseModel):
    total_features: int
    features_by_geometry_type: dict[str, int]
    malformed_lines: int
    malformed_samples: list[str]
    invalid_geometry_count: int
    invalid_by_reason: dict[str, int]
    invalid_samples: list[InvalidGeometrySample]
    non_string_tag_values: int
    bbox: Bbox | None
    points_total: int
    points_outside_city_proxy: int
    city_outline_proxy: str


class TagCoverage(BaseModel):
    ways_with_tag: int
    share_of_ways: float
    length_km_with_tag: float
    share_of_length: float


class RoadClassProfile(BaseModel):
    highway: str
    ways: int
    length_km: float
    tag_coverage: dict[str, TagCoverage]


class RoadsProfile(BaseModel):
    drivable_definition: str
    linestrings_with_highway: int
    highway_tagged_polygons: int
    highway_value_counts: dict[str, int]
    drivable_ways: int
    drivable_ways_excluded_by_access: int
    drivable_length_km: float
    drivable_distinct_vertices: int
    service_subtype_counts: dict[str, int]
    maxspeed_unparsed_values: dict[str, int]
    oneway_values: dict[str, int]
    overall: RoadClassProfile
    by_road_class: list[RoadClassProfile]
    drivable_ways_outside_city_proxy: int


class DistanceSummary(BaseModel):
    count: int
    min_m: float | None
    median_m: float | None
    max_m: float | None
    within_5m: int
    within_10m: int
    within_25m: int


class ClusteringProfile(BaseModel):
    radius_m: float
    nodes: int
    clusters: int
    size_histogram: dict[str, int]
    max_size: int
    max_diameter_m: float
    clusters_with_diameter_over_radius: int


class ProbeSignal(BaseModel):
    lon: float
    lat: float
    distance_to_center_m: float
    tag_variant: str
    direction: str | None
    cluster_size_by_radius_m: dict[str, int]


class ProbeResult(BaseModel):
    label: str
    found: bool
    center_lon: float | None
    center_lat: float | None
    signals_within_100m: list[ProbeSignal]


class CrossingsProfile(BaseModel):
    total: int
    by_kind: dict[str, int]
    signal_nodes_also_tagged_crossing: int
    on_drivable_vertex: int
    within_radius_of_any_signal: dict[str, int]
    within_radius_of_junction_signal: dict[str, int]


class SignalsProfile(BaseModel):
    signal_nodes: int
    signal_features_not_points: int
    tag_variants: dict[str, int]
    with_direction: int
    direction_values: dict[str, int]
    with_name: int
    with_ref: int
    with_check_date: int
    vertex_position: dict[str, int]
    on_drivable_vertex: int
    off_network_nearest_way: DistanceSummary
    outside_city_proxy: int
    clustering_all: list[ClusteringProfile]
    clustering_excluding_non_blocking: list[ClusteringProfile]
    crossings: CrossingsProfile
    probes: list[ProbeResult]


class UliceProfile(BaseModel):
    declared_crs: str | None
    features: int
    features_by_geometry_type: dict[str, int]
    total_length_km: float
    property_names: list[str]
    null_street_names: int
    invalid_geometries: int
    bbox_in_metric_crs: list[float]


class CsvProfile(BaseModel):
    file: str
    rows: int
    columns: list[str]


class KrakowProfile(BaseModel):
    ulice: UliceProfile
    csv_files: list[CsvProfile]
    export_timestamp_line: str


class ClaimCheck(BaseModel):
    claim: str
    documented: float
    measured: float
    matches: bool


class ProfileSection(BaseModel):
    generated_at_utc: str
    inputs_sha256: dict[str, str]
    library_versions: dict[str, str]
    geometry: GeometryProfile
    roads: RoadsProfile
    signals: SignalsProfile
    krakow: KrakowProfile
    claims_check: list[ClaimCheck]
