import { request, route, tick } from "./comparison/fixtures.test-support";

import { describe, it, expect } from "vitest";
import { parseStreamEvent } from "@/lib/transport/validate";
import { initialSimulationState, simulationReducer } from "@/lib/simulation-state";
const feedback = {
  schema_version: "1.0",
  is_simulated: true,
  event_type: "ITS_FEEDBACK",
  simulation_id: "s",
  tick: 4,
  timestamp: "2026-10-23T00:00:00Z",
  request_message_id: "MSG-ITS-1",
  feedback_sequence: 1,
  status: "ACCEPTED",
  intersections_group: ["I"],
  observed_at_simulated_sec: 4,
  reason: null,
};
describe("ITS feedback boundary", () => {
  it("validates feedback independently of telemetry tick", () => {
    expect(parseStreamEvent(feedback, "s")).toEqual(feedback);
    for (const change of [
      { feedback_sequence: 0 },
      { reason: "ACK_TIMEOUT" },
      { status: "REQUESTED" },
      { observed_at_simulated_sec: -1 },
      { simulation_id: "wrong" },
    ])
      expect(parseStreamEvent({ ...feedback, ...change }, "s")).toBeNull();
  });
});

it("snapshot reconciliation defeats delayed feedback and same-tick feedback updates request state", () => {
  const req = { ...request, simulation_id: "s" };
  let state = simulationReducer(initialSimulationState, { type: "START_REQUESTED", request: req });
  state = simulationReducer(state, {
    type: "START_SUCCEEDED",
    simulationId: "s",
    response: { ...route("s"), intersections_on_route: ["I"] },
  });
  const pending = {
    message_id: "MSG-ITS-1",
    intersections_group: ["I"],
    status: "REQUESTED" as const,
    submitted_at_simulated_sec: 3,
    acknowledged_at_simulated_sec: null,
    last_updated_at_simulated_sec: 3,
    last_feedback_sequence: 0,
    reason: null,
  };
  state = simulationReducer(state, {
    type: "TICK",
    event: { ...tick(4, "s"), its_requests: [pending] },
  });
  const accepted = parseStreamEvent(feedback, "s");
  if (!accepted || accepted.event_type !== "ITS_FEEDBACK") throw new Error("fixture");
  state = simulationReducer(state, { type: "ITS_FEEDBACK", event: accepted });
  expect(state.itsRequests[0].status).toBe("ACCEPTED");
  const snapshot = {
    ...state.itsRequests[0],
    status: "RELEASED" as const,
    last_feedback_sequence: 3,
    last_updated_at_simulated_sec: 6,
  };
  state = simulationReducer(state, {
    type: "TICK",
    event: { ...tick(6, "s"), its_requests: [snapshot] },
  });
  const previous = state;
  state = simulationReducer(state, {
    type: "ITS_FEEDBACK",
    event: { ...accepted, feedback_sequence: 2 },
  });
  expect(state).toBe(previous);
});
