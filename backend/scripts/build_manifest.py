"""Create or check ``backend/data/raw/MANIFEST.json``.

    uv run python scripts/build_manifest.py          # (re)write the manifest from files on disk
    uv run python scripts/build_manifest.py --check  # verify files on disk against the manifest

Hashes and sizes are computed from the files. Provenance fields below are recorded facts from
``docs/engineering/data-pipeline.md`` and the files themselves; anything not known is ``None``
rather than guessed (the Kraków licence wording is decision 7, decided).
"""

import argparse
import sys
from pathlib import Path

from greenwave.etl.manifest import (
    MANIFEST_FILENAME,
    Manifest,
    ManifestEntry,
    load_manifest,
    sha256_of_file,
    verify_manifest,
    write_manifest,
)

RAW_DIR = Path(__file__).resolve().parents[1] / "data" / "raw"

OSM_SOURCE = "OpenStreetMap extract of Krakow, BBBike (https://extract.bbbike.org)"
OSM_LICENCE = "ODbL 1.0"
OSM_ATTRIBUTION = "© OpenStreetMap contributors"
KRAKOW_SOURCE = "Krakow open data (MSIP/ZDMK export)"
KRAKOW_URL = "https://msip.krakow.pl/"
KRAKOW_LICENCE = (
    "Polish Open Data Act (Ustawa z dnia 11 sierpnia 2021 r. o otwartych danych i ponownym "
    "wykorzystywaniu informacji sektora publicznego, Dz.U. 2021 poz. 1641) — free re-use "
    "with source attribution"
)

# (relative path, source, url, retrieved_on, licence, attribution, notes)
# retrieved_on is the local file date; the Krakow export timestamp is 2026-10-13 00:47:34.
_SOURCES: list[tuple[str, str, str | None, str, str | None, str | None, str | None]] = [
    (
        "osm/planet_19.792_50.012_71450a13.osm.geojson",
        OSM_SOURCE,
        None,
        "2026-10-13",
        OSM_LICENCE,
        OSM_ATTRIBUTION,
        "WGS84. Primary source for signals and road network. BBBike request URL not recorded.",
    ),
    (
        "krakow/Ulice.geojson",
        KRAKOW_SOURCE,
        "https://msip.krakow.pl/dataset/1379",
        "2026-10-13",
        KRAKOW_LICENCE,
        "Źródło: Urząd Miasta Krakowa / Miejski System Informacji Przestrzennej (MSIP), "
        "zestaw danych 'Ulice' (stan danych: 2026-10-13 00:47:34). "
        "Dane przetworzone w projekcie ER-GreenWave.",
        "Used in T3 (street_length_comparison.csv) and T4 (intersection street-name "
        "cross-check). EPSG:2178.",
    ),
    (
        "krakow/Buspasy_wyświetlenie_05a20664f5884653b7fa8bd7acbcb5ef.csv",
        KRAKOW_SOURCE,
        KRAKOW_URL,
        "2026-10-13",
        KRAKOW_LICENCE,
        "Źródło: Urząd Miasta Krakowa / Zarząd Dróg Miasta Krakowa (ZDMK) / MSIP, "
        "zestaw danych 'Buspasy' (stan danych: 2026-10-13 00:47:34).",
        "Raw input recorded in MANIFEST.json; parked/unused in PoC simulation (T6 skipped).",
    ),
    (
        "krakow/Linie_KMK_-1530449249114032553.csv",
        KRAKOW_SOURCE,
        KRAKOW_URL,
        "2026-10-13",
        KRAKOW_LICENCE,
        "Źródło: Urząd Miasta Krakowa / Zarząd Transportu Publicznego w Krakowie (ZTP) / MSIP, "
        "zestaw danych 'Linie KMK' (stan danych: 2026-10-13 00:47:34).",
        "Raw input recorded in MANIFEST.json; parked/unused in PoC simulation (T6 skipped).",
    ),
    (
        "krakow/__Aktualnosc__.txt",
        KRAKOW_SOURCE,
        KRAKOW_URL,
        "2026-10-13",
        KRAKOW_LICENCE,
        "Źródło: Urząd Miasta Krakowa / MSIP "
        "(znacznik czasu eksportu danych: 2026-10-13 00:47:34).",
        "Records the export timestamp (2026-10-13 00:47:34) of the Kraków municipal dataset "
        "package; no data used in the simulation.",
    ),
]


def build_manifest() -> Manifest:
    entries: list[ManifestEntry] = []
    for path, source, url, retrieved_on, licence, attribution, notes in _SOURCES:
        file_path = RAW_DIR / path
        if not file_path.is_file():
            raise FileNotFoundError(f"Raw input missing: {file_path}")
        entries.append(
            ManifestEntry(
                path=path,
                sha256=sha256_of_file(file_path),
                size_bytes=file_path.stat().st_size,
                source=source,
                url=url,
                retrieved_on=retrieved_on,
                licence=licence,
                attribution=attribution,
                notes=notes,
            )
        )
    return Manifest(entries=entries)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify instead of writing")
    args = parser.parse_args()
    manifest_path = RAW_DIR / MANIFEST_FILENAME

    if args.check:
        issues = verify_manifest(load_manifest(manifest_path), RAW_DIR)
        for issue in issues:
            print(f"{issue.kind}: {issue.path}: {issue.detail}", file=sys.stderr)
        print("manifest OK" if not issues else f"{len(issues)} issue(s)")
        return 1 if issues else 0

    write_manifest(build_manifest(), manifest_path)
    print(f"wrote {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
