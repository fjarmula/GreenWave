"""Startup errors of the processed-data loader. Every message names the file and the fix."""


class DatasetError(RuntimeError):
    """The processed data cannot be used. The server must not start with it."""


class MissingArtifactError(DatasetError):
    """A required file does not exist."""


class MalformedArtifactError(DatasetError):
    """A file is unreadable, or lacks a required column, key or report section."""


class ManifestMismatchError(DatasetError):
    """Artifacts were built from a different MANIFEST.json than the one committed now."""


class ReferentialIntegrityError(DatasetError):
    """Artifacts reference ids that do not exist in each other (mixed runs)."""


class CountMismatchError(DatasetError):
    """A row count differs from the count recorded in etl_report.json."""
