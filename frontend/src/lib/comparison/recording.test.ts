import { expect, it } from "vitest";
import { createRecording, sameScenarioRoutes } from "@/lib/comparison/recording";
import { request, route, tick, completed } from "./fixtures.test-support";
it("requires every simulated second from tick 1 through completion", () => {
  const r = createRecording(request, route());
  r.tick(tick(1));
  r.tick(tick(1));
  r.tick(tick(2));
  expect(r.finish(completed(2)).ticks).toHaveLength(2);
  expect(() => createRecording(request, route()).tick(tick(2))).toThrow(/coverage/i);
  const gap = createRecording(request, route());
  gap.tick(tick(1));
  expect(() => gap.tick(tick(3))).toThrow(/coverage/i);
  expect(() => createRecording(request, route()).tick(tick(1, "wrong"))).toThrow(/run/i);
  const short = createRecording(request, route());
  short.tick(tick(1));
  expect(() => short.finish(completed(2))).toThrow(/coverage/i);
});
it("rejects mode mismatch, frame overflow, and byte overflow while appending", () => {
  expect(() => createRecording(request, route("pair", "DISABLED"))).toThrow(/mode/i);
  const r = createRecording(request, route(), { frames: 1, bytes: 100000 });
  r.tick(tick(1));
  expect(() => r.tick(tick(2))).toThrow(/limit/i);
  expect(() => createRecording(request, route(), { frames: 10000, bytes: 1 })).toThrow(/limit/i);
});
it("requires matching recorded route geometry", () => {
  expect(sameScenarioRoutes(route(), route("other", "DISABLED"))).toBe(true);
  const other = route();
  other.route_geometry = {
    type: "LineString",
    coordinates: [
      [19, 50],
      [20, 51],
    ],
  };
  expect(sameScenarioRoutes(route(), other)).toBe(false);
});
it("accepts recovery ticks after the reported travel time freezes at arrival", () => {
  const r = createRecording(request, route());
  r.tick(tick(1));
  const recovery = tick(2);
  recovery.kpi_metrics.total_time_elapsed_sec = 1;
  recovery.ambulance.status = "ARRIVED";
  r.tick(recovery);
  const terminal = completed(2);
  terminal.kpi_metrics.total_time_elapsed_sec = 1;
  expect(r.finish(terminal).completion.tick).toBe(2);
});
it("accepts exactly 10000 frames and rejects frame 10001", () => {
  const r = createRecording(request, route());
  for (let n = 1; n <= 10000; n++) r.tick(tick(n));
  expect(r.frames).toBe(10000);
  expect(() => r.tick(tick(10001))).toThrow(/frame limit/i);
});
it("enforces the byte limit at the exact serialized boundary", () => {
  const measured = createRecording(request, route());
  measured.tick(tick(1));
  const budget = measured.bytes;
  const exact = createRecording(request, route(), { frames: 10000, bytes: budget });
  expect(() => exact.tick(tick(1))).not.toThrow();
  const below = createRecording(request, route(), { frames: 10000, bytes: budget - 1 });
  expect(() => below.tick(tick(1))).toThrow(/byte limit/i);
});
it("budgets the serialized wrappers and array separators as well as frames", () => {
  const r = createRecording(request, route());
  r.tick(tick(1));
  r.tick(tick(2));
  const run = r.finish(completed(2));
  expect(new TextEncoder().encode(JSON.stringify(run)).byteLength).toBeLessThanOrEqual(run.bytes);
});

it("counts and deduplicates feedback bytes and refuses a failed request snapshot", () => {
  const recorder = createRecording(request, route());
  const feedback: import("@/types/telemetry").ItsFeedbackEvent = {
    schema_version: "1.0",
    is_simulated: true,
    event_type: "ITS_FEEDBACK",
    simulation_id: "pair",
    tick: 1,
    timestamp: "2026-10-23T00:00:00Z",
    request_message_id: "MSG-ITS-1",
    feedback_sequence: 1,
    status: "REJECTED",
    intersections_group: ["INT-0001"],
    observed_at_simulated_sec: 1,
    reason: "CONTROLLER_REJECTED",
  };
  const before = recorder.bytes;
  recorder.feedback(feedback);
  const after = recorder.bytes;
  expect(after).toBeGreaterThan(before);
  recorder.feedback(feedback);
  expect(recorder.bytes).toBe(after);
  const event = tick(1);
  event.its_requests = [
    {
      message_id: "MSG-ITS-1",
      status: "REJECTED",
      intersections_group: ["INT-0001"],
      submitted_at_simulated_sec: 0,
      last_updated_at_simulated_sec: 1,
      last_feedback_sequence: 1,
      reason: "CONTROLLER_REJECTED",
      acknowledged_at_simulated_sec: null,
    },
  ];
  recorder.tick(event);
  expect(() => recorder.finish(completed(1))).toThrow(/failed/i);
});
