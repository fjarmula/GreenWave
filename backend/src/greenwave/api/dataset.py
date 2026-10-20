"""Dataset endpoints: read-only views of the processed data loaded at startup."""

from typing import cast

from fastapi import APIRouter, Request

from greenwave.dataset import ProcessedDataset
from greenwave.schemas import DatasetQualityResponse

router = APIRouter(prefix="/api/v1/dataset", tags=["dataset"])


@router.get("/quality", response_model=DatasetQualityResponse)
async def get_dataset_quality(request: Request) -> DatasetQualityResponse:
    """The ``data_quality.json`` summary loaded at startup, unchanged (no recomputation)."""
    return cast(ProcessedDataset, request.app.state.dataset).quality
