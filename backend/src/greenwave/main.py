from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from pydantic_settings import BaseSettings, SettingsConfigDict

from greenwave.api.dataset import router as dataset_router
from greenwave.api.dispatch import router as dispatch_router
from greenwave.api.simulation import router as simulation_router
from greenwave.dataset import DatasetSettings, ProcessedDataset, load_dataset
from greenwave.its import MockItsGateway
from greenwave.places.address_index import AddressIndex
from greenwave.routing.network_index import build_routing_index
from greenwave.routing.station_ranking import build_station_nodes
from greenwave.schemas import HealthResponse
from greenwave.simulation.session import SessionManager
from greenwave.simulation_settings import SimulationSettings


class CorsSettings(BaseSettings):
    """Browser origins permitted to consume the local simulation API."""

    model_config = SettingsConfigDict(env_prefix="GREENWAVE_", frozen=True)

    cors_origins: str = "http://localhost:3000"

    @property
    def origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


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
        simulation_settings = SimulationSettings()
        app.state.routing_index = build_routing_index(app.state.dataset, simulation_settings)
        app.state.simulation_settings = simulation_settings
        app.state.address_index = AddressIndex.from_frame(app.state.dataset.addresses)
        app.state.station_nodes = build_station_nodes(
            app.state.dataset.stations, app.state.routing_index
        )
        app.state.session_manager = SessionManager(
            app.state.routing_index, simulation_settings, MockItsGateway()
        )
        try:
            yield
        finally:
            await app.state.session_manager.shutdown()

    app = FastAPI(title="ER-GreenWave", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CorsSettings().origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    @app.get("/api/v1/health", response_model=HealthResponse, tags=["system"])
    async def health() -> HealthResponse:
        return HealthResponse(status="ok")

    app.include_router(simulation_router)
    app.include_router(dataset_router)
    app.include_router(dispatch_router)

    def custom_openapi() -> dict[str, object]:
        """Keep the frozen SSE media-type declaration while using StreamingResponse at runtime."""
        if app.openapi_schema is None:
            document = get_openapi(title=app.title, version=app.version, routes=app.routes)
            stream = document["paths"]["/api/v1/simulation/{simulation_id}/stream"]["get"]
            stream["responses"]["200"]["content"].pop("application/json", None)
            app.openapi_schema = document
        return app.openapi_schema

    app.openapi = custom_openapi  # type: ignore[method-assign]

    return app


app = create_app()
