"""Manifest of raw input datasets: provenance, licence and integrity (sha256).

``backend/data/raw/MANIFEST.json`` is committed even though the raw files are not, so both
contributors (and CI) can check that they build from the same inputs.
"""

import hashlib
from enum import StrEnum
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

MANIFEST_FILENAME = "MANIFEST.json"
_HASH_CHUNK_BYTES = 1024 * 1024


class ManifestEntry(BaseModel):
    """One raw input file. ``path`` is relative to the raw data directory."""

    model_config = ConfigDict(extra="forbid")

    path: str
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    size_bytes: int = Field(ge=0)
    source: str
    url: str | None
    retrieved_on: str
    licence: str | None
    attribution: str | None
    notes: str | None = None


class Manifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = 1
    entries: list[ManifestEntry]


class IssueKind(StrEnum):
    MISSING = "missing"
    SIZE_MISMATCH = "size_mismatch"
    HASH_MISMATCH = "hash_mismatch"


class ManifestIssue(BaseModel):
    path: str
    kind: IssueKind
    detail: str


def sha256_of_file(path: Path) -> str:
    """Stream the file so large inputs (the OSM extract is ~310 MB) are never fully in memory."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(_HASH_CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest(manifest_path: Path) -> Manifest:
    return Manifest.model_validate_json(manifest_path.read_text(encoding="utf-8"))


def write_manifest(manifest: Manifest, manifest_path: Path) -> None:
    manifest_path.write_text(manifest.model_dump_json(indent=2) + "\n", encoding="utf-8")


def verify_manifest(manifest: Manifest, raw_dir: Path) -> list[ManifestIssue]:
    """Compare every manifest entry with the file on disk; an empty list means all match."""
    issues: list[ManifestIssue] = []
    for entry in manifest.entries:
        file_path = raw_dir / entry.path
        if not file_path.is_file():
            issues.append(
                ManifestIssue(path=entry.path, kind=IssueKind.MISSING, detail="file not found")
            )
            continue
        actual_size = file_path.stat().st_size
        if actual_size != entry.size_bytes:
            issues.append(
                ManifestIssue(
                    path=entry.path,
                    kind=IssueKind.SIZE_MISMATCH,
                    detail=f"expected {entry.size_bytes} bytes, found {actual_size}",
                )
            )
            continue
        actual_hash = sha256_of_file(file_path)
        if actual_hash != entry.sha256:
            issues.append(
                ManifestIssue(
                    path=entry.path,
                    kind=IssueKind.HASH_MISMATCH,
                    detail=f"expected {entry.sha256}, found {actual_hash}",
                )
            )
    return issues


class InputIntegrityError(RuntimeError):
    """Raw files do not match MANIFEST.json."""


def verify_raw_inputs(raw_dir: Path) -> dict[str, str]:
    """Raise unless every raw file matches the manifest; return path -> sha256 for the report."""
    manifest = load_manifest(raw_dir / MANIFEST_FILENAME)
    issues = verify_manifest(manifest, raw_dir)
    if issues:
        details = "; ".join(f"{i.path}: {i.kind} ({i.detail})" for i in issues)
        raise InputIntegrityError(f"raw data does not match {MANIFEST_FILENAME}: {details}")
    return {entry.path: entry.sha256 for entry in manifest.entries}
