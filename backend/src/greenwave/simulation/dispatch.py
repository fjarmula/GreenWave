"""Build simulated ITS dispatch messages. Sending them is the engine's job, not this module's."""

from datetime import datetime, timedelta
from math import ceil

from greenwave.schemas import ItsDispatchEvent, ItsDispatchPayload
from greenwave.simulation.corridor import route_runtimes, time_to_intersection
from greenwave.simulation.route_model import RouteModel
from greenwave.simulation.state import EngineState
from greenwave.simulation_settings import SimulationSettings


def build_dispatch_payload(
    route_model: RouteModel,
    state: EngineState,
    intersection_ids: tuple[str, ...],
    now: datetime,
    settings: SimulationSettings,
) -> ItsDispatchPayload:
    """Hold green until the farthest member is reached plus a buffer; arrive at the nearest."""
    tti_by_id = {
        item.id: time_to_intersection(item.first_stop_line_m, runtime, state) or 0.0
        for item, runtime in route_runtimes(route_model, state)
    }
    ttis = [tti_by_id[intersection_id] for intersection_id in intersection_ids]
    return ItsDispatchPayload(
        priority_level=1,
        vehicle_type="AMBULANCE",
        intersections_group=list(intersection_ids),
        action="FORCE_GREEN_PHASE",
        hold_duration_sec=max(
            settings.its_min_hold_seconds, ceil(max(ttis)) + settings.its_hold_buffer_seconds
        ),
        expected_arrival_utc=now + timedelta(seconds=min(ttis)),
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
