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

EMUIA_SOURCE = "Kraków open data (MSIP), Punkty adresowe (EMUiA)"
EMUIA_URL = "https://msip.krakow.pl/dataset/1492"
EMUIA_TERMS = (
    "Catalogue terms: 'Wykorzystanie danych zgodne z regulaminem MSIP'. Downloaded as "
    "https://msip.um.krakow.pl/Dane/Adresy_JSON.zip."
)

PRM_SOURCE = (
    "Małopolski Urząd Wojewódzki w Krakowie, BIP: Wojewódzki plan działania systemu Państwowe "
    "Ratownictwo Medyczne (Małopolska)"
)
PRM_ATTRIBUTION = (
    "Źródło: Wojewoda Małopolski, Wojewódzki plan działania systemu PRM, aktualizacja nr 2 "
    "(Kraków, 24 czerwca 2026 r.). Dane przetworzone w projekcie ER-GreenWave."
)
PRM_DIR = "prm"
PRM_PLAN_DIR = (
    f"{PRM_DIR}/Obowiazujacy_Wojewodzki_plan_dzialania_systemu_Panstwowe_Ratownictwo_Medyczne"
)
_PRM_NOTE = "Simulation input only; no live availability or dispatch protocol is implied."

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
        "Cross-check only: matched by street name against OSM bus-lane edges "
        "(bus_lane_crosscheck.csv); never changes the network.",
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
    (
        "krakow/emuia/Adresy.geojson",
        EMUIA_SOURCE,
        EMUIA_URL,
        "2026-10-27",
        KRAKOW_LICENCE,
        "Źródło: Urząd Miasta Krakowa, Wydział Geodezji / MSIP, zestaw danych 'Punkty adresowe "
        "(EMUiA)' (stan danych: 2026-10-27 00:45:04). Dane przetworzone w projekcie ER-GreenWave.",
        "EPSG:2178. Authoritative coordinate for incident addresses (places step), reconciled "
        f"against OSM addresses. {EMUIA_TERMS}",
    ),
    (
        "krakow/emuia/__Aktualnosc__.txt",
        EMUIA_SOURCE,
        EMUIA_URL,
        "2026-10-27",
        KRAKOW_LICENCE,
        "Źródło: Urząd Miasta Krakowa, Wydział Geodezji / MSIP "
        "(znacznik czasu eksportu danych: 2026-10-27 00:45:04).",
        "Export timestamp of the EMUiA address package; reported as emuia_export_timestamp. "
        f"{EMUIA_TERMS}",
    ),
    (
        f"{PRM_DIR}/amendments/AKTUALIZACJA_NR_2_TABELE.xlsx",
        PRM_SOURCE,
        None,
        "2026-10-27",
        None,
        PRM_ATTRIBUTION,
        "Plan update no. 2 tables. Tabela nr 1a (teams, operating areas, readiness hours, from "
        "1 Sep 2026) and Tabela nr 2a (team base addresses) feed resources.parquet (places "
        f"step). {_PRM_NOTE}",
    ),
    (
        f"{PRM_DIR}/amendments/AKTUALIZACJA_NR_2_TEKST.docx",
        PRM_SOURCE,
        None,
        "2026-10-27",
        None,
        PRM_ATTRIBUTION,
        "Plan update no. 2 text (24 June 2026; Table 1a applies from 1 Sep 2026). Provenance "
        "only; not read by the ETL.",
    ),
    (
        f"{PRM_PLAN_DIR}/REJONY_ZRM_od_1_stycznia_2026_r._WERSJA_PDF.pdf",
        PRM_SOURCE,
        None,
        "2026-10-27",
        None,
        PRM_ATTRIBUTION,
        "Map of ambulance team areas from 1 Jan 2026. Context only; not read by the ETL.",
    ),
    (
        f"{PRM_PLAN_DIR}/REJONY_ZRM_od_1_stycznia_2026_r._WERSJA_GIF.gif/"
        "REJONY ZRM od 1 stycznia 2026 r. WERSJA GIF.gif",
        PRM_SOURCE,
        None,
        "2026-10-27",
        None,
        PRM_ATTRIBUTION,
        "Image version of the area map. Context only; not read by the ETL.",
    ),
    (
        f"{PRM_DIR}/announcements/Drukowanie.pdf",
        "Małopolski Urząd Wojewódzki w Krakowie, press release",
        None,
        "2026-10-27",
        None,
        None,
        "Press release 'Nowy Wojewódzki plan działania systemu Państwowe Ratownictwo Medyczne' "
        "(2025-11-05), printed to PDF. Provenance only; not read by the ETL.",
    ),
    (
        f"{PRM_DIR}/announcements/Informacje prasowe _ Dla mediów _ Narodowy Fundusz Zdrowia - "
        "Małopolski Oddział Wojewódzki.pdf",
        "Narodowy Fundusz Zdrowia, Małopolski Oddział Wojewódzki, press releases page",
        None,
        "2026-10-27",
        None,
        None,
        "NFZ press releases page, printed to PDF. Provenance only; not read by the ETL.",
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
