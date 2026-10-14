"""T1 profile of the Kraków open-data files (street names GeoJSON, CSVs, export timestamp)."""

import csv
import json
from collections import Counter
from pathlib import Path
from typing import cast

import numpy as np
import shapely
from shapely.geometry import shape

from greenwave.etl.profile_models import CsvProfile, KrakowProfile, UliceProfile


def profile_krakow(krakow_dir: Path) -> tuple[KrakowProfile, shapely.Geometry]:
    """Return the profile and a convex hull of all street lines.

    The hull is only a proxy for the city outline (the OSM extract has no city polygon); it is
    already in the metric CRS because Ulice.geojson is published in EPSG:2178.
    """
    document = cast(
        "dict[str, object]", json.loads((krakow_dir / "Ulice.geojson").read_text(encoding="utf-8"))
    )
    crs = cast("dict[str, dict[str, str]]", document.get("crs", {}))
    declared_crs = crs.get("properties", {}).get("name")
    features = cast("list[dict[str, object]]", document["features"])

    type_counts: Counter[str] = Counter()
    property_names: set[str] = set()
    null_names = 0
    invalid = 0
    geometries: list[shapely.Geometry] = []
    for feature in features:
        geometry = shape(feature["geometry"])
        type_counts[geometry.geom_type] += 1
        invalid += not geometry.is_valid
        geometries.append(geometry)
        properties = cast("dict[str, object]", feature.get("properties") or {})
        property_names.update(properties)
        null_names += not properties.get("nazwa_ulicy")
    array = np.array(geometries, dtype=object)
    hull = shapely.convex_hull(shapely.union_all(array))
    min_x, min_y, max_x, max_y = (float(v) for v in shapely.total_bounds(array))

    csv_files = []
    for csv_path in sorted(krakow_dir.glob("*.csv")):
        with csv_path.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.reader(handle)
            columns = next(reader)
            csv_files.append(
                CsvProfile(file=csv_path.name, rows=sum(1 for _ in reader), columns=columns)
            )

    profile = KrakowProfile(
        ulice=UliceProfile(
            declared_crs=declared_crs,
            features=len(features),
            features_by_geometry_type=dict(type_counts),
            total_length_km=float(shapely.length(array).sum()) / 1000,
            property_names=sorted(property_names),
            null_street_names=null_names,
            invalid_geometries=invalid,
            bbox_in_metric_crs=[min_x, min_y, max_x, max_y],
        ),
        csv_files=csv_files,
        export_timestamp_line=(krakow_dir / "__Aktualnosc__.txt")
        .read_text(encoding="utf-8")
        .strip(),
    )
    return profile, hull
