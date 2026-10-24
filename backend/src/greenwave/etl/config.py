"""ETL configuration: every operationally tunable value, with units in the names.

Comments say where a value comes from: "APPROVED" values were decided by the human, "analysis"
values only drive reports and checks, and "placeholder" values are uncalibrated modeling
assumptions rather than empirical measurements. ``docs/engineering/data-pipeline.md`` describes
this provenance policy. Nothing here is read by request handlers; the ETL reads it at build time.
"""

from enum import StrEnum

SOURCE_CRS = "EPSG:4326"
# All distance work happens here (metres). Verified against Ulice.geojson, which is already in it.
METRIC_CRS = "EPSG:2178"

# Provisional "drivable" definition, chosen because it reproduces the documented ~50,107 ways
# (it yields 50,108 on the current snapshot): these highway classes, minus access=private|no.
# This is the definition the T1 profile measures. The routable network used from T2 on also
# drops driveways, parking aisles and drive-throughs (EXCLUDED_SERVICE_SUBTYPES, decision 4).
DRIVABLE_HIGHWAY_VALUES: frozenset[str] = frozenset(
    {
        "motorway",
        "motorway_link",
        "trunk",
        "trunk_link",
        "primary",
        "primary_link",
        "secondary",
        "secondary_link",
        "tertiary",
        "tertiary_link",
        "unclassified",
        "residential",
        "living_street",
        "road",
        "service",
    }
)
EXCLUDED_ACCESS_VALUES: frozenset[str] = frozenset({"private", "no"})

# Access ways: extra ways an emergency vehicle may use beyond the drivable set. They are kept
# apart from the drivable ways (the T1 profile is unchanged) and merged before welding.
# PLACEHOLDER 2026-10-24 (human requested tracks and emergency ways; uncalibrated):
# a usable track is unpaved-but-firm (tracktype grade1-3 or untagged) and not closed by access;
ACCESS_TRACK_TRACKTYPES: frozenset[str] = frozenset({"grade1", "grade2", "grade3"})
# PLACEHOLDER 2026-10-24 (human requested tracks and emergency ways; uncalibrated):
# an emergency tag opens a way whatever its access tag;
EMERGENCY_ACCESS_VALUES: frozenset[str] = frozenset({"yes", "designated", "official"})
# PLACEHOLDER 2026-10-24 (human requested tracks and emergency ways; uncalibrated):
# classes an emergency tag may open beyond the drivable ones (never footways, paths or steps).
EMERGENCY_EXTRA_HIGHWAY_VALUES: frozenset[str] = frozenset({"track", "pedestrian"})

# Radii the profile evaluates for signal clustering. These are measurements, not the chosen
# `SIGNAL_CLUSTER_RADIUS_METERS` (decision 2).
CLUSTER_PROBE_RADII_METERS: tuple[float, ...] = (15.0, 30.0, 50.0)

# Tags whose coverage is reported by road class. A tag counts as present when the key equals the
# tag or continues it with a colon (``lanes`` also matches ``lanes:forward``), except for the
# exact-only tags, where ``name:pl`` or ``oneway:bicycle`` must not count as the main tag.
COVERAGE_TAGS: tuple[str, ...] = (
    "maxspeed",
    "oneway",
    "lanes",
    "name",
    "junction",
    "bus:lanes",
    "busway",
    "lanes:bus",
)
EXACT_ONLY_TAGS: frozenset[str] = frozenset({"name", "oneway", "junction"})

NON_BLOCKING_SIGNAL_TAGS: frozenset[str] = frozenset({"blinker", "tram_priority"})

SAMPLE_LIMIT = 20

# Radii drawn on the cluster decision map (a viewing aid, not the chosen radius).
CLUSTER_MAP_RADII_METERS: tuple[float, ...] = (20.0, 30.0, 40.0, 50.0)

# ---------------------------------------------------------------------------------------------
# APPROVED DEFAULTS (human, 2026-10-14) unless a comment says "placeholder" or "analysis".
# ---------------------------------------------------------------------------------------------

# Service subtypes that are not part of the routable network. Other subtypes (alley,
# emergency_access, bus, slipway, no subtype) stay in. access=private|no stays excluded.
EXCLUDED_SERVICE_SUBTYPES: frozenset[str] = frozenset(
    {"driveway", "parking_aisle", "drive-through"}
)


class SignalHandling(StrEnum):
    COUNT_IN_DELAY = "count_in_delay"  # contributes D_v
    EXCLUDE_AND_REJECT = "exclude_and_reject"  # kept out of D_v, listed in the rejects report
    MANUAL_REVIEW = "manual_review"  # counts in D_v, flagged needs_review, listed with coordinates


ABSENT_TAG = "<absent>"

# Provisional grouping radius (distance only, single linkage, inclusive). The final intersection
# is the graph junction node (T4); this only groups signal nodes until then. 40 m was chosen from
# the cluster map: under-merging is fixable in T4, over-merging is not.
SIGNAL_CLUSTER_RADIUS_METERS = 40.0

# D_v per type, one independent key each so calibration can change them separately later.
# Applied once per unique intersection INT-xxxx (signalised junction, mid-block signal or pedestrian
# crossing) whose controlled approach a route passes, never once per signal node or per approach.
# `intersections.parquet` gets its `delay_seconds` from these keys by kind.
# PROVISIONAL 2026-10-19 (human): 35 s is a modeling assumption, not an empirical measurement.
# Calibrate after dynamic ambulance dispatch and before final end-to-end performance evaluation.
SIGNAL_DELAY_SECONDS = 35.0
MIDBLOCK_SIGNAL_DELAY_SECONDS = 35.0
PEDESTRIAN_CROSSING_DELAY_SECONDS = 35.0

# Keyed by the value of the `traffic_signals` tag on highway=traffic_signals nodes.
SIGNAL_TAG_HANDLING: dict[str, SignalHandling] = {
    ABSENT_TAG: SignalHandling.COUNT_IN_DELAY,
    "signal": SignalHandling.COUNT_IN_DELAY,
    "traffic_lights": SignalHandling.COUNT_IN_DELAY,
    "blinker": SignalHandling.EXCLUDE_AND_REJECT,
    "tram_priority": SignalHandling.EXCLUDE_AND_REJECT,
    "controller": SignalHandling.MANUAL_REVIEW,
}

# Signalised crossings, keyed by kind ("highway=crossing", "railway=tram_crossing", ...).
# Only these kinds count, and only when standalone (see the distance below); every other kind,
# including all tram/rail crossings, is excluded and listed in the rejects report.
COUNTED_CROSSING_KINDS: frozenset[str] = frozenset({"highway=crossing"})
# A crossing with a signal node within this distance duplicates that junction signal.
# Its own key, independent of the cluster radius. The T1 profile measured 89 standalone at 30 m
# against all signal nodes; T2 compares against counted signal nodes only.
STANDALONE_CROSSING_DISTANCE_METERS = 30.0

# OSM implied one-way rules (https://wiki.openstreetmap.org/wiki/Key:oneway). An explicit
# oneway=no always wins. Roundabout ways are digitised in the direction of travel.
IMPLIED_ONEWAY_HIGHWAY_VALUES: frozenset[str] = frozenset({"motorway", "motorway_link"})
IMPLIED_ONEWAY_JUNCTION_VALUES: frozenset[str] = frozenset({"roundabout", "circular"})

# Speed used when a way has no parseable maxspeed; the result is tagged speed_source=class_default.
# Each value is the most common maxspeed among tagged ways of that class in the snapshot
# (after excluding driveway/parking_aisle/drive-through service ways). Evidence, with
# tagged / total ways and the share of tagged ways at the chosen value:
#   motorway 240/245 (53%), motorway_link 134/149 (36%, median is 60), trunk 25/25 (64%),
#   primary 1279/1302 (53%; 50 km/h is 43%), secondary 1354/1458 (62%), tertiary 2252/2714 (76%),
#   unclassified 269/570 (63%), residential 4881/8565 (69%), living_street 914/1432 (98%),
#   service 960/10589 (51%), secondary_link 142/182 (86% at 50), primary_link 110/146 (74%),
#   tertiary_link 30/43 (87%).
# trunk_link and road have no tagged way in the snapshot; their 50 is a placeholder (one way each).
# primary is 50 by decision: the most common tagged value is 70 (53%), 50 is 43%.
CLASS_DEFAULT_SPEED_KMH: dict[str, int] = {
    "motorway": 140,
    "motorway_link": 50,
    "trunk": 70,
    "trunk_link": 50,
    "primary": 50,
    "primary_link": 50,
    "secondary": 50,
    "secondary_link": 50,
    "tertiary": 50,
    "tertiary_link": 50,
    "unclassified": 50,
    "residential": 30,
    "living_street": 20,
    "road": 50,
    "service": 30,
    # PLACEHOLDER 2026-10-24 (human requested tracks and emergency ways; uncalibrated).
    "track": 15,
    "pedestrian": 10,
}

# Analysis only (not approved as a modelling rule): how close a signal node must be to a
# roundabout ring to be reported as "at" that roundabout in the roundabout report.
ROUNDABOUT_SIGNAL_ASSOCIATION_METERS = 40.0

# Analysis only (not approved modelling rules): acceptance windows for the T3 checks.
# Graph length / Ulice length per street. Dual carriageways are two ways in OSM but one line in
# Ulice, so ratios near 2 are expected for some streets and are reported, not hidden.
STREET_LENGTH_RATIO_RANGE: tuple[float, float] = (0.8, 1.25)
# Route length / straight-line distance for the shortest-path sanity checks (set by the human).
ROUTE_DETOUR_RATIO_RANGE: tuple[float, float] = (1.0, 1.6)
# Largest allowed distance from a reference place to the graph node used as a route endpoint.
ROUTE_SNAP_TOLERANCE_METERS = 150.0

# --- T4 ---------------------------------------------------------------------------------------
# APPROVED 2026-10-14: how far a signal that is not on a routable vertex may be snapped to the
# nearest edge. The 22 off-network signals lie up to about 29 m from a road; the snap report lists
# every distance.
SIGNAL_SNAP_TOLERANCE_METERS = 30.0
# Reported near-misses: endpoints of different ways this close that share no vertex.
NEAR_MISS_TOLERANCE_METERS = 1.5
# A graph node is a junction when it touches at least this many distinct neighbouring nodes.
JUNCTION_MIN_DISTINCT_NEIGHBOURS = 3
# APPROVED 2026-10-14: an approach farther than this from its nearest junction along the road
# becomes a standalone mid-block signal instead of joining that junction.
ASSIGNMENT_LIMIT_METERS = 50.0
# APPROVED 2026-10-14: junction nodes that have counted signals and lie within this distance along
# the road merge into one intersection (ring groups are formed first and are not merged further).
MERGE_DISTANCE_METERS = 30.0
# APPROVED (65 m): cap on the diameter (largest along-road distance between two member
# nodes) of a merged group. A merge that would exceed it is refused and reported.
MERGE_MAX_GROUP_DIAMETER_METERS = 65.0
# APPROVED: standalone pedestrian crossings within this distance along the road merge into one
# intersection (same diameter cap as above). Its own key, separate from the junction merge distance.
CROSSING_MERGE_DISTANCE_METERS = 15.0
# APPROVED 2026-10-14: way ends this close to another way's end or body are welded (a shared
# vertex is created), unless the two ways are on different layers / bridges / tunnels.
WELD_TOLERANCE_METERS = 1.0
INTERSECTION_ID_PREFIX = "INT-"

# --- T5 ---------------------------------------------------------------------------------------
# Cascade (corridor batching) threshold. The architecture doc gives an along-route stop-line
# distance d <= 250 m (inclusive). T5 stores neighbour pairs by shortest drive with distance <= this
# value (inclusive); the table is only a candidate set, the engine uses the along-route distance.
CASCADE_THRESHOLD_METERS = 250.0
# Whether a candidate path may reverse straight back along the edge it arrived on (a U-turn at a
# node). The graph has no turn restrictions, so U-turns would create spurious "neighbours" such as
# the opposing approach of the next signal. Off by default; the report counts the difference.
CASCADE_ALLOW_U_TURNS = False

# --- Road attributes ------------------------------------------------------------------------
# Analysis: OSM `surface` values grouped as on the OSM wiki Key:surface page (paved / unpaved).
# A value in neither set is unknown: surface_class stays null and the value is counted in the
# report.
PAVED_SURFACE_VALUES: frozenset[str] = frozenset(
    {
        "asphalt",
        "concrete",
        "paving_stones",
        "sett",
        "concrete:plates",
        "concrete:lanes",
        "paved",
        "cobblestone",
        "metal",
        "wood",
        "unhewn_cobblestone",
    }
)
UNPAVED_SURFACE_VALUES: frozenset[str] = frozenset(
    {
        "unpaved",
        "gravel",
        "fine_gravel",
        "compacted",
        "dirt",
        "earth",
        "ground",
        "grass",
        "sand",
        "mud",
        "pebblestone",
        "grass_paver",
    }
)
# An edge is on a tram track when at least this share of its length lies within this distance of
# an OSM railway=tram line. Reserved track beside the road also matches (accepted, ADR 0005).
# APPROVED 2026-10-19 (human): street-running track lies within about one lane of the road
# centreline; 44.8 directed km match on the snapshot.
TRAM_TRACK_MATCH_METERS = 6.0
# APPROVED 2026-10-19 (human): keeps short crossings and touching ends from counting.
TRAM_TRACK_MIN_OVERLAP_SHARE = 0.5

# PLACEHOLDER (uncalibrated, human to confirm): a point and a polygon with the same folded name,
# same vehicle type and closer than this are one station (the point marks the entrance).
STATION_DEDUP_RADIUS_M = 150.0
# APPROVED (human, 2026-10-20): `amenity=police` features that do not answer 112 calls (city guard,
# railway guard, road transport inspectorate, water police). A police feature whose folded name
# (`normalise_street_name`) contains any fragment is excluded and listed in the ETL report.
POLICE_EXCLUDED_NAME_FRAGMENTS: tuple[str, ...] = (
    "straz miejska",
    "strazy miejskiej",
    "straz ochrony kolei",
    "strazy ochrony kolei",
    "inspektorat transportu drogowego",
    "komisariat wodny",
)
# APPROVED (human, 2026-10-20): `emergency=yes` hospitals that are not 112 emergency/trauma dispatch
# bases (specialty or rehabilitation clinics with an admission room). Same fragment matching as
# POLICE_EXCLUDED_NAME_FRAGMENTS; applies to AMBULANCE stations only; listed in the ETL report.
AMBULANCE_EXCLUDED_NAMES: tuple[str, ...] = ("reumatologii", "rehabilitacji")
# APPROVED (human, 2026-10-20): `amenity=hospital` features that are 112 emergency/trauma bases but
# lack `emergency=yes` in OSM. Whole folded name must match (not a fragment), so e.g. the old-campus
# "Szpital Uniwersytecki CM UJ" clinics stay out. Several buildings of one name merge into one
# station at any distance, keeping the main building, as for police.
AMBULANCE_INCLUDED_NAMES: tuple[str, ...] = ("Szpital Uniwersytecki",)
# APPROVED (human, 2026-10-20): same-name stations of these types are one station at any distance
# (dispatch picks the station, not the building). The merged station keeps the building polygon
# (headquarters) over points, which are often satellite offices.
MERGE_SAME_NAME_AT_ANY_DISTANCE: tuple[str, ...] = ("POLICE_CAR",)
# APPROVED (human, 2026-10-20): two addresses with the same folded street and house number closer
# than this are one address (a multi-building complex); farther apart they are distinct (another
# locality, e.g. bounding-box bleed into Wieliczka or Skawina).
ADDRESS_DEDUP_RADIUS_M = 400.0
# APPROVED (human, 2026-10-20): Kraków centre (Rynek Główny). Geocode suggestions closer to it rank
# first among equal matches, and duplicate labels are numbered outward from it.
KRAKOW_CENTRE_LAT_LNG = (50.0617, 19.9373)

# PLACEHOLDER (mirrors the SimulationSettings default; human to confirm). Must equal
# SimulationSettings.max_snap_distance_meters (a test enforces it): stations and addresses farther
# than this from every network node could never be routed to.
PLACES_MAX_SNAP_DISTANCE_M = 150.0
