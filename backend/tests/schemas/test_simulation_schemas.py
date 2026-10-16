import json
import re
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from greenwave.schemas import (
    ErrorResponse,
    ItsDispatchEvent,
    SimulationCancelledEvent,
    SimulationCompletedEvent,
    SimulationStartRequest,
    SimulationStartResponse,
    SimulationStreamEvent,
    SimulationTickEvent,
    StopResponse,
)

ARCHITECTURE = Path(__file__).resolve().parents[3] / "GreenWave_ARCHITECTURE.md"
STREAM_EVENT = SimulationStreamEvent


def architecture_examples() -> list[dict[str, Any]]:
    text = ARCHITECTURE.read_text(encoding="utf-8")
    return [json.loads(block) for block in re.findall(r"```json\n(.*?)\n```", text, re.DOTALL)]


def example(key: str, value: object = None) -> dict[str, Any]:
    for item in architecture_examples():
        if key in item and (value is None or item[key] == value):
            return item
    raise AssertionError(f"no architecture example with {key}={value}")


def start_request() -> dict[str, Any]:
    return example("origin")


def tick() -> dict[str, Any]:
    return example("event_type", "SIMULATION_TICK")


def test_architecture_examples_validate_against_their_models() -> None:
    examples = architecture_examples()
    assert len(examples) == 7  # request, response, error, tick, completed, cancelled, dispatch
    seen: set[type[BaseModel]] = set()
    for item in examples:
        model: type[BaseModel]
        if "origin" in item:
            model = SimulationStartRequest
        elif "route_geometry" in item:
            model = SimulationStartResponse
        elif "error_code" in item:
            model = ErrorResponse
        else:
            event = STREAM_EVENT.model_validate(item).root
            model = type(event)
        model.model_validate(item)
        seen.add(model)
    assert seen == {
        SimulationStartRequest,
        SimulationStartResponse,
        ErrorResponse,
        SimulationTickEvent,
        SimulationCompletedEvent,
        SimulationCancelledEvent,
        ItsDispatchEvent,
    }


def test_architecture_examples_round_trip_without_losing_fields() -> None:
    for item in architecture_examples():
        model = (
            SimulationStartRequest
            if "origin" in item
            else SimulationStartResponse
            if "route_geometry" in item
            else ErrorResponse
            if "error_code" in item
            else None
        )
        parsed = model.model_validate(item) if model else STREAM_EVENT.model_validate(item).root
        dumped = parsed.model_dump(mode="json")
        for key, value in item.items():
            if key == "playback_speed":
                continue
            assert dumped[key] == value, key


@pytest.mark.parametrize(("value", "ok"), [(0.99, False), (1.0, True), (3.0, True), (3.01, False)])
def test_traffic_density_multiplier_bounds(value: float, ok: bool) -> None:
    body = {**start_request(), "traffic_density_multiplier": value}
    if ok:
        SimulationStartRequest.model_validate(body)
    else:
        with pytest.raises(ValidationError):
            SimulationStartRequest.model_validate(body)


@pytest.mark.parametrize(("value", "ok"), [(0, False), (1, True), (10, True), (11, False)])
def test_playback_speed_bounds(value: int, ok: bool) -> None:
    body = {**start_request(), "playback_speed": value}
    if ok:
        assert SimulationStartRequest.model_validate(body).playback_speed == value
    else:
        with pytest.raises(ValidationError):
            SimulationStartRequest.model_validate(body)


def test_playback_speed_defaults_to_one_when_absent() -> None:
    body = {k: v for k, v in start_request().items() if k != "playback_speed"}
    assert SimulationStartRequest.model_validate(body).playback_speed == 1


@pytest.mark.parametrize(
    ("simulation_id", "ok"),
    [("SIM-20261025-01", True), ("a" * 64, True), ("a" * 65, False), ("", False), ("a b", False)],
)
def test_simulation_id_pattern(simulation_id: str, ok: bool) -> None:
    body = {**start_request(), "simulation_id": simulation_id}
    if ok:
        SimulationStartRequest.model_validate(body)
    else:
        with pytest.raises(ValidationError):
            SimulationStartRequest.model_validate(body)


def test_a_fifth_state_is_rejected() -> None:
    for state in ("NORMAL", "CLEARING", "PRIORITY_GREEN", "RECOVERY"):
        body = tick()
        body["intersections"][0]["state"] = state
        SimulationTickEvent.model_validate(body)
    body = tick()
    body["intersections"][0]["state"] = "CLEARING_CASCADE"
    with pytest.raises(ValidationError):
        SimulationTickEvent.model_validate(body)


def test_unknown_ambulance_status_is_rejected() -> None:
    body = tick()
    body["ambulance"]["status"] = "PARKED"
    with pytest.raises(ValidationError):
        SimulationTickEvent.model_validate(body)


def test_tti_may_be_null_and_name_may_be_null() -> None:
    body = tick()
    body["intersections"][0]["tti_seconds"] = None
    body["intersections"][0]["name"] = None
    event = SimulationTickEvent.model_validate(body)
    assert event.intersections[0].tti_seconds is None
    assert event.intersections[0].name is None


def test_tti_must_be_an_integer() -> None:
    body = tick()
    body["intersections"][0]["tti_seconds"] = 28.5
    with pytest.raises(ValidationError):
        SimulationTickEvent.model_validate(body)


@pytest.mark.parametrize(
    "item",
    [
        example("route_geometry"),
        tick(),
        example("event_type", "ITS_DISPATCH"),
        example("event_type", "SIMULATION_COMPLETED"),
        example("event_type", "SIMULATION_CANCELLED"),
        example("error_code"),
    ],
)
def test_envelope_fields_are_literals(item: dict[str, Any]) -> None:
    model: type[BaseModel] = (
        SimulationStartResponse
        if "route_geometry" in item
        else ErrorResponse
        if "error_code" in item
        else STREAM_EVENT
    )
    model.model_validate(item)
    with pytest.raises(ValidationError):
        model.model_validate({**item, "schema_version": "2.0"})
    if "error_code" not in item:
        with pytest.raises(ValidationError):
            model.model_validate({**item, "is_simulated": False})


@pytest.mark.parametrize(("hold", "ok"), [(39, False), (40, True), (55, True)])
def test_hold_duration_has_a_floor_of_forty(hold: int, ok: bool) -> None:
    body = example("event_type", "ITS_DISPATCH")
    body["payload"]["hold_duration_sec"] = hold
    if ok:
        ItsDispatchEvent.model_validate(body)
    else:
        with pytest.raises(ValidationError):
            ItsDispatchEvent.model_validate(body)


def test_the_dispatch_example_shows_a_hold_above_forty_for_a_cascaded_group() -> None:
    event = ItsDispatchEvent.model_validate(example("event_type", "ITS_DISPATCH"))
    assert len(event.payload.intersections_group) == 2
    assert event.payload.hold_duration_sec > 40


@pytest.mark.parametrize(
    ("item", "expected"),
    [
        (tick(), SimulationTickEvent),
        (example("event_type", "ITS_DISPATCH"), ItsDispatchEvent),
        (example("event_type", "SIMULATION_COMPLETED"), SimulationCompletedEvent),
        (example("event_type", "SIMULATION_CANCELLED"), SimulationCancelledEvent),
    ],
)
def test_the_union_dispatches_on_event_type(
    item: dict[str, Any], expected: type[BaseModel]
) -> None:
    assert type(STREAM_EVENT.model_validate(item).root) is expected


def test_an_unknown_event_type_is_rejected() -> None:
    with pytest.raises(ValidationError):
        STREAM_EVENT.model_validate({**tick(), "event_type": "SOMETHING_ELSE"})


@pytest.mark.parametrize("reason", ["STOPPED", "SUPERSEDED"])
def test_cancel_reasons(reason: str) -> None:
    body = {**example("event_type", "SIMULATION_CANCELLED"), "reason": reason}
    assert SimulationCancelledEvent.model_validate(body).reason == reason
    with pytest.raises(ValidationError):
        SimulationCancelledEvent.model_validate({**body, "reason": "CRASHED"})


@pytest.mark.parametrize(
    "code",
    [
        "ORIGIN_OFF_NETWORK",
        "DESTINATION_OFF_NETWORK",
        "NO_ROUTE",
        "SIMULATION_ID_IN_USE",
        "SIMULATION_NOT_FOUND",
    ],
)
def test_error_codes(code: str) -> None:
    ErrorResponse.model_validate({"schema_version": "1.0", "error_code": code, "message": "x"})
    with pytest.raises(ValidationError):
        ErrorResponse.model_validate(
            {"schema_version": "1.0", "error_code": "OOPS", "message": "x"}
        )


def test_stop_response() -> None:
    body = {
        "schema_version": "1.0",
        "is_simulated": True,
        "simulation_id": "SIM-1",
        "status": "STOPPED",
    }
    assert StopResponse.model_validate(body).status == "STOPPED"


def test_position_bounds() -> None:
    body = start_request()
    body["origin"]["lat"] = 91
    with pytest.raises(ValidationError):
        SimulationStartRequest.model_validate(body)
