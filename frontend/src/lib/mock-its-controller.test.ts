import { describe, it, expect } from "vitest";
import {
  createMockSession,
  advanceMockSession,
  mockFallbackIds,
  type MockSession,
} from "./mock-session";
import { request } from "./comparison/fixtures.test-support";
import type { ItsDispatchEvent } from "@/types/telemetry";

function submitGroup(session: MockSession, messageId: string): void {
  const event: ItsDispatchEvent = {
    schema_version: "1.0",
    is_simulated: true,
    event_type: "ITS_DISPATCH",
    system_source: "ER_GREENWAVE_ENGINE",
    target_system: "STeR_KRAKOW_ITS",
    simulation_id: request.simulation_id,
    message_id: messageId,
    tick: 10,
    timestamp: "2026-10-29T12:00:00Z",
    payload: {
      priority_level: 1,
      vehicle_type: "AMBULANCE",
      intersections_group: session.route.intersections_on_route,
      action: "FORCE_GREEN_PHASE",
      hold_duration_sec: 40,
      expected_arrival_utc: "2026-10-29T12:00:20Z",
    },
  };
  session.controller.submit(event, 10);
}

it("mock dispatch stays pending until a later controller advance", () => {
  const session = createMockSession({ ...request, its_scenario: "DELAYED" });
  let result = advanceMockSession(session);
  for (let n = 0; !result.dispatch && n < 100; n++) result = advanceMockSession(session);
  expect(result.dispatch).not.toBeNull();
  expect(result.tick.its_requests[0].status).toBe("REQUESTED");
  expect(
    result.tick.intersections
      .filter((i) => result.dispatch?.payload.intersections_group.includes(i.id))
      .every((i) => i.state === "NORMAL"),
  ).toBe(true);
  const submitted = result.tick.tick;
  for (let n = 1; n <= 5; n++) result = advanceMockSession(session);
  expect(result.feedbacks.some((f) => f.status === "ACCEPTED")).toBe(true);
  expect(result.tick.its_requests[0].acknowledged_at_simulated_sec).toBe(submitted + 5);
});

function runToEnd(session: MockSession) {
  const ticks = [];
  const feedbacks = [];
  let result = advanceMockSession(session);
  for (let n = 0; !result.completed && n < 2000; n++) {
    ticks.push(result.tick);
    feedbacks.push(...result.feedbacks);
    result = advanceMockSession(session);
  }
  ticks.push(result.tick);
  feedbacks.push(...result.feedbacks);
  expect(result.completed).toBe(true);
  return { ticks, feedbacks };
}

it.each([
  ["REJECTED", "REJECTED", "CONTROLLER_REJECTED"],
  ["NO_FEEDBACK", "TIMED_OUT", "ACK_TIMEOUT"],
] as const)("mock %s falls back per junction and still arrives", (scenario, status, reason) => {
  const session = createMockSession({ ...request, its_scenario: scenario });
  const { ticks, feedbacks } = runToEnd(session);
  expect(feedbacks.map((f) => [f.status, f.reason])).toEqual([[status, reason]]);
  const last = ticks[ticks.length - 1];
  expect(last.intersections.map((i) => i.crossing_strategy)).toEqual([
    "STANDARD_FALLBACK",
    "STANDARD_FALLBACK",
  ]);
  expect(mockFallbackIds(session)).toEqual(session.route.intersections_on_route);
  // A failed target never held priority, so it never clears or recovers.
  expect(ticks.every((t) => t.intersections.every((i) => i.state === "NORMAL"))).toBe(true);
  expect(last.its_requests[0].status).toBe(status);
});

it("mock MIXED draws per request and keeps priority downstream of a failure", () => {
  // Seed 0: INT-9001 NO_RESPONSE, INT-9002 ACCEPT_DELAYED (the backend's draw, its-outcome.test).
  const session = createMockSession({
    ...request,
    enable_cascade_mode: false,
    its_scenario: "MIXED",
    its_outcome_seed: 0,
  });
  const { ticks, feedbacks } = runToEnd(session);
  const outcome = Object.fromEntries(
    feedbacks
      .filter((f) => f.status !== "RELEASED")
      .map((f) => [f.intersections_group.join(","), f.status]),
  );
  expect(outcome).toEqual({ "INT-9001": "TIMED_OUT", "INT-9002": "ACCEPTED" });
  expect(mockFallbackIds(session)).toEqual(["INT-9001"]);
  const last = ticks[ticks.length - 1];
  expect(last.intersections.map((i) => i.crossing_strategy)).toEqual([
    "STANDARD_FALLBACK",
    "PRIORITY",
  ]);
  expect(ticks.some((t) => t.intersections[1].state === "CLEARING")).toBe(true);
});

it("mock fallback time counts in travel time and the saving", () => {
  const nominal = runToEnd(createMockSession({ ...request, its_scenario: "NOMINAL" }));
  const rejected = runToEnd(createMockSession({ ...request, its_scenario: "REJECTED" }));
  const finalOf = (run: typeof nominal) => run.ticks[run.ticks.length - 1].kpi_metrics;
  expect(finalOf(rejected).total_time_elapsed_sec).toBeGreaterThan(
    finalOf(nominal).total_time_elapsed_sec,
  );
  expect(finalOf(rejected).current_time_saved_sec).toBe(
    finalOf(nominal).current_time_saved_sec +
      finalOf(nominal).total_time_elapsed_sec -
      finalOf(rejected).total_time_elapsed_sec,
  );
});

it("releases a passed pending request without inventing recovery or later priority", () => {
  const session = createMockSession({ ...request, its_scenario: "DELAYED" });
  submitGroup(session, "pending");
  const feedback = session.controller.advance(11, [0, 0], [true, true], "2026-10-29T12:00:01Z");
  expect(feedback.map((f) => f.status)).toEqual(["RELEASED"]);
  expect(session.controller.signals.every((signal) => signal.state === "NORMAL")).toBe(true);
  expect(
    session.controller.signals.every((signal) => signal.recoveryStartedAtSeconds === null),
  ).toBe(true);
  expect(session.controller.advance(15, [0, 0], [true, true], "2026-10-29T12:00:05Z")).toEqual([]);
  expect(session.controller.signals.every((signal) => signal.state === "NORMAL")).toBe(true);
});

it("keeps a passed pending target ordinary when the rest of its group is accepted", () => {
  const session = createMockSession({ ...request, its_scenario: "DELAYED" });
  submitGroup(session, "partial");
  session.controller.advance(11, [0, 20], [true, false], "2026-10-29T12:00:01Z");
  expect(session.controller.signals[0].state).toBe("NORMAL");
  const feedback = session.controller.advance(15, [0, 15], [true, false], "2026-10-29T12:00:05Z");
  expect(feedback.map((f) => f.status)).toEqual(["ACCEPTED"]);
  expect(session.controller.signals[0].state).toBe("NORMAL");
  expect(["CLEARING", "PRIORITY_GREEN"]).toContain(session.controller.signals[1].state);
});

describe.each([1, 10] as const)("response timing at %s× playback", (playbackSpeed) => {
  it.each([
    ["NOMINAL", 1, "ACCEPTED", null],
    ["DELAYED", 5, "ACCEPTED", null],
    ["REJECTED", 1, "REJECTED", "CONTROLLER_REJECTED"],
    ["NO_FEEDBACK", 8, "TIMED_OUT", "ACK_TIMEOUT"],
  ] as const)(
    "%s responds %i simulated seconds after dispatch",
    (scenario, delay, status, reason) => {
      const session = createMockSession({
        ...request,
        its_scenario: scenario,
        playback_speed: playbackSpeed,
      });
      let result = advanceMockSession(session);
      for (let n = 0; !result.dispatch && n < 200; n++) result = advanceMockSession(session);
      expect(result.dispatch).not.toBeNull();
      const messageId = result.dispatch!.message_id;
      const submittedAt = result.tick.tick;
      expect(result.tick.its_requests.find((r) => r.message_id === messageId)?.status).toBe(
        "REQUESTED",
      );
      for (let elapsed = 1; elapsed <= delay; elapsed++) {
        result = advanceMockSession(session);
        const feedback = result.feedbacks.filter((f) => f.request_message_id === messageId);
        if (elapsed < delay) expect(feedback).toEqual([]);
        else {
          expect(feedback.map((f) => f.status)).toEqual([status]);
          expect(feedback[0].observed_at_simulated_sec).toBe(submittedAt + delay);
          expect(feedback[0].reason).toBe(reason);
          expect(result.completed).toBe(false);
        }
      }
    },
  );
});

it("recovers a previously accepted target for 15 seconds after passage", () => {
  const session = createMockSession({ ...request, its_scenario: "NOMINAL" });
  submitGroup(session, "accepted");
  session.controller.advance(11, [20, 20], [false, false], "2026-10-29T12:00:01Z");
  session.controller.advance(12, [0, 0], [true, true], "2026-10-29T12:00:02Z");
  expect(session.controller.signals.every((signal) => signal.state === "RECOVERY")).toBe(true);
  session.controller.advance(26, [0, 0], [true, true], "2026-10-29T12:00:16Z");
  expect(session.controller.signals.every((signal) => signal.state === "RECOVERY")).toBe(true);
  session.controller.advance(27, [0, 0], [true, true], "2026-10-29T12:00:17Z");
  expect(session.controller.signals.every((signal) => signal.state === "NORMAL")).toBe(true);
});

it("counts seconds held at a red priority line in travel time", () => {
  const free = runToEnd(createMockSession({ ...request, enable_cascade_mode: false }));
  const session = createMockSession({ ...request, enable_cascade_mode: false });
  const advance = session.controller.advance.bind(session.controller);
  let [stuckTicks, lastDrive] = [0, 0];
  // The route light stays red until the vehicle has waited at a line for 3 ticks (within the hold).
  session.controller.advance = (...args) => {
    const feedback = advance(...args);
    if (session.driveSeconds - lastDrive < 1) stuckTicks += 1;
    lastDrive = session.driveSeconds;
    if (stuckTicks < 3)
      session.controller.phases = session.controller.phases.map((p) =>
        p.kind === "VEHICLE" && p.signal_key.endsWith("S1") ? { ...p, color: "RED" } : p,
      );
    return feedback;
  };
  const held = runToEnd(session);
  const finalOf = (run: typeof free) => run.ticks[run.ticks.length - 1].kpi_metrics;
  const heldSeconds = session.elapsedSeconds - session.driveSeconds;
  expect(heldSeconds).toBeGreaterThanOrEqual(2);
  expect(mockFallbackIds(session)).toEqual([]);
  // Whole displayed seconds: the fractional hold may round either way.
  const extra = finalOf(held).total_time_elapsed_sec - finalOf(free).total_time_elapsed_sec;
  expect(Math.abs(extra - heldSeconds)).toBeLessThanOrEqual(1);
  expect(finalOf(held).current_time_saved_sec).toBe(finalOf(free).current_time_saved_sec - extra);
});
