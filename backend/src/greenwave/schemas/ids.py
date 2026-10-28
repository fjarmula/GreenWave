"""Identifier types shared by the simulation and ITS contract models."""

from typing import Annotated

from pydantic import Field

SIMULATION_ID_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"
SimulationId = Annotated[str, Field(pattern=SIMULATION_ID_PATTERN)]
MessageId = Annotated[str, Field(pattern=r"^MSG-ITS-[0-9]+$")]
