import { describe, it, expect } from "vitest";
import { createMockSession, advanceMockSession, type MockSession } from "./mock-session";
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

it.each([
  ["REJECTED", "ITS_REJECTED"],
  ["NO_FEEDBACK", "ITS_TIMEOUT"],
] as const)("mock %s ends with its cause", (scenario, cause) => {
  const session = createMockSession({ ...request, its_scenario: scenario });
  let result = advanceMockSession(session);
  for (let n = 0; !result.failure && n < 200; n++) result = advanceMockSession(session);
  expect(result.failure).toBe(cause);
  expect(result.completed).toBe(false);
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
    ["REJECTED", 1, "REJECTED", "ITS_REJECTED"],
    ["NO_FEEDBACK", 8, "TIMED_OUT", "ITS_TIMEOUT"],
  ] as const)(
    "%s responds %i simulated seconds after dispatch",
    (scenario, delay, status, failure) => {
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
          expect(result.failure).toBe(failure);
          if (failure) expect(result.completed).toBe(false);
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
