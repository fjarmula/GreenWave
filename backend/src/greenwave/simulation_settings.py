"""Validated, environment-configurable simulation tuning values."""

from typing import Self

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class SimulationSettings(BaseSettings):
    """All simulation tunables, loaded from ``GREENWAVE_SIM_`` environment variables."""

    model_config = SettingsConfigDict(env_prefix="GREENWAVE_SIM_", frozen=True)

    clearing_tti_seconds: float = Field(default=40, ge=0)
    priority_green_tti_seconds: float = Field(default=25, ge=0)
    recovery_hold_seconds: float = Field(default=15, ge=0)
    min_intersection_delay_seconds: float = Field(default=3, ge=0)
    # APPROVED 2026-10-23 (human): ER Green Wave spends D_min as a rolling slowdown over this
    # approach to each intersection's first stop line instead of a stop (simulation/motion.py).
    greenwave_approach_distance_m: float = Field(default=60, gt=0, allow_inf_nan=False)
    # APPROVED 2026-10-23 (human): the slowdown never drops below this; any D_min it cannot absorb
    # before the line is spent past it at this speed, so the vehicle never stops for D_min.
    greenwave_min_rolling_speed_kmh: float = Field(default=15, gt=0, allow_inf_nan=False)
    ambulance_speed_factor: float = Field(default=1.3, gt=0)
    ambulance_min_speed_kmh: float = Field(default=30, ge=0)
    ambulance_max_speed_kmh: float = Field(default=90, gt=0)
    speed_ema_alpha: float = Field(default=0.25, gt=0, le=1)
    speed_floor_meters_per_second: float = Field(default=5, ge=0)
    its_min_hold_seconds: int = Field(default=40, ge=0)
    its_hold_buffer_seconds: int = Field(default=5, ge=0)
    tick_interval_seconds: float = Field(default=1, gt=0)
    max_snap_distance_meters: float = Field(default=150, ge=0)
    max_playback_speed: int = Field(default=10, ge=1)
    # Stations given the full green-wave estimate after the reversed-Dijkstra shortlist.
    dispatch_shortlist_size: int = Field(default=5, ge=1)
    subscriber_queue_size: int = Field(default=32, ge=1)
    # Sessions kept for streaming and stop: the active run plus the most recent ended ones (D3).
    retained_session_limit: int = Field(default=4, ge=1)
    # Road-attribute time factors (routing/edge_times.py; ADR 0005). Neutral is 1.0 / 0.0.
    # APPROVED 2026-10-19 (human): one lane per direction cannot pass stopped/turning vehicles.
    normal_single_lane_factor: float = Field(default=1.15, ge=1.0)
    # APPROVED 2026-10-19 (human): unpaved roads are driven well below their speed.
    normal_unpaved_factor: float = Field(default=1.3, ge=1.0)
    # APPROVED 2026-10-19 (human): slowing to ~15-20 km/h and back costs a car ~2-4 s per feature.
    normal_calming_seconds: float = Field(default=3.0, ge=0)
    # APPROVED 2026-10-19 (human): ambulances slow for the patient; cushions let them straddle.
    ambulance_calming_seconds: float = Field(default=2.0, ge=0)
    # APPROVED 2026-10-19 (human): small gain; 1.10 already moved 3 of 9 demo routes onto routes
    # with more signals, 1.05 moved none.
    ambulance_bus_lane_factor: float = Field(default=1.05, ge=1.0)
    # APPROVED 2026-10-19 (human): small gain; the match includes reserved track with kerbs/islands.
    ambulance_tram_track_factor: float = Field(default=1.05, ge=1.0)
    # Simulated signal programme for the map's phase detail (simulation/phases.py). PoC modelling
    # assumptions, not Kraków signal timings: two movement groups, each green then yellow then
    # all-red.
    signal_green_seconds: float = Field(default=30, gt=0)
    signal_yellow_seconds: float = Field(default=3, ge=0)
    signal_all_red_seconds: float = Field(default=2, ge=0)
    # Standard-traffic crossing when ER Green Wave is disabled (simulation/motion.py). PoC
    # modelling assumptions: facing a simulated red or yellow route movement at its first stop
    # line, the vehicle rolls this far at no more than the road's ordinary speed limit, spreading
    # an extra factor x the intersection's normal delay x traffic density over it (cautious
    # red-light entry, life-corridor forming). Not measured Kraków geometry.
    standard_clearance_factor: float = Field(default=1.0, ge=0, allow_inf_nan=False)
    standard_crossing_distance_m: float = Field(default=30, gt=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def priority_precedes_clearing(self) -> Self:
        """The priority threshold must be reached within the clearing window."""
        if self.priority_green_tti_seconds > self.clearing_tti_seconds:
            raise ValueError("priority_green_tti_seconds must not exceed clearing_tti_seconds")
        if self.ambulance_min_speed_kmh > self.ambulance_max_speed_kmh:
            raise ValueError("ambulance_min_speed_kmh must not exceed ambulance_max_speed_kmh")
        return self
