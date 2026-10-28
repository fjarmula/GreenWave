"""Build simulated ITS dispatch messages. Sending them is the engine's job, not this module's."""

from datetime import datetime, timedelta
from math import ceil

from greenwave.schemas import ItsDispatchEvent, ItsDispatchPayload, VehicleType
from greenwave.simulation.corridor import route_runtimes, time_to_intersection
from greenwave.simulation.route_model import RouteModel
from greenwave.simulation.route_track import RouteTrack
from greenwave.simulation.state import EngineState
from greenwave.simulation_settings import SimulationSettings


def release_seconds(
    route_model: RouteModel,
    track: RouteTrack,
    state: EngineState,
    intersection_id: str,
    settings: SimulationSettings,
) -> float:
    """Seconds until the vehicle can clear ``intersection_id``: the open road to its last stop
    line at each edge's ambulance speed, plus ``D_min`` for every unpassed route intersection up
    to and including it or with its first stop line inside it, plus the extra time a slowdown in
    progress has still to spend.

    A hold shorter than this would expire while the vehicle is still spending the rolling
    slowdowns of the intersections before the target, crossing a multi-line target, or driving
    a slower road than the one it just drove (the smoothed speed is only the recent past).
    Only ER Green Wave dispatches, so the remaining extra time is always a rolling slowdown's;
    one for an unpassed intersection is counted twice, which only lengthens the hold.
    """
    runtimes = list(route_runtimes(route_model, state))
    target = next(item for item, _ in runtimes if item.id == intersection_id)
    junctions = sum(
        1
        for item, runtime in runtimes
        if not runtime.passed
        and (
            item.first_stop_line_m <= target.first_stop_line_m
            or item.first_stop_line_m < target.last_stop_line_m
        )
    )
    return (
        track.open_road_seconds(state.distance_travelled_m, target.last_stop_line_m)
        + settings.min_intersection_delay_seconds * junctions
        + state.cautious_time_remaining_s
    )


def build_dispatch_payload(
    route_model: RouteModel,
    track: RouteTrack,
    state: EngineState,
    intersection_ids: tuple[str, ...],
    now: datetime,
    settings: SimulationSettings,
    vehicle_type: VehicleType,
    playback_speed: int = 1,
) -> ItsDispatchPayload:
    """Hold green until the farthest member can be cleared plus a buffer; arrive at the nearest.

    The arrival is wall-clock: ``playback_speed`` simulated seconds pass per real second.
    """
    tti_by_id = {
        item.id: time_to_intersection(item.first_stop_line_m, runtime, state) or 0.0
        for item, runtime in route_runtimes(route_model, state)
    }
    ttis = [tti_by_id[intersection_id] for intersection_id in intersection_ids]
    return ItsDispatchPayload(
        priority_level=1,
        vehicle_type=vehicle_type,
        intersections_group=list(intersection_ids),
        action="FORCE_GREEN_PHASE",
        hold_duration_sec=max(
            settings.its_min_hold_seconds,
            ceil(
                max(
                    release_seconds(route_model, track, state, intersection_id, settings)
                    for intersection_id in intersection_ids
                )
            )
            + settings.its_hold_buffer_seconds,
        ),
        expected_arrival_utc=now + timedelta(seconds=min(ttis) / playback_speed),
    )


def dispatch_event(
    simulation_id: str, state: EngineState, payload: ItsDispatchPayload, now: datetime
) -> ItsDispatchEvent:
    """The telemetry record of a dispatch; ``state`` already carries this message's sequence."""
    return ItsDispatchEvent(
        schema_version="1.0",
        is_simulated=True,
        event_type="ITS_DISPATCH",
        message_id=f"MSG-ITS-{state.message_sequence}",
        simulation_id=simulation_id,
        tick=state.tick,
        timestamp=now,
        system_source="ER_GREENWAVE_ENGINE",
        target_system="STeR_KRAKOW_ITS",
        payload=payload,
    )
