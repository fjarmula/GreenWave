from fastapi import FastAPI

from greenwave.schemas import HealthResponse


def create_app() -> FastAPI:
    app = FastAPI(title="ER-GreenWave", version="0.1.0")

    @app.get("/api/v1/health", response_model=HealthResponse, tags=["system"])
    async def health() -> HealthResponse:
        return HealthResponse(status="ok")

    return app


app = create_app()
