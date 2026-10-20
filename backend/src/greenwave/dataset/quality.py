"""Load ``data_quality.json``: required, hash-checked against what the quality step read and
wrote (as the neighbours step is), and parsed as the API response it is served as."""

from pathlib import Path

from pydantic import ValidationError

from greenwave.artifacts import QUALITY_FILENAME, REPORT_FILENAME
from greenwave.dataset.artifact_io import read_json
from greenwave.dataset.constants import QUALITY_COMMAND
from greenwave.dataset.errors import (
    ArtifactHashMismatchError,
    MalformedArtifactError,
    ManifestMismatchError,
)
from greenwave.dataset.models import QualitySection
from greenwave.etl.manifest import sha256_of_file
from greenwave.schemas.dataset_quality import DatasetQualityResponse


def _section(report: dict[str, object]) -> QualitySection:
    where = f"{REPORT_FILENAME} section 'quality'"
    if "quality" not in report:
        raise MalformedArtifactError(
            f"{REPORT_FILENAME} has no section 'quality'; re-run {QUALITY_COMMAND}"
        )
    try:
        return QualitySection.model_validate(report["quality"])
    except ValidationError as error:
        raise MalformedArtifactError(
            f"{where} is missing a required key or has a wrong type ({error}); re-run "
            f"{QUALITY_COMMAND}"
        ) from error


def _check_hashes(processed_dir: Path, section: QualitySection) -> None:
    recorded = section.artifact_sha256.get(QUALITY_FILENAME)
    on_disk = sha256_of_file(processed_dir / QUALITY_FILENAME)
    if on_disk != recorded:
        raise ArtifactHashMismatchError(
            f"{processed_dir / QUALITY_FILENAME} has sha256 {on_disk[:12]}..., but "
            f"{REPORT_FILENAME} recorded {str(recorded)[:12]}... when the step wrote it; "
            f"re-run {QUALITY_COMMAND}"
        )
    changed = [
        name
        for name, consumed in sorted(section.consumed_sha256.items())
        if not (processed_dir / name).is_file() or sha256_of_file(processed_dir / name) != consumed
    ]
    if changed:
        raise ArtifactHashMismatchError(
            f"{QUALITY_FILENAME} was built from other versions of {', '.join(changed)} than the "
            f"ones in {processed_dir} now (the summary is stale); re-run {QUALITY_COMMAND}"
        )


def load_quality(
    processed_dir: Path, report: dict[str, object], manifest_sha256: str
) -> DatasetQualityResponse:
    section = _section(report)
    _check_hashes(processed_dir, section)
    try:
        quality = DatasetQualityResponse.model_validate(read_json(processed_dir / QUALITY_FILENAME))
    except ValidationError as error:
        raise MalformedArtifactError(
            f"{processed_dir / QUALITY_FILENAME} is not a valid quality summary ({error}); "
            f"re-run {QUALITY_COMMAND}"
        ) from error
    stale = [
        where
        for where, recorded in (
            (f"{REPORT_FILENAME} section 'quality'", section.manifest_sha256),
            (QUALITY_FILENAME, quality.manifest_sha256),
        )
        if recorded != manifest_sha256
    ]
    if stale:
        raise ManifestMismatchError(
            f"the manifest has sha256 {manifest_sha256[:12]}..., but these were built from a "
            f"different manifest: {', '.join(stale)}; re-run {QUALITY_COMMAND}"
        )
    return quality
