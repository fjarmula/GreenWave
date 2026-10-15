import hashlib
from pathlib import Path

import pytest
from pydantic import ValidationError

from greenwave.etl.manifest import (
    MANIFEST_FILENAME,
    IssueKind,
    Manifest,
    ManifestEntry,
    load_manifest,
    sha256_of_file,
    verify_manifest,
    write_manifest,
)

RAW_DIR = Path(__file__).resolve().parents[2] / "data" / "raw"


def _entry(path: str, content: bytes) -> ManifestEntry:
    return ManifestEntry(
        path=path,
        sha256=hashlib.sha256(content).hexdigest(),
        size_bytes=len(content),
        source="test",
        url=None,
        retrieved_on="2026-10-13",
        licence=None,
        attribution=None,
    )


def test_sha256_matches_hashlib_across_chunk_boundary(tmp_path: Path) -> None:
    content = b"x" * (1024 * 1024 + 7)
    file_path = tmp_path / "big.bin"
    file_path.write_bytes(content)

    assert sha256_of_file(file_path) == hashlib.sha256(content).hexdigest()


def test_verify_passes_for_matching_files(tmp_path: Path) -> None:
    (tmp_path / "a.txt").write_bytes(b"alpha")

    assert verify_manifest(Manifest(entries=[_entry("a.txt", b"alpha")]), tmp_path) == []


@pytest.mark.parametrize(
    ("on_disk", "expected_kind"),
    [
        (None, IssueKind.MISSING),
        (b"alpha!", IssueKind.SIZE_MISMATCH),
        (b"alphb", IssueKind.HASH_MISMATCH),  # same size, different content
    ],
)
def test_verify_reports_what_is_wrong_with_a_file(
    tmp_path: Path, on_disk: bytes | None, expected_kind: IssueKind
) -> None:
    if on_disk is not None:
        (tmp_path / "a.txt").write_bytes(on_disk)

    issues = verify_manifest(Manifest(entries=[_entry("a.txt", b"alpha")]), tmp_path)

    assert [(i.path, i.kind) for i in issues] == [("a.txt", expected_kind)]


def test_manifest_round_trips_through_json(tmp_path: Path) -> None:
    manifest = Manifest(entries=[_entry("a.txt", b"alpha")])
    manifest_path = tmp_path / MANIFEST_FILENAME

    write_manifest(manifest, manifest_path)

    assert load_manifest(manifest_path) == manifest


def test_entry_rejects_malformed_hash() -> None:
    with pytest.raises(ValidationError):
        ManifestEntry(
            path="a.txt",
            sha256="not-a-hash",
            size_bytes=1,
            source="test",
            url=None,
            retrieved_on="2026-10-13",
            licence=None,
            attribution=None,
        )


def test_committed_manifest_is_valid_and_records_osm_attribution() -> None:
    manifest = load_manifest(RAW_DIR / MANIFEST_FILENAME)

    osm_entries = [e for e in manifest.entries if e.path.startswith("osm/")]
    assert osm_entries
    assert all(e.licence == "ODbL 1.0" and e.attribution for e in osm_entries)


def test_raw_files_on_disk_match_committed_manifest() -> None:
    """Skipped where raw data is absent (CI); on a dev machine every file must match."""
    manifest = load_manifest(RAW_DIR / MANIFEST_FILENAME)
    present = Manifest(entries=[e for e in manifest.entries if (RAW_DIR / e.path).is_file()])
    if not present.entries:
        pytest.skip("raw data not present on this machine")

    assert verify_manifest(present, RAW_DIR) == []
