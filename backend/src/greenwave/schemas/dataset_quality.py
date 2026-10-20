"""Data quality summary: written by the ETL step ``quality`` and served unchanged by the API.

It summarises diagnostics of the source data; it does not verify physical signal states.
"""

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field

from greenwave.schemas.simulation import SchemaVersion


class QualityStatus(StrEnum):
    PASS = "pass"
    INFO = "info"
    WARN = "warn"


class QualityCheck(BaseModel):
    id: str
    title: str
    status: QualityStatus
    headline: str
    metrics: dict[str, float]
    samples: list[str] = Field(max_length=5)


class QualitySource(BaseModel):
    path: str
    source: str
    licence: str
    attribution: str
    retrieved_on: str


class DatasetQualityResponse(BaseModel):
    schema_version: SchemaVersion
    is_simulated: Literal[True]
    manifest_sha256: str
    msip_export_timestamp: str | None
    checks: list[QualityCheck]
    sources: list[QualitySource]
