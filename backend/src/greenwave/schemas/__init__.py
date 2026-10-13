"""Pydantic models: the canonical definition of every REST and telemetry payload.

Frontend types in ``frontend/src/types/`` are generated from these models
(see ``scripts/export_openapi.py``); never edit the generated file by hand.
"""

from greenwave.schemas.health import HealthResponse

__all__ = ["HealthResponse"]
