from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from greenwave.dataset import DatasetSettings, ProcessedDataset, load_dataset
from greenwave.schemas import HealthResponse


def create_app(
    *,
    dataset: ProcessedDataset | None = None,
    processed_dir: Path | None = None,
    manifest_path: Path | None = None,
) -> FastAPI:
    """Build the app. Nothing is loaded here; the lifespan loads the data once at startup.

    Tests inject a ``dataset`` (nothing is read) or point ``processed_dir`` / ``manifest_path`` at
    a directory. Without either, the paths come from ``DatasetSettings``. A failed load stops the
    startup: there is no fallback.
    """
    if dataset is not None and (processed_dir is not None or manifest_path is not None):
        raise ValueError("pass either dataset or processed_dir/manifest_path, not both")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if dataset is not None:
            app.state.dataset = dataset
        else:
            settings = DatasetSettings()
            app.state.dataset = load_dataset(
                processed_dir or settings.processed_dir,
                manifest_path or settings.raw_manifest_path,
            )
        yield

    app = FastAPI(title="ER-GreenWave", version="0.1.0", lifespan=lifespan)

    @app.get("/api/v1/health", response_model=HealthResponse, tags=["system"])
    async def health() -> HealthResponse:
        return HealthResponse(status="ok")

    return app


app = create_app()
