import { it, expect } from "vitest";
import { createMockSession, advanceMockSession } from "./mock-session";
import { request } from "./comparison/fixtures.test-support";
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
