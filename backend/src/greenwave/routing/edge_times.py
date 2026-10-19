"""The one place that turns a route edge into travel seconds (GreenWave_ARCHITECTURE.md §3).

Route choice, both estimates and simulated motion all use these functions, so the estimate and the
simulated run apply the same road-attribute factors. With neutral settings they reduce to
``L·μ/V`` (normal) and ``L/V_amb`` (ambulance).
"""

from greenwave.routing.network_index import EdgeView
from greenwave.simulation_settings import SimulationSettings


def ambulance_speed_kmh(
    speed_kmh: float, settings: SimulationSettings, boost: float = 1.0
) -> float:
    """Bounded emergency-vehicle speed; the boost applies before the min/max clamp."""
    return min(
        max(
            settings.ambulance_speed_factor * speed_kmh * boost,
            settings.ambulance_min_speed_kmh,
        ),
        settings.ambulance_max_speed_kmh,
    )


def ambulance_boost(edge: EdgeView, settings: SimulationSettings) -> float:
    """The largest applicable speed boost (bus lane, tram track), 1.0 when none applies."""
    boosts = [1.0]
    if edge.bus_lane:
        boosts.append(settings.ambulance_bus_lane_factor)
    if edge.tram_track:
        boosts.append(settings.ambulance_tram_track_factor)
    return max(boosts)


def ambulance_edge_seconds(edge: EdgeView, settings: SimulationSettings) -> float:
    speed = ambulance_speed_kmh(edge.speed_kmh, settings, ambulance_boost(edge, settings))
    return edge.length_m / (speed / 3.6) + edge.calming_count * settings.ambulance_calming_seconds


def normal_edge_seconds(edge: EdgeView, multiplier: float, settings: SimulationSettings) -> float:
    lane = settings.normal_single_lane_factor if edge.lanes_per_direction == 1 else 1.0
    surface = settings.normal_unpaved_factor if edge.surface_class == "unpaved" else 1.0
    return (
        edge.length_m * multiplier * lane * surface / (edge.speed_kmh / 3.6)
        + edge.calming_count * settings.normal_calming_seconds
    )


def ambulance_effective_speed_mps(edge: EdgeView, settings: SimulationSettings) -> float:
    """Constant speed covering the edge in ``ambulance_edge_seconds`` (calming spread over it).

    A zero-length edge has no distance to spread time over: it moves at the boosted speed.
    """
    if edge.length_m <= 0:
        return ambulance_speed_kmh(edge.speed_kmh, settings, ambulance_boost(edge, settings)) / 3.6
    return edge.length_m / ambulance_edge_seconds(edge, settings)
